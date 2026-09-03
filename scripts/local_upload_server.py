r"""
Homesavers Scanner — local upload server
Listens on http://localhost:8765 and accepts Excel file uploads from the
browser admin page. Parses with pandas/openpyxl (same approach as the
daily sync) and posts rows to the Homesavers Scanner API.

Start automatically via Task Scheduler or run manually:
  C:\Scraping\homesavers-scanner\.venv\Scripts\python.exe local_upload_server.py
"""
from __future__ import annotations

import io
import json
import os
import pathlib
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

import pandas as pd
import requests

# HTTP goes through `requests`, NOT urllib.request. urllib verifies against the
# OpenSSL default store (C:\Program Files\Common Files\SSL/cert.pem on this
# machine), which contains an expired root, so every call failed with
# CERTIFICATE_VERIFY_FAILED - the second reason manual uploads never worked.
# `requests` uses the certifi bundle and is what every other script here already
# uses, so this keeps the whole scripts/ folder on one HTTP stack.
TIMEOUT_SHORT = 30
TIMEOUT_LONG  = 300

# ── Config ────────────────────────────────────────────────────────────────────

PORT         = 8765
BASE_URL     = "https://homesaversscanner.pages.dev"
SECRET_FILE  = r"C:\Homesavers\.sync-secret"
LOG_FILE     = r"C:\Homesavers\logs\upload-server.log"
CHUNK_SIZE   = 2000
ALLOWED_ORIGIN = "https://homesaversscanner.pages.dev"


def _log(msg: str) -> None:
    """Write to the log file, and to the console only if there is one.

    Everything used to go through bare print(). A Windows console is cp1252, so
    a single non-ASCII character raised UnicodeEncodeError and killed the
    server outright - which is exactly how this process died on its own startup
    banner, before serve_forever() was ever reached. Logging must not be able
    to take the server down, and it has to work with no console at all, because
    the scheduled task runs it windowless under pythonw.exe.
    """
    line = "[upload-server] %s" % msg
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass
    try:
        print(line)
    except Exception:
        pass

# ── Helpers ───────────────────────────────────────────────────────────────────

def _secret() -> str:
    with open(SECRET_FILE, encoding="utf-8") as f:
        return f.read().strip()


def _safe_str(val) -> str:
    if pd.isna(val):
        return ""
    return str(val).strip()


def _safe_float(val):
    s = _safe_str(val)
    if not s:
        return None
    try:
        return float(s.replace(",", "").replace("€", "").strip())
    except ValueError:
        return None


def _record_run(kind: str, file_name: str, imported: int, skipped: int, status: str, secret: str):
    """Record this run to /api/sync-runs so it shows in Settings -> Data Sync."""
    try:
        requests.post(
            f"{BASE_URL}/api/sync-runs",
            json={
                "kind": kind, "file_name": file_name,
                "records_imported": imported, "records_skipped": skipped,
                "status": status,
            },
            headers={"X-Sync-Secret": secret},
            timeout=TIMEOUT_SHORT,
        ).raise_for_status()
    except Exception as e:
        _log(f"could not record run: {e}")


def _post_chunks(api_path: str, rows: list, secret: str) -> dict:
    written = skipped = 0
    total_chunks = (len(rows) + CHUNK_SIZE - 1) // CHUNK_SIZE
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i:i + CHUNK_SIZE]
        n     = i // CHUNK_SIZE + 1
        resp  = requests.post(
            f"{BASE_URL}/api{api_path}",
            json=chunk,
            headers={"X-Sync-Secret": secret},
            timeout=TIMEOUT_LONG,
        )
        if not resp.ok:
            # Surface the server's own message: a 400 here is usually a real
            # explanation (wrong column, bad ON CONFLICT target), and burying
            # it behind a generic HTTPError wastes the diagnosis.
            raise RuntimeError(
                "chunk %d/%d failed (HTTP %d): %s"
                % (n, total_chunks, resp.status_code, resp.text[:300]))
        r = resp.json()
        written += int(r.get("written", 0))
        skipped += int(r.get("skipped", 0))
        _log("chunk %d/%d written=%s skipped=%s" % (n, total_chunks, r.get("written"), r.get("skipped")))
    return {"written": written, "skipped": skipped}


# ── Column maps ───────────────────────────────────────────────────────────────

def _build_prices_rows(df: pd.DataFrame) -> tuple[list, int]:
    rows, skipped = [], 0
    for row in df.to_dict("records"):
        ean = _safe_str(row.get("EAN_Barcode", ""))
        if not ean or ean == "0":
            skipped += 1
            continue
        rows.append({
            "ean_barcode":    ean,
            "item_group":     _safe_str(row.get("ItemGroup", ""))     or None,
            "item_subgrp_id": _safe_str(row.get("ItemSubGrp_Id", "")) or None,
            "product_type":   _safe_str(row.get("ProductType", ""))   or None,
            "sale_rate":      _safe_float(row.get("SaleRate")),
        })
    return rows, skipped


