from fastapi import APIRouter, Depends, HTTPException
from pathlib import Path
import sys
from threading import Lock
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone
from app.database.session import get_db
from app.database.models import Scan
from app.schemas.schemas import ScanAnalysisRequest, ScanCreate, ScanResponse
from app.core.config import settings
from app.hardware.arduino_serial import (
    ArduinoScanError,
    ArduinoSerialError,
    ArduinoTimeoutError,
    MalformedReadingError,
    read_hardware_scan,
)

router = APIRouter()
hardware_scan_lock = Lock()


def run_ml_inference(readings):
    ml_root = Path(__file__).resolve().parents[3] / "ml"
    if str(ml_root) not in sys.path:
        sys.path.insert(0, str(ml_root))

    from ml_inference import authenticate_scan

    return authenticate_scan(readings)

def trigger_sync():
    """Placeholder to signal the background sync worker.
    In a threaded approach, this could set an Event flag. 
    For now, we'll implement the persistent sync loop to poll or wait.
    """
    pass

@router.post("/", response_model=ScanResponse, status_code=201)
def create_scan(scan: ScanCreate, db: Session = Depends(get_db)):
    raw_payload = scan.model_dump(mode="json", exclude_none=True)
    payload = {
        key: value
        for key, value in raw_payload.items()
        if key not in {
            "medicine", "classification_confidence", "classification_status",
            "anomaly_status", "final_status", "explainability", "scan_data",
            "classification_probabilities",
        }
    }

    scan_data = raw_payload.get("scan_data", {})
    aggregated = scan_data.get("aggregated_reading", {})
    ml_mapping = {
        "medicine_name": raw_payload.get("medicine"),
        "confidence_score": raw_payload.get("classification_confidence"),
        "classification": (raw_payload.get("final_status") or "").title() or None,
        "channel_1": aggregated.get("ch450"),
        "channel_2": aggregated.get("ch500"),
        "channel_3": aggregated.get("ch550"),
        "channel_4": aggregated.get("ch570"),
        "channel_5": aggregated.get("ch600"),
        "channel_6": aggregated.get("ch650"),
        "classification_status": raw_payload.get("classification_status"),
        "anomaly_status": raw_payload.get("anomaly_status"),
        "final_status": raw_payload.get("final_status"),
        "number_of_readings": scan_data.get("n_readings"),
        "stability_cv": scan_data.get("stability_cv"),
        "ml_result": raw_payload,
    }
    for key, value in ml_mapping.items():
        if value is not None:
            payload.setdefault(key, value)

    requested_scan_id = payload.get("scan_id")

    # Create the local record
    new_scan = Scan(
        **payload,
        device_id=settings.device_id,
        sync_status="pending",
        timestamp=datetime.now(timezone.utc)
    )
    db.add(new_scan)
    db.commit()
    db.refresh(new_scan)

    if requested_scan_id is not None:
        new_scan.scan_id = requested_scan_id
    elif new_scan.scan_id is None:
        new_scan.scan_id = new_scan.id
    db.commit()
    db.refresh(new_scan)

    # Notify the sync worker to attempt sync (implementation will depend on worker design)
    trigger_sync()

    return new_scan


@router.post("/analyze", status_code=201)
def analyze_scan(payload: ScanAnalysisRequest, db: Session = Depends(get_db)):
    try:
        ml_result = run_ml_inference(payload.readings)
    except (ImportError, ModuleNotFoundError) as error:
        raise HTTPException(status_code=503, detail=f"ML dependencies are unavailable: {error}") from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=f"ML model files are unavailable: {error}") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"ML inference failed: {error}") from error

    scan = ScanCreate.model_validate(ml_result)
    saved_scan = create_scan(scan, db)
    return {"result": ml_result, "scan": saved_scan}


@router.post("/hardware-scan", status_code=201)
def hardware_scan(db: Session = Depends(get_db)):
    if not hardware_scan_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A hardware scan is already in progress.")

    try:
        try:
            hardware_readings = read_hardware_scan(
                port=settings.arduino_serial_port,
                baud_rate=settings.arduino_baud_rate,
                timeout=settings.arduino_timeout,
            )
        except (ArduinoSerialError, ArduinoTimeoutError) as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except MalformedReadingError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ArduinoScanError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

        readings = [
            {channel: reading[channel] for channel in (
                "ch450", "ch500", "ch550", "ch570", "ch600", "ch650"
            )}
            for reading in hardware_readings
        ]

        try:
            ml_result = run_ml_inference(readings)
        except (ImportError, ModuleNotFoundError) as error:
            raise HTTPException(status_code=503, detail=f"ML dependencies are unavailable: {error}") from error
        except FileNotFoundError as error:
            raise HTTPException(status_code=503, detail=f"ML model files are unavailable: {error}") from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=500, detail="ML inference failed.") from error

        scan = ScanCreate.model_validate(ml_result)
        saved_scan = create_scan(scan, db)
        return {"result": ml_result, "scan": saved_scan}
    finally:
        hardware_scan_lock.release()

@router.get("/", response_model=List[ScanResponse])
def get_scans(skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    return db.query(Scan).order_by(Scan.timestamp.desc()).offset(skip).limit(limit).all()

@router.get("/{scan_id}", response_model=ScanResponse)
def get_scan(scan_id: int, db: Session = Depends(get_db)):
    scan = db.query(Scan).filter(Scan.scan_id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan
