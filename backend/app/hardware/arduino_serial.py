from __future__ import annotations

import math
import time
from typing import Any


CHANNELS = ("ch450", "ch500", "ch550", "ch570", "ch600", "ch650")
MEASUREMENT_FIELDS = ("temperature", *CHANNELS)
EXPECTED_READINGS = 10


class ArduinoScanError(RuntimeError):
    """Base error for an invalid or incomplete Arduino scan."""


class ArduinoSerialError(ArduinoScanError):
    """The serial device could not be opened or used."""


class ArduinoTimeoutError(ArduinoScanError):
    """The Arduino did not complete a scan before the timeout."""


class MalformedReadingError(ArduinoScanError):
    """The Arduino sent a measurement with an invalid shape or value."""


def _parse_measurement(line: str) -> dict[str, float] | None:
    text = line.strip()
    if not text or "," not in text:
        return None

    values = [value.strip() for value in text.split(",")]
    if len(values) != len(MEASUREMENT_FIELDS):
        raise MalformedReadingError(
            f"Malformed Arduino reading: expected {len(MEASUREMENT_FIELDS)} values, received {len(values)}."
        )

    try:
        parsed = {field: float(value) for field, value in zip(MEASUREMENT_FIELDS, values)}
    except ValueError as error:
        raise MalformedReadingError("Malformed Arduino reading: all values must be numeric.") from error

    if not all(math.isfinite(value) for value in parsed.values()):
        raise MalformedReadingError("Malformed Arduino reading: values must be finite.")
    return parsed


def read_hardware_scan(
    port: str,
    baud_rate: int = 115200,
    timeout: float = 15.0,
    serial_module: Any = None,
) -> list[dict[str, float]]:
    """Trigger one Arduino scan and return exactly ten validated readings."""
    if serial_module is None:
        try:
            import serial as serial_module
        except ImportError as error:
            raise ArduinoSerialError("pyserial is not installed.") from error

    connection = None
    try:
        connection = serial_module.Serial(port=port, baudrate=baud_rate, timeout=0.25)
        connection.reset_input_buffer()
        connection.write(b"SCAN\n")
        connection.flush()

        readings: list[dict[str, float]] = []
        deadline = time.monotonic() + timeout
        while len(readings) < EXPECTED_READINGS and time.monotonic() < deadline:
            raw_line = connection.readline()
            if not raw_line:
                continue
            line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else str(raw_line)
            reading = _parse_measurement(line)
            if reading is not None:
                readings.append(reading)

        if len(readings) != EXPECTED_READINGS:
            raise ArduinoTimeoutError(
                f"Arduino scan incomplete: received {len(readings)} of {EXPECTED_READINGS} readings."
            )
        return readings
    except ArduinoScanError:
        raise
    except Exception as error:
        raise ArduinoSerialError(f"Unable to communicate with Arduino on {port}: {error}") from error
    finally:
        if connection is not None:
            connection.close()