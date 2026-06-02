"""
Homesavers Scanner — local upload server
Listens on http://localhost:8765 and accepts Excel file uploads from the
browser admin page. Parses with pandas/openpyxl (same approach as the
daily sync) and posts rows to the Homesavers Scanner API.

Start automatically via Task Scheduler or run manually:
  C:\Scraping\PriceTracker\.venv\Scripts\python.exe local_upload_server.py
"""
from __future__ import annotations

import io
import json
import os
import pathlib
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import pandas as pd

# ── Config ────────────────────────────────────────────────────────────────────

PORT         = 8765
BASE_URL     = "https://homesaversscanner.pages.dev"
SECRET_FILE  = r"C:\Homesavers\.sync-secret"
CHUNK_SIZE   = 2000
ALLOWED_ORIGIN = "https://homesaversscanner.pages.dev"

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


def _post_chunks(api_path: str, rows: list, secret: str) -> dict:
    written = skipped = 0
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i:i + CHUNK_SIZE]
        body  = json.dumps(chunk).encode("utf-8")
        req   = urllib.request.Request(
            f"{BASE_URL}/api{api_path}",
            data=body,
            headers={"Content-Type": "application/json", "X-Sync-Secret": secret},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            r = json.loads(resp.read())
            written  += int(r.get("written", 0))
            skipped  += int(r.get("skipped", 0))
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
    return rows, skipped


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Sheet")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path not in ("/upload-prices", "/upload-alt-barcodes"):
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

            if path == "/upload-prices":
                rows, skipped = _build_prices_rows(df)
                api_path = "/prices/sync"
            else:
                rows, skipped = _build_alt_barcode_rows(df)
                api_path = "/alt-barcodes/sync"

            if not rows:
                self._json(400, {"error": "No valid rows found in file."})
                return

            result = _post_chunks(api_path, rows, secret)
            result["total_rows"] = len(df)
            result["skipped"]    = result.get("skipped", 0) + skipped
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
        print(f"[upload-server] {fmt % args}", flush=True)


# ── Missing import fix ────────────────────────────────────────────────────────
import urllib.parse


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"[upload-server] Listening on http://localhost:{PORT}", flush=True)
    print(f"[upload-server] POST /upload-prices        → prices table", flush=True)
    print(f"[upload-server] POST /upload-alt-barcodes  → alt_barcodes table", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[upload-server] Stopped.")