def _build_alt_barcode_rows(df: pd.DataFrame) -> tuple[list, int]:
    rows, skipped = [], 0
    for row in df.to_dict("records"):
        bc = _safe_str(row.get("Barcode_No", ""))
        if not bc or bc == "0":
            skipped += 1
            continue
        rows.append({
            "barcode_no":     bc,
            "ean_barcode":    _safe_str(row.get("EAN_Barcode", ""))    or None,
            "item_name":      _safe_str(row.get("Item_Name", ""))      or None,
            "supl_id":        _safe_str(row.get("Supl_Id", ""))        or None,
            "supplier_code":  _safe_str(row.get("Supplier_Code", ""))  or None,
            "item_status":    _safe_str(row.get("Item_Status", ""))    or None,
            "barcode_status": _safe_str(row.get("Barcode_Status", "")) or None,
        })
    # Flag one row per product (lowest barcode_no per ean_barcode) as primary,
    # matching the scheduled sync so Product Master lists each product once.
    rows.sort(key=lambda r: (r.get("ean_barcode") or "", r.get("barcode_no") or ""))
    seen = set()
    for r in rows:
        ean = r.get("ean_barcode") or ""
        r["is_primary"] = (not ean) or (ean not in seen)
        if ean:
            seen.add(ean)
    return rows, skipped


def _build_bm_daily_rows(df: pd.DataFrame) -> tuple[list, int]:
    """B&M daily file: one column of ProductIDs, everything else ignored.

    Column aliases match sync-bm-daily.ps1 so the same workbook works for both
    the nightly job and a manual upload.
    """
    aliases = ("productid", "product id", "product_id", "productcode", "product_code")
    col = None
    for c in df.columns:
        if str(c).strip().lower().replace("_", "").replace(" ", "") in (
                "productid", "productcode"):
            col = c
            break
    if col is None:
        for c in df.columns:
            if str(c).strip().lower() in aliases:
                col = c
                break
    if col is None:
        raise ValueError(
            "ProductID column not found. Columns: %s"
            % ", ".join(str(c) for c in list(df.columns)[:12]))

    rows, skipped, seen = [], 0, set()
    for val in df[col]:
        code = _safe_str(val)
        if not code or code == "0":
            skipped += 1
            continue
        if code in seen:
            continue
        seen.add(code)
        rows.append({"product_id": code})
    return rows, skipped


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",          ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods",         "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",         "Content-Type, Authorization, X-Sheet")
        self.send_header("Access-Control-Allow-Private-Network", "true")  # Chrome Private Network Access

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        # Readiness probe. The admin page calls this before showing the upload
        # controls, so "server not running" is visible up front instead of only
        # after picking a file and clicking Upload.
        if self.path.split("?")[0] == "/health":
            self._json(200, {"ok": True, "service": "homesavers-upload-server"})
        else:
            self._json(404, {"error": "Unknown path"})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path not in ("/upload-prices", "/upload-alt-barcodes", "/upload-bm-daily"):
            self._json(404, {"error": f"Unknown path: {path}"})
            return

        # Parse query string for sheet param
        qs = self.path.split("?")[1] if "?" in self.path else ""
        sheet = "1"
        for part in qs.split("&"):
            if part.startswith("sheet="):
                sheet = urllib.parse.unquote(part[6:])

        length = int(self.headers.get("Content-Length", 0))
        data   = self.rfile.read(length)

        try:
            secret = _secret()
            # Read Excel with pandas (dtype=str = no leading-zero loss)
            buf = io.BytesIO(data)
            try:
                sheet_arg = int(sheet) - 1 if sheet.isdigit() else sheet
                df = pd.read_excel(buf, sheet_name=sheet_arg, dtype=str, engine="openpyxl")
            except Exception:
                df = pd.read_excel(buf, sheet_name=0, dtype=str, engine="openpyxl")
            df.columns = df.columns.str.strip()

            reset_path = None
            if path == "/upload-prices":
                rows, skipped = _build_prices_rows(df)
                api_path = "/prices/sync"
                kind     = "prices"
            elif path == "/upload-bm-daily":
                rows, skipped = _build_bm_daily_rows(df)
                api_path = "/bm-daily/sync"
                kind     = "bm_daily"
                # bm_daily_file is a full-replace table, same as the nightly
                # job. Reset only AFTER a successful parse that produced rows
                # (guarded below), so a wrong or empty workbook can never empty
                # the table.
                reset_path = "/bm-daily/sync/reset"
            else:
                rows, skipped = _build_alt_barcode_rows(df)
                api_path = "/alt-barcodes/sync"
                kind     = "alt_barcodes"

            if not rows:
                self._json(400, {"error": "No valid rows found in file."})
                return

            if reset_path:
                rr = requests.post(f"{BASE_URL}/api{reset_path}", json={},
                                   headers={"X-Sync-Secret": secret},
                                   timeout=120)
                rr.raise_for_status()

            result = _post_chunks(api_path, rows, secret)
            result["total_rows"] = len(df)
            result["skipped"]    = result.get("skipped", 0) + skipped
            _record_run(kind, "Manual upload", result["written"], result["skipped"], "ok", secret)
            try:
                requests.post(f"{BASE_URL}/api/product-master/refresh", json={},
                              headers={"X-Sync-Secret": secret},
                              timeout=120).raise_for_status()
            except Exception as e:
                _log(f"product-master refresh failed: {e}")
            self._json(200, result)

        except Exception as exc:
            self._json(500, {"error": str(exc)})

    def _json(self, code: int, body: dict):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        _log(f"{fmt % args}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("localhost", PORT), Handler)
    # ASCII only. These lines used a "->" arrow character, and a Windows
    # console is cp1252, so printing them raised UnicodeEncodeError *before*
    # serve_forever() was ever reached: the server announced "Listening", died
    # on the next line, and every manual upload in the admin page failed with
    # "Local upload server is not running". Keep console output ASCII.
    _log("Listening on http://localhost:%d" % PORT)
    _log("GET  /health               -> readiness probe")
    _log("POST /upload-prices        -> prices table")
    _log("POST /upload-alt-barcodes  -> alt_barcodes table")
    _log("POST /upload-bm-daily      -> bm_daily_file table")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _log("Stopped.")
