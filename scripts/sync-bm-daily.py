r"""
B&M Daily File sync, from B&M's SFTP product file (replaces the Excel-based
sync-bm-daily.ps1, which is kept as a manual fallback: run_sync.bat bm-daily-excel).

Every run:
  1. Lists "Inbound File/Product File" on the B&M SFTP server (the same server
     and login as the delivery manifests) and picks the newest HSVPRD*.CSV.
     Read-only: nothing on the server is moved or deleted.
  2. If that file was already synced, stops (the scheduled task runs every
     30 min from 07:00 to 12:00, so today's file is picked up as soon as it
     lands). If today's file is still missing on the last run of the window,
     the run is reported as failed on Admin -> Settings -> Data Sync.
  3. Saves the original CSV, unchanged, to ...\Data\Product File CSV.
  4. Builds the B&M Daily Excel (HomeSavers_YYYYMMDD.xlsx, date from the CSV
     name) into ...\Data\B&M Product File Excel\<year>. Never overwrites a
     file that is already there.
  5. Uploads the ProductIDs (Grp/SubGrp + Item + Option, e.g. 01-01-000-00)
     to bm_daily_file, the same API calls as the old job.

    "<python>" sync-bm-daily.py                 normal run
    "<python>" sync-bm-daily.py --dry-run       read + build, no upload, no copies
    "<python>" sync-bm-daily.py --force         re-sync the newest file even if done
    "<python>" sync-bm-daily.py --file X.CSV    use a local CSV instead of SFTP
    "<python>" sync-bm-daily.py --list          show the SFTP folder and stop
"""
from __future__ import annotations

import argparse
import base64
import csv
import datetime as dt
import hashlib
import io
import json
import os
import posixpath
import re
import shutil
import stat
import sys
import time

# ── Settings ────────────────────────────────────────────────────────────────

SFTP_HOST          = "192.168.1.77"     # LAN address; the public one does not loop back inside the office
SFTP_PORT          = 22
SFTP_USER          = "bandm"
SFTP_REMOTE_DIR    = "Inbound File/Product File"
SFTP_PASSWORD_FILE = r"C:\Homesavers\.manifest-sftp-password"   # same login as the manifests
SFTP_KNOWN_HOSTS   = r"C:\Homesavers\manifest-sftp-known_hosts"
SFTP_SETTLE_SECS   = 120                # skip a file modified this recently: still uploading

INBOUND_DIR = r"C:\Homesavers\bm-daily-inbound"
STATE_FILE  = r"C:\Homesavers\bm-daily-state.json"
LOG_FILE    = r"C:\Homesavers\logs\sync-bm-daily.log"
BASE_URL    = "https://homesaversscanner.pages.dev"
SECRET_FILE = r"C:\Homesavers\.sync-secret"

# \\192.168.1.205\Buying Data is B: on the rebuilt PC (Y: on the old one).
_DATA = r"Supply Chain & Buying - Shared\Data"
CSV_DIRS   = [rf"\\192.168.1.205\Buying Data\{_DATA}\Product File CSV",
              rf"B:\{_DATA}\Product File CSV"]
EXCEL_BASE = [rf"\\192.168.1.205\Buying Data\{_DATA}\B&M Product File Excel",
              rf"B:\{_DATA}\B&M Product File Excel"]       # + \<year>

LAST_CALL  = dt.time(11, 30)   # the last run of the 07:00-12:00 window
CHUNK      = 5000
MIN_SHARE  = 0.5               # refuse a file with < half the previous product count

FILE_RE = re.compile(r"^HSVPRD(\d{8})(\d{6})\.CSV$", re.IGNORECASE)


# ── Helpers ─────────────────────────────────────────────────────────────────

def log(msg, level="INFO"):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass   # pythonw has no console
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_FILE)


def secret_headers():
    with open(SECRET_FILE, encoding="utf-8") as f:
        secret = f.read().strip()
    if not secret:
        raise RuntimeError(f"{SECRET_FILE} is empty")
    return {"X-Sync-Secret": secret, "Content-Type": "application/json"}


def record_run(*, file_name, total, imported, skipped, status, message, started_at):
    """Show the run on Admin -> Settings -> Data Sync. Best-effort."""
    try:
        import requests
        requests.post(f"{BASE_URL}/api/sync-runs", headers=secret_headers(), timeout=30, json={
            "kind": "bm_daily", "file_name": file_name, "file_size_bytes": total,
            "records_imported": imported, "records_skipped": skipped,
            "status": status, "message": message, "started_at": started_at,
        })
    except Exception as e:
        log(f"Could not record the run on the dashboard: {e}", "WARN")


def file_date(name):
    m = FILE_RE.match(name)
    return dt.datetime.strptime(m.group(1), "%Y%m%d").date() if m else None


def first_dir(candidates):
    """First candidate folder that exists (or whose parent exists, then created)."""
    for p in candidates:
        if os.path.isdir(p):
            return p
    for p in candidates:
        if os.path.isdir(os.path.dirname(p)):
            os.makedirs(p, exist_ok=True)
            return p
    return None


# ── SFTP ────────────────────────────────────────────────────────────────────

