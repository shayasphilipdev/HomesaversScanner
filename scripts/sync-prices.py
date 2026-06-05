"""
Homesavers Scanner — Prices (ItemMaster) sync
Reads the latest ItemMaster_*.xlsx, maps to our prices table columns,
posts to /api/prices/sync in chunks of 2000 rows.

Pattern borrowed from the existing price-tracker Python scripts.
"""

import os, sys, json, pathlib, datetime, requests
import pandas as pd

BASE_URL    = "https://homesaversscanner.pages.dev"
SECRET_FILE = r"C:\Homesavers\.sync-secret"
LOG_FILE    = r"C:\Homesavers\logs\sync-prices-py.log"
CHUNK_SIZE  = 2000

# Excel header (after strip) → our DB field name
COLUMN_MAP = {
    "EAN_Barcode":   "ean_barcode",   # primary key — rows without this are skipped
    "ItemGroup":     "item_group",
    "ItemSubGrp_Id": "item_subgrp_id",
    "ProductType":   "product_type",
    "SaleRate":      "sale_rate",
}
REQUIRED_COL = "EAN_Barcode"


# ── Logging ───────────────────────────────────────────────────────────────────

def log(msg, level="INFO"):
    line = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}"
    print(line, flush=True)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_str(val):
    """Convert a pandas cell to clean string, empty string for NaN."""
    if pd.isna(val):
        return ""
    return str(val).strip()

def _safe_float(val):
    """Clean currency strings to float. Returns None for blank/NaN."""
    s = _safe_str(val)
    if not s:
        return None
    s = s.replace("€", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


# ── Main ──────────────────────────────────────────────────────────────────────

def record_run(headers, *, file_name, file_size, imported, skipped, status, message, started_at):
    """Post the run result to /api/sync-runs so it shows in Settings -> Data Sync."""
    try:
        requests.post(
            f"{BASE_URL}/api/sync-runs",
            headers=headers,
            json={
                "kind":             "prices",
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
    log("=== Prices (ItemMaster) sync starting ===")

    # Read secret
    if not os.path.exists(SECRET_FILE):
        log(f"Secret file not found: {SECRET_FILE}", "ERROR"); sys.exit(1)
    secret = open(SECRET_FILE, encoding="utf-8").read().strip()
    headers = {"X-Sync-Secret": secret, "Content-Type": "application/json"}

    def fail(msg):
        log(f"FAILED: {msg}", "ERROR")
        record_run(headers, file_name=file_name, file_size=file_size,
                   imported=0, skipped=0, status="error", message=msg, started_at=started_at)
        sys.exit(1)

    # Capture the SERVER clock now (skew-free) so we can flush rows older than
    # this run after a successful import — i.e. drop products no longer in the file.
    flush_cutoff = None
    try:
        flush_cutoff = requests.get(f"{BASE_URL}/api/sync/server-time", headers=headers, timeout=30).json().get("now")
    except Exception as e:
        log(f"Could not get server time (stale flush will be skipped): {e}", "WARN")

    # Fetch config from app
    try:
        cfg = requests.get(f"{BASE_URL}/api/prices/sync-config", headers=headers, timeout=30).json()
    except Exception as e:
        fail(f"Could not fetch config: {e}")

    folder  = cfg.get("folder", "")
    pattern = cfg.get("file_pattern", "*.xlsx") or "*.xlsx"
    prefix  = cfg.get("name_prefix", "ItemMaster") or "ItemMaster"
    sheet   = cfg.get("sheet", "ItemMaster") or "ItemMaster"

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

    # Read Excel — dtype=str keeps EAN barcodes as strings (no leading-zero loss)
    log("Reading Excel...")
    try:
        # Try named sheet first, fall back to first sheet
        try:
            df = pd.read_excel(latest, sheet_name=sheet, dtype=str, engine="openpyxl")
        except Exception:
            df = pd.read_excel(latest, sheet_name=0, dtype=str, engine="openpyxl")
    except Exception as e:
        fail(f"Failed to read Excel: {e}")

    df.columns = df.columns.str.strip()
    log(f"Parsed {len(df)} rows. Columns: {list(df.columns)}")

    # Resolve mapped columns case/format-insensitively (Excel headers vary in
    # case and punctuation), matching on a normalised key rather than exact text.
    def _norm(s):
        return "".join(ch for ch in str(s).lower() if ch.isalnum())
    norm_to_actual = {_norm(c): c for c in df.columns}
    resolved = {}  # db_field -> actual Excel column name
    for excel_col, db_field in COLUMN_MAP.items():
        actual = norm_to_actual.get(_norm(excel_col))
        if actual:
            resolved[db_field] = actual
    log(f"Resolved columns: {resolved}")

    if "ean_barcode" not in resolved:
        fail(f"Required column 'EAN_Barcode' not found. Available: {list(df.columns)}")

    # Build payload — only mapped columns, skip rows with no EAN
    payload = []
    skipped = 0
    for _, row in df.iterrows():
        ean = _safe_str(row[resolved["ean_barcode"]])
        if not ean or ean == "0":
            skipped += 1
            continue
        record = {}
        for db_field, actual in resolved.items():
            val = _safe_str(row[actual])
            if val:
                record[db_field] = val
        payload.append(record)

    log(f"Prepared {len(payload)} rows, skipped {skipped} (no EAN)")
    if not payload:
        fail("Nothing to upload.")

    # Full replace: empty the table before reimporting so it never bloats over
    # time. Guard with a row floor so a truncated/corrupt file can't wipe it.
    if len(payload) < 1000:
        fail(f"Only {len(payload)} rows parsed - too few to safely replace the table. Aborting.")
    try:
        r = requests.post(f"{BASE_URL}/api/prices/sync/reset", headers=headers, timeout=120)
        r.raise_for_status()
        log("Cleared old prices data (full replace).")
    except Exception as e:
        fail(f"Could not reset table before import: {e}")

    # Post in chunks
    imported = 0
    for i in range(0, len(payload), CHUNK_SIZE):
        chunk = payload[i:i + CHUNK_SIZE]
        chunk_num = i // CHUNK_SIZE + 1
        try:
            resp = requests.post(
                f"{BASE_URL}/api/prices/sync",
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

    # Flush stale rows (full-replace) — only after a healthy import, to protect
    # against a partial/corrupt file wiping the table.
    FLUSH_MIN = 1000
    if flush_cutoff and imported >= FLUSH_MIN:
        try:
            d = requests.post(f"{BASE_URL}/api/prices/flush-stale",
                              headers=headers, json={"before": flush_cutoff}, timeout=180).json()
            log(f"Flushed {d.get('deleted', 0)} stale price row(s).")
        except Exception as e:
            log(f"Could not flush stale rows: {e}", "WARN")
    elif imported < FLUSH_MIN:
        log(f"Skipped stale flush — only {imported} rows imported (< {FLUSH_MIN}).", "WARN")

    try:
        requests.post(f"{BASE_URL}/api/product-master/refresh", headers=headers, timeout=120)
        log("Product Master lookup refreshed.")
    except Exception as e:
        log(f"Could not refresh Product Master: {e}", "WARN")
    log("=== Prices sync finished OK ===")


if __name__ == "__main__":
    main()
