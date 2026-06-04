"""
Homesavers Scanner — Alt-Barcode sync
Reads the latest ALT Barcode Master_*.xlsx, maps to our alt_barcodes table,
posts to /api/alt-barcodes/sync in chunks of 2000 rows.

Pattern borrowed from the existing price-tracker Python scripts.
"""

import os, sys, json, pathlib, datetime, requests
import pandas as pd

BASE_URL    = "https://homesaversscanner.pages.dev"
SECRET_FILE = r"C:\Homesavers\.sync-secret"
LOG_FILE    = r"C:\Homesavers\logs\sync-alt-barcodes-py.log"
CHUNK_SIZE  = 2000

# Excel header (after strip) → our DB field name
COLUMN_MAP = {
    "Barcode_No":     "barcode_no",    # primary key
    "EAN_Barcode":    "ean_barcode",
    "Item_Name":      "item_name",
    "Supl_Id":        "supl_id",
    "Supplier_Code":  "supplier_code",
    "Item_Status":    "item_status",
    "Barcode_Status": "barcode_status",
}
REQUIRED_COL = "Barcode_No"


# ── Logging ───────────────────────────────────────────────────────────────────

def log(msg, level="INFO"):
    line = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}"
    print(line, flush=True)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _safe_str(val):
    if pd.isna(val):
        return ""
    return str(val).strip()


# ── Main ──────────────────────────────────────────────────────────────────────

def record_run(headers, *, file_name, file_size, imported, skipped, status, message, started_at):
    """Post the run result to /api/sync-runs so it shows in Settings -> Data Sync."""
    try:
        requests.post(
            f"{BASE_URL}/api/sync-runs",
            headers=headers,
            json={
                "kind":             "alt_barcodes",
                "file_name":        file_name,
                "file_size_bytes":  file_size,
                "records_imported": imported,
                "records_skipped":  skipped,
                "status":           status,
                "message":          message,
                "started_at":       started_at,
            },
            timeout=30,
        )
    except Exception as e:
        log(f"Could not record run to dashboard: {e}", "WARN")


def main():
    started_at = datetime.datetime.utcnow().isoformat() + "Z"
    file_name, file_size = None, None
    log("=== Alt-barcode sync starting ===")

    if not os.path.exists(SECRET_FILE):
        log(f"Secret file not found: {SECRET_FILE}", "ERROR"); sys.exit(1)
    secret = open(SECRET_FILE, encoding="utf-8").read().strip()
    headers = {"X-Sync-Secret": secret, "Content-Type": "application/json"}

    def fail(msg):
        log(f"FAILED: {msg}", "ERROR")
        record_run(headers, file_name=file_name, file_size=file_size,
                   imported=0, skipped=0, status="error", message=msg, started_at=started_at)
        sys.exit(1)

    # Fetch config from app
    try:
        cfg = requests.get(f"{BASE_URL}/api/alt-barcodes/sync-config", headers=headers, timeout=30).json()
    except Exception as e:
        fail(f"Could not fetch config: {e}")

    folder  = cfg.get("folder", "")
    pattern = cfg.get("file_pattern", "*.xlsx") or "*.xlsx"
    prefix  = cfg.get("name_prefix", "") or ""
    sheet   = cfg.get("sheet", "1") or "1"

    if not folder:
        fail("No folder configured in Admin -> Settings")

    log(f"Config: folder='{folder}' pattern='{pattern}' prefix='{prefix}' sheet='{sheet}'")

    # Find latest file
    folder_path = pathlib.Path(folder)
    if not folder_path.exists():
        fail(f"Folder not accessible: {folder}")

    candidates = list(folder_path.glob(pattern))
    if prefix:
        candidates = [p for p in candidates if p.name.startswith(prefix)]
    if not candidates:
        fail(f"No files matching '{pattern}' in {folder}")

    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    file_name = latest.name
    file_size = latest.stat().st_size
    size_mb = round(file_size / 1_048_576, 1)
    log(f"File: {latest.name} ({size_mb} MB)")

    # Read Excel — dtype=str preserves barcodes with leading zeros
    log("Reading Excel...")
    try:
        sheet_arg = int(sheet) - 1 if sheet.isdigit() else sheet
        df = pd.read_excel(latest, sheet_name=sheet_arg, dtype=str, engine="openpyxl")
    except Exception as e:
        fail(f"Failed to read Excel: {e}")

    df.columns = df.columns.str.strip()
    log(f"Parsed {len(df)} rows. Columns: {list(df.columns)}")

    # Resolve mapped columns case/format-insensitively. Excel headers vary in
    # case and punctuation (e.g. "item_name" vs "Item_Name", "SupplierCode" vs
    # "Supplier_Code"), so match on a normalised key rather than exact text.
    def _norm(s):
        return "".join(ch for ch in str(s).lower() if ch.isalnum())
    norm_to_actual = {_norm(c): c for c in df.columns}
    resolved = {}  # db_field -> actual Excel column name
    for excel_col, db_field in COLUMN_MAP.items():
        actual = norm_to_actual.get(_norm(excel_col))
        if actual:
            resolved[db_field] = actual
    log(f"Resolved columns: {resolved}")

    if "barcode_no" not in resolved:
        fail(f"Required column 'Barcode_No' not found. Available: {list(df.columns)}")

    # Build payload
    payload = []
    skipped = 0
    for _, row in df.iterrows():
        barcode = _safe_str(row[resolved["barcode_no"]])
        if not barcode or barcode == "0":
            skipped += 1
            continue
        record = {}
        for db_field, actual in resolved.items():
            val = _safe_str(row[actual])
            if val:
                record[db_field] = val
        payload.append(record)

    log(f"Prepared {len(payload)} rows, skipped {skipped} (no barcode)")
    if not payload:
        fail("Nothing to upload.")

    # Post in chunks
    imported = 0
    for i in range(0, len(payload), CHUNK_SIZE):
        chunk = payload[i:i + CHUNK_SIZE]
        chunk_num = i // CHUNK_SIZE + 1
        try:
            resp = requests.post(
                f"{BASE_URL}/api/alt-barcodes/sync",
                headers=headers,
                json=chunk,
                timeout=300
            )
            resp.raise_for_status()
            result = resp.json()
            imported += int(result.get("written", 0))
            log(f"Chunk {chunk_num}: written={result.get('written')} skipped={result.get('skipped')}")
        except Exception as e:
            fail(f"Chunk {chunk_num} failed: {e}")

    log(f"Totals: imported={imported} skipped={skipped}")
    record_run(headers, file_name=file_name, file_size=file_size,
               imported=imported, skipped=skipped, status="ok",
               message=f"Imported {imported}, skipped {skipped}", started_at=started_at)
    try:
        requests.post(f"{BASE_URL}/api/product-master/refresh", headers=headers, timeout=120)
        log("Product Master lookup refreshed.")
    except Exception as e:
        log(f"Could not refresh Product Master: {e}", "WARN")
    log("=== Alt-barcode sync finished OK ===")


if __name__ == "__main__":
    main()