def sftp_connect():
    """Password login; host key pinned on first use (shared with the manifest job)."""
    import paramiko
    with open(SFTP_PASSWORD_FILE, encoding="utf-8") as f:
        password = f.read().strip()
    client = paramiko.SSHClient()
    first_use = not os.path.exists(SFTP_KNOWN_HOSTS)
    if first_use:
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.load_host_keys(SFTP_KNOWN_HOSTS)
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(SFTP_HOST, port=SFTP_PORT, username=SFTP_USER, password=password,
                       timeout=30, banner_timeout=30, auth_timeout=30,
                       allow_agent=False, look_for_keys=False)
    except paramiko.BadHostKeyException:
        log(f"SFTP host key for {SFTP_HOST} has CHANGED - refusing to connect. If the server "
            f"was really changed, delete {SFTP_KNOWN_HOSTS} and run again.", "ERROR")
        raise
    if first_use:
        key = client.get_transport().get_remote_server_key()
        client.save_host_keys(SFTP_KNOWN_HOSTS)
        fp = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")
        log(f"SFTP host key saved on first connect: {key.get_name()} SHA256:{fp}")
    return client, client.open_sftp()


def sftp_newest(sftp, remote_dir):
    """Newest settled HSVPRD file: (attr, name). Ordered by the date+time in its name."""
    now = time.time()
    best = None
    for a in sftp.listdir_attr(remote_dir):
        if stat.S_ISDIR(a.st_mode) or not FILE_RE.match(a.filename):
            continue
        if now - a.st_mtime < SFTP_SETTLE_SECS:
            log(f"SFTP: {a.filename} modified under {SFTP_SETTLE_SECS}s ago - leaving it for the next run")
            continue
        key = FILE_RE.match(a.filename).group(1) + FILE_RE.match(a.filename).group(2)
        if best is None or key > best[0]:
            best = (key, a)
    return best[1] if best else None


def sftp_download(sftp, remote_dir, a):
    os.makedirs(INBOUND_DIR, exist_ok=True)
    local = os.path.join(INBOUND_DIR, a.filename)
    if not (os.path.exists(local) and os.path.getsize(local) == a.st_size):
        tmp = local + ".part"
        sftp.get(posixpath.join(remote_dir, a.filename), tmp)
        os.replace(tmp, local)
        os.utime(local, (a.st_mtime, a.st_mtime))
        log(f"SFTP: downloaded {a.filename} ({a.st_size:,} bytes)")
    return local


# ── CSV → product codes ─────────────────────────────────────────────────────

