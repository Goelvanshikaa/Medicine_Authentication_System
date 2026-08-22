# Backend Module: Smart Anti-Counterfeit Medicine Authentication System

This is the FastAPI backend module for the capstone project. It runs locally on a Raspberry Pi, uses SQLite as the primary source of truth, and periodically synchronizes scans to a cloud PostgreSQL database.

## Architecture

- **FastAPI**: Provides REST APIs.
- **SQLite**: Stores local batch and scan data.
- **SQLAlchemy**: ORM for database queries.
- **Sync Worker**: A persistent asynchronous loop that checks for pending local scans and pushes them to PostgreSQL when online.

## Installation (Raspberry Pi or Local PC)

1. **Clone the repository / copy files.**
2. **Create a virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # Or .\venv\Scripts\activate on Windows
   ```
3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
4. **Configure environment:**
   Create a `.env` file in the root directory (copy `.env.example`):
   ```env
   DEVICE_ID=PI_001
   DATABASE_URL=sqlite:///./local_scans.db
   POSTGRES_URL=postgresql://user:password@cloud-host:5432/db_name
   SYNC_INTERVAL_SECONDS=300
  ARDUINO_SERIAL_PORT=COM3
  ARDUINO_BAUD_RATE=115200
  ARDUINO_TIMEOUT=15
   ```
   *Note: Set `POSTGRES_URL` to empty if testing completely offline without a cloud DB.*

## Running the Application

Run the server with Uvicorn (restricted to 1 worker for the Pi):
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

The database (`local_scans.db`) will be automatically created on startup.
You can view the API documentation by navigating to `http://127.0.0.1:8000/docs`.

## Testing the Pipeline

A mock script is provided to simulate the ML/hardware sending scan results to the API:
```bash
python scripts/mock_ml_client.py
```

## Production Deployment (systemd on Raspberry Pi)

To ensure the backend starts automatically on boot:

1. Create a service file: `sudo nano /etc/systemd/system/med-backend.service`
2. Add the following content (adjust paths accordingly):
   ```ini
   [Unit]
   Description=Anti-Counterfeit Medicine Backend API
   After=network.target

   [Service]
   User=pi
   Group=pi
   WorkingDirectory=/home/pi/backend
   Environment="PATH=/home/pi/backend/venv/bin"
   ExecStart=/home/pi/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
3. Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable med-backend
   sudo systemctl start med-backend
   ```

   ## PostgreSQL migrations

   Before running synchronization against a new PostgreSQL database, create the required tables on the cloud DB. A SQL migration file is included at `postgres_migrations/create_tables.sql`.

   Run it with `psql` (replace the connection string with your `POSTGRES_URL`):

   ```bash
   # Example (replace with your real connection string):
   psql "postgresql://user:password@host:5432/dbname" -f postgres_migrations/create_tables.sql
   ```

   The migration creates `batches` and `scans` tables and an idempotent primary key on `(device_id, scan_id)` to prevent duplicate cloud inserts.

   Alternatively, you can use the included Python helper which reads `POSTGRES_URL` from your environment or `.env` and applies the migration without printing credentials:

   ```bash
   # Ensure POSTGRES_URL is set (PowerShell):
   $env:POSTGRES_URL = 'postgresql://<user>:<password>@...'
   python scripts/apply_migrations.py

   # Or (Linux/macOS):
   export POSTGRES_URL='postgresql://<user>:<password>@...'
   python scripts/apply_migrations.py
   ```

   Do NOT commit `.env` with credentials. Store the connection string in a secure place and load it into the environment on the Raspberry Pi or CI system.

## API Contract

### ML -> Backend: authentication result

Endpoint: `POST /api/scans/`

Request JSON example:
```json
{
  "batch_id": "B12345",
  "medicine_name": "Paracetamol",
  "classification": "Genuine",
  "confidence_score": 0.96,
  "anomaly_score": 0.04
}
```

Field rules:
- `batch_id`: string or null
- `medicine_name`: string or null
- `classification`: `"Genuine"`, `"Counterfeit"`, or null
- `confidence_score`: float between 0.0 and 1.0, or null
- `anomaly_score`: float between 0.0 and 1.0, or null

The backend automatically fills in:
- `device_id` from `DEVICE_ID`
- `timestamp` from server time
- `sync_status` as `pending`

### Backend -> Frontend: scan result

`GET /api/scans/{scan_id}` JSON example:
```json
{
  "scan_id": 1,
  "device_id": "PI_001",
  "batch_id": "B12345",
  "medicine_name": "Paracetamol",
  "timestamp": "2026-08-14T12:00:00Z",
  "classification": "Genuine",
  "confidence_score": 0.96,
  "anomaly_score": 0.04,
  "sync_status": "pending"
}
```

### Backend -> Frontend: scan history

`GET /api/scans/?skip=0&limit=50` returns a list of scan objects like the one above.

### Backend -> Frontend: batch details

`GET /api/batches/{batch_id}` JSON example:
```json
{
  "batch_id": "B12345",
  "medicine_name": "Paracetamol",
  "manufacturer": "Alpha Pharma",
  "batch_number": "ALPHA-001",
  "manufacturing_date": "2025-01-01",
  "expiry_date": "2028-01-01",
  "created_at": "2026-08-14T12:00:00Z"
}
```

### Backend -> Frontend: dashboard stats

`GET /api/dashboard/stats`:
```json
{
  "total_scans": 42,
  "genuine": 30,
  "counterfeit": 12,
  "pending_sync": 3
}
```

### Backend -> Frontend: dashboard trends

`GET /api/dashboard/trends?days=7`:
```json
{
  "trends": [
    {"date": "2026-08-08", "count": 12},
    {"date": "2026-08-09", "count": 7},
    {"date": "2026-08-10", "count": 9}
  ]
}
```

### Backend -> Frontend: risk

`GET /api/dashboard/risk`:
```json
{
  "average_anomaly_score": 0.2143
}
```

## Current API overview

- `POST /api/scans/` — create a scan result from ML output
- `GET /api/scans/` — list scans with `skip` and `limit`
- `GET /api/scans/{scan_id}` — fetch one scan
- `POST /api/batches/` — create a batch record
- `GET /api/batches/` — list batches with `skip` and `limit`
- `GET /api/batches/{batch_id}` — fetch one batch
- `GET /api/dashboard/stats` — count scans by classification
- `GET /api/dashboard/trends` — aggregate per day
- `GET /api/dashboard/risk` — average anomaly

## SQLite vs Neon

- SQLite is the local source of truth.
- Neon PostgreSQL is used only for cloud storage and centralized sync.
- Local scan records remain in SQLite until PostgreSQL accepts them.
- `sync_status` should not be set directly by clients.