def read_csv(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    rows = list(csv.reader(io.StringIO(text, newline="")))
    if not rows:
        raise ValueError("empty file")
    header, data = rows[0], [r for r in rows[1:] if any(c.strip() for c in r)]
    want = ["Grp/SubGrp", "Item", "Option"]
    if [h.strip() for h in header[:3]] != want:
        raise ValueError(f"unexpected columns: {header[:3]} (expected {want})")
    return header, data


def product_id(row):
    g, item, opt = row[0].strip(), row[1].strip(), row[2].strip()
    if not (len(g) == 4 and g.isdigit() and item.isdigit() and opt.isdigit()):
        return None
    return f"{g[:2]}-{g[2:]}-{item.zfill(3)}-{opt.zfill(2)}"


# ── Excel ───────────────────────────────────────────────────────────────────

def build_excel(header, data, path):
    """B&M Daily Excel. Layout: see EXCEL LAYOUT notes in Project_Status.MD."""
    from openpyxl import Workbook
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("First Sheet")
    fixed = header[:-1]                              # everything before "Barcode list"
    n_extra = max(len(r) for r in data) - len(fixed)
    ws.append(["ProductID"] + fixed + [f"Barcode {i}" for i in range(1, n_extra + 1)])
    for r in data:
        ws.append([product_id(r)] + [c.strip() for c in r])
    tmp = path + ".part.xlsx"
    wb.save(tmp)
    os.replace(tmp, path)


# ── Upload ──────────────────────────────────────────────────────────────────

def upload(codes):
    import requests
    h = secret_headers()

    def post(path, body=None, timeout=300):
        for attempt in range(4):
            try:
                r = requests.post(f"{BASE_URL}/api{path}", headers=h, data=body, timeout=timeout)
                if r.status_code >= 500 and attempt < 3:
                    raise RuntimeError(f"HTTP {r.status_code}")
                r.raise_for_status()
                return r.json()
            except (requests.ConnectionError, requests.Timeout, RuntimeError) as e:
                if attempt == 3:
                    raise
                log(f"{path}: {e} - retrying", "WARN")
                time.sleep(2 ** (attempt + 1))

    post("/bm-daily/sync/reset", timeout=120)
    written = 0
    for i in range(0, len(codes), CHUNK):
        resp = post("/bm-daily/sync", json.dumps(codes[i:i + CHUNK]))
        written += int(resp.get("written", 0))
        log(f"Chunk {i // CHUNK + 1}: written={resp.get('written')}")
    return written


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Read and build only: no upload, no copies to the share.")
    ap.add_argument("--force", action="store_true", help="Sync the newest file even if it was already synced.")
    ap.add_argument("--file", help="Use this local HSVPRD CSV instead of SFTP.")
    ap.add_argument("--list", action="store_true", help="List the SFTP folder and stop.")
    ap.add_argument("--excel-out", help="Write the Excel here instead of the share (testing).")
    args = ap.parse_args()

    started = dt.datetime.now(dt.timezone.utc).isoformat()
    state = load_state()
    name = None
    log("=== B&M Daily sync (SFTP CSV) starting ===")
    try:
        if args.file:
            local, name = args.file, os.path.basename(args.file)
            if not FILE_RE.match(name):
                raise ValueError(f"{name} is not an HSVPRD<date><time>.CSV file")
        else:
            client, sftp = sftp_connect()
            try:
                if args.list:
                    for a in sorted(sftp.listdir_attr(SFTP_REMOTE_DIR), key=lambda a: a.st_mtime):
                        print(f"{dt.datetime.fromtimestamp(a.st_mtime):%Y-%m-%d %H:%M}  {a.st_size:>12,}  {a.filename}")
                    return 0
                a = sftp_newest(sftp, SFTP_REMOTE_DIR)
                if a is None:
                    raise RuntimeError(f"no HSVPRD*.CSV files in SFTP '{SFTP_REMOTE_DIR}'")
                name = a.filename
                if name == state.get("last_file") and not args.force and not args.dry_run:
                    today = dt.date.today()
                    late = dt.datetime.now().time() >= LAST_CALL
                    if file_date(name) < today and late and state.get("warned") != today.isoformat():
                        msg = (f"Today's B&M product file has not arrived on SFTP by "
                               f"{LAST_CALL:%H:%M}; still using {name}")
                        log(msg, "WARN")
                        record_run(file_name=name, total=0, imported=0, skipped=0,
                                   status="error", message=msg, started_at=started)
                        state["warned"] = today.isoformat(); save_state(state)
                    else:
                        log(f"Newest file {name} is already synced - nothing to do")
                    return 0
                local = sftp_download(sftp, SFTP_REMOTE_DIR, a)
            finally:
                sftp.close(); client.close()

        header, data = read_csv(local)
        codes, bad = [], 0
        seen = set()
        for r in data:
            pid = product_id(r)
            if pid is None:
                bad += 1
            elif pid not in seen:
                seen.add(pid); codes.append(pid)
        log(f"{name}: {len(data):,} rows, {len(codes):,} product IDs, {bad} unreadable")
        prev = int(state.get("last_count") or 0)
        if not codes:
            raise RuntimeError("no product IDs in the file - not touching the table")
        if prev and len(codes) < prev * MIN_SHARE and not args.force:
            raise RuntimeError(f"only {len(codes):,} products against {prev:,} last time - "
                               "looks like a broken file; not touching the table (--force to override)")

        fdate = file_date(name)
        xlsx_name = f"HomeSavers_{fdate:%Y%m%d}.xlsx"
        notes = []
        if args.dry_run:
            out = args.excel_out or os.path.join(INBOUND_DIR, xlsx_name)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            build_excel(header, data, out)
            log(f"Dry run: Excel written to {out}; first IDs {', '.join(codes[:5])}")
            log("=== Dry run complete (nothing uploaded or copied) ===")
            return 0

        # Copies on the share. A failure here is reported but never blocks the upload.
        csv_dir = first_dir(CSV_DIRS)
        if not csv_dir:
            notes.append("CSV copy NOT saved (share not reachable)")
        else:
            dest = os.path.join(csv_dir, name)
            if os.path.exists(dest):
                log(f"CSV copy already there: {dest}")
            else:
                shutil.copy2(local, dest); log(f"CSV copy saved: {dest}")
        xl_dir = args.excel_out or first_dir([os.path.join(b, f"{fdate:%Y}") for b in EXCEL_BASE])
        if not xl_dir:
            notes.append("Excel NOT saved (share not reachable)")
        else:
            dest = os.path.join(xl_dir, xlsx_name)
            if os.path.exists(dest):
                log(f"Excel already there, left as it is: {dest}")
            else:
                build_excel(header, data, dest); log(f"Excel saved: {dest}")
        for n in notes:
            log(n, "WARN")

        written = upload(codes)
        msg = f"Imported {written:,} ProductIDs from {name} (SFTP)" + (f"; {'; '.join(notes)}" if notes else "")
        record_run(file_name=name, total=len(codes), imported=written, skipped=bad,
                   status="ok", message=msg, started_at=started)
        # Never move "last synced" backwards (a manual --file run of an older CSV).
        if name.upper() >= (state.get("last_file") or "").upper():
            state.update(last_file=name, last_count=len(codes))
        state["synced_at"] = dt.datetime.now().isoformat(timespec="seconds")
        save_state(state)
        log("=== B&M Daily sync finished OK ===")
        return 0
    except Exception as e:
        log(f"FAILED: {e}", "ERROR")
        if args.dry_run or args.list:
            return 1
        record_run(file_name=name, total=0, imported=0, skipped=0,
                   status="error", message=str(e), started_at=started)
        return 1


if __name__ == "__main__":
    sys.exit(main())
