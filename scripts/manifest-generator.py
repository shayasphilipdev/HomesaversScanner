"""
Homesavers Scanner - Delivery Manifest generator (local scheduled job)

Picks up each new HSVMAN delivery CSV, looks up Group / Subgroup / Product ID from
the latest ItemMaster (by Short Code = Ud_ImageName), and writes a formatted Excel
manifest that matches the agreed sample:

    Sheets:  Delivery Summary  ->  Master  ->  one sheet per store (alphabetical)

Reads only (no database). All work is local on the back-office PC, like the sync jobs.

Folders:
    INPUT       SFTP 93.107.17.189:2222 -> C:\\Homesavers\\manifest-inbound   (HSVMAN*.csv)
                (falls back to U:\\...\\Live\\Inbound file\\Delivery Manifest when
                 C:\\Homesavers\\.manifest-sftp-password does not exist)
    ITEMMASTER  Y:\\...\\ProductMaster\\2026, else the same folder by UNC path   (latest ItemMaster*.xlsx)
    OUTPUT      Y:\\Supply Chain\\SUPPLY CHAIN 2026\\STORE MANIFEST, else by UNC path if that exists

Run:
    py manifest-generator.py                 # process every NEW HSVMAN (output not already present)
    py manifest-generator.py --dry-run       # build the newest one to a local preview folder, no Y: write
    py manifest-generator.py --file "<path>" # force-process one HSVMAN file
    py manifest-generator.py --sftp-list     # show which SFTP folders hold HSVMAN files (changes nothing)
"""
from __future__ import annotations

import argparse
import base64
import csv
import datetime as dt
import glob
import hashlib
import os
import posixpath
import re
import stat
import sys
import time

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ── Folders ─────────────────────────────────────────────────────────────────
INPUT_DIR      = r"U:\Finance Dept-Shared Folder\B&M - Homesavers Shared Database\Live\Inbound file\Delivery Manifest"
# Y: is \\192.168.1.205\Buying Data on the office PCs. The UNC forms work when
# no drive is mapped (a scheduled task running whether logged on or not). The
# output UNC is only used if that folder already exists - never created blind.
ITEMMASTER_DIRS = [r"Y:\Supply Chain & Buying - Shared\Data\VRSDAILYDATADUMP\ProductMaster\2026",
                   r"\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\VRSDAILYDATADUMP\ProductMaster\2026"]
OUTPUT_DIRS     = [r"Y:\Supply Chain\SUPPLY CHAIN 2026\STORE MANIFEST",
                   r"\\192.168.1.205\Buying Data\Supply Chain\SUPPLY CHAIN 2026\STORE MANIFEST"]
PREVIEW_DIR    = r"C:\Homesavers\manifest-preview"

# B&M's SFTP drop for the HSVMAN files. Used whenever the password file exists.
SFTP_HOST          = "93.107.17.189"
SFTP_PORT          = 2222
SFTP_USER          = "bandm"
SFTP_REMOTE_DIR    = ""   # set once --sftp-list has shown where the HSVMAN files live
SFTP_PASSWORD_FILE = r"C:\Homesavers\.manifest-sftp-password"
SFTP_KNOWN_HOSTS   = r"C:\Homesavers\manifest-sftp-known_hosts"
SFTP_INBOUND_DIR   = r"C:\Homesavers\manifest-inbound"
SFTP_SETTLE_SECS   = 120  # skip files modified this recently: B&M may still be uploading them
LOG_FILE       = r"C:\Homesavers\logs\manifest-generator.log"

# Run reporting — same pipeline as the Alt-Barcode / Prices syncs, so manifest
# runs show up in Admin -> Settings -> Data Sync.
BASE_URL       = "https://homesaversscanner.pages.dev"
SECRET_FILE    = r"C:\Homesavers\.sync-secret"

# ── Styling (matches the sample workbook) ───────────────────────────────────
FONT_TITLE  = Font(name="Calibri", size=16, bold=True)
FONT_HEAD   = Font(name="Calibri", size=10, bold=True, color="FF000000")
FONT_BOLD   = Font(name="Calibri", size=11, bold=True)
FONT_BODY   = Font(name="Calibri", size=11)
FILL_BLUE   = PatternFill(fill_type="solid", fgColor="FFD9E1F2")  # serial/store/cases/pallets
FILL_AMBER  = PatternFill(fill_type="solid", fgColor="FFFFC000")  # expected arrival
FILL_PEACH  = PatternFill(fill_type="solid", fgColor="FFFCE4D6")  # actual arrival
FILL_YELLOW = PatternFill(fill_type="solid", fgColor="FFFFFF00")  # Master header row
FONT_MHEAD  = Font(name="Calibri", size=11, bold=True)
CENTER      = Alignment(horizontal="center", wrap_text=True)
CENTER_NW   = Alignment(horizontal="center")
LEFT        = Alignment(horizontal="left")
_THIN       = Side(style="thin")
BORDER      = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
BOTTOM      = Border(bottom=_THIN)


# ── Helpers ─────────────────────────────────────────────────────────────────

def log(msg, level="INFO"):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def record_run(*, file_name, file_size, imported, skipped, status, message, started_at):
    """Report a run to /api/sync-runs (kind 'manifest') so it shows in
    Settings -> Data Sync. Best-effort: a network problem must never stop
    manifest generation, so every failure here is a warning only."""
    try:
        import requests
        with open(SECRET_FILE, encoding="utf-8") as f:
            secret = f.read().strip()
        requests.post(
            f"{BASE_URL}/api/sync-runs",
            headers={"X-Sync-Secret": secret, "Content-Type": "application/json"},
            json={
                "kind":             "manifest",
                "file_name":        file_name,
                "file_size_bytes":  file_size,
                "records_imported": imported,
                "records_skipped":  skipped,
                "status":           status,
                "message":          message,
                "started_at":       started_at,
            },
            timeout=20,
        )
    except Exception as e:
        log(f"Could not record run to dashboard: {e}", "WARN")


def read_text(path):
    """Read a CSV as text, tolerating UTF-8 (with/without BOM) or Windows-1252."""
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(path, "r", encoding="latin-1", errors="replace", newline="") as f:
        return f.read()


def norm_code(v):
    """Normalise a Short Code / Ud_ImageName to a comparable string (digits, no leading zeros)."""
    if v is None:
        return ""
    s = str(v).strip()
    if s == "":
        return ""
    if re.fullmatch(r"\d+", s):
        return str(int(s))          # drop leading zeros so '0402700' == '402700'
    return s.upper()


def to_int(v, default=0):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return default


def sanitize_sheet_name(name, used):
    clean = re.sub(r"[:\\/?*\[\]]", "_", str(name))[:31]
    base, i = clean, 2
    while clean in used or clean == "":
        suffix = f"_{i}"
        clean = (base[:31 - len(suffix)] + suffix)
        i += 1
    used.add(clean)
    return clean


# ── HSVMAN parsing ──────────────────────────────────────────────────────────

def parse_hsvman(path):
    """Return (header dict, list of ITM dicts). Raw file: quoted, no header, HDR/ITM/TRL rows."""
    rows = list(csv.reader(read_text(path).splitlines()))
    header, items = {}, []
    for r in rows:
        if not r:
            continue
        tag = (r[0] or "").strip().upper()
        if tag == "HDR" and len(r) >= 5:
            header = {
                "dc_name":       r[1].strip(),
                "load_no":       r[2].strip(),
                "trailer_id":    r[3].strip(),
                "trailer_short": r[4].strip(),
            }
        elif tag == "ITM" and len(r) >= 9:
            items.append({
                "pallet_id":   r[1].strip(),
                "store_name":  r[2].strip(),
                "short_code":  r[4].strip(),
                "item_name":   r[5].strip(),
                "total_cases": to_int(r[8]),
            })
        # TRL and anything else: ignore
    # Fall back to the filename for the load number if no HDR was present.
    if not header.get("load_no"):
        m = re.search(r"(LD\d+)", os.path.basename(path), re.IGNORECASE)
        header["load_no"] = m.group(1).upper() if m else "LD_UNKNOWN"
    header.setdefault("trailer_short", "")
    return header, items


def peek_header(path):
    """Cheap read of just the HDR row -> (load_no, trailer_short), to decide what's new."""
    with open(path, "r", encoding="latin-1", newline="") as f:
        first = f.readline()
    r = next(csv.reader([first]), [])
    is_hdr = len(r) > 4 and (r[0] or "").strip().upper() == "HDR"
    load_no = r[2].strip() if is_hdr else ""
    trailer = r[4].strip() if is_hdr else ""
    if not load_no:
        m = re.search(r"(LD\d+)", os.path.basename(path), re.IGNORECASE)
        load_no = m.group(1).upper() if m else "LD_UNKNOWN"
    return load_no, trailer


# ── ItemMaster lookup ───────────────────────────────────────────────────────

def load_itemmaster_lookup(path):
    """Build { norm(Ud_ImageName): (Product ID/EAN_Barcode, Group/ItemGroup, Subgroup/ItemSubGrp_Id) }."""
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    it = ws.iter_rows(values_only=True)
    header = next(it)
    want = ("Ud_ImageName", "EAN_Barcode", "ItemGroup", "ItemSubGrp_Id")
    idx = {h: i for i, h in enumerate(header) if h in want}
    missing = [w for w in want if w not in idx]
    if missing:
        wb.close()
        raise ValueError(f"ItemMaster missing columns {missing}. Found: {list(header)[:40]}")
    lookup = {}
    iU, iE, iG, iS = idx["Ud_ImageName"], idx["EAN_Barcode"], idx["ItemGroup"], idx["ItemSubGrp_Id"]
    for r in it:
        key = norm_code(r[iU])
        if not key or key in lookup:
            continue
        lookup[key] = (
            (str(r[iE]).strip() if r[iE] is not None else ""),
            (str(r[iG]).strip() if r[iG] is not None else ""),
            (str(r[iS]).strip() if r[iS] is not None else ""),
        )
    wb.close()
    return lookup


def latest(pattern_dir, pattern):
    files = glob.glob(os.path.join(pattern_dir, pattern))
    return max(files, key=os.path.getmtime) if files else None


def first_existing(paths):
    return next((p for p in paths if os.path.isdir(p)), None)


# ── SFTP inbound ────────────────────────────────────────────────────────────

def _is_hsvman(name):
    u = name.upper()
    return u.startswith("HSVMAN") and u.endswith(".CSV")


def sftp_connect():
    """Password login, with the server's host key pinned on first use: later
    connections are refused if the key changes, so nobody can impersonate it."""
    try:
        import paramiko
    except ImportError:
        log(f'paramiko is not installed. Run:  "{sys.executable}" -m pip install paramiko', "ERROR")
        sys.exit(1)
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
        log(f"SFTP host key for {SFTP_HOST} has CHANGED - refusing to connect. If B&M confirm they "
            f"changed their server, delete {SFTP_KNOWN_HOSTS} and run again.", "ERROR")
        raise
    if first_use:
        key = client.get_transport().get_remote_server_key()
        client.save_host_keys(SFTP_KNOWN_HOSTS)
        fp = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")
        log(f"SFTP host key saved on first connect: {key.get_name()} SHA256:{fp}")
    return client, client.open_sftp()


def sftp_list(start, max_depth=3, max_dirs=300):
    """Walk the SFTP tree and report which folders hold HSVMAN files."""
    client, sftp = sftp_connect()
    try:
        log(f"SFTP connected as {SFTP_USER}@{SFTP_HOST}:{SFTP_PORT}; home = {sftp.normalize('.')}")
        queue, visited, found = [(start, 0)], 0, []
        while queue and visited < max_dirs:
            path, depth = queue.pop(0)
            visited += 1
            try:
                entries = sftp.listdir_attr(path)
            except IOError as e:
                log(f"  cannot list {path}: {e}", "WARN"); continue
            hsv = [a for a in entries if not stat.S_ISDIR(a.st_mode) and _is_hsvman(a.filename)]
            if depth == 0:
                log("Top level: " + ", ".join(sorted(a.filename + ("/" if stat.S_ISDIR(a.st_mode) else "")
                                                      for a in entries))[:2000])
            if hsv:
                newest = max(hsv, key=lambda a: a.st_mtime)
                found.append(path)
                log(f"  {path}: {len(hsv)} HSVMAN file(s), newest {newest.filename} "
                    f"({dt.datetime.fromtimestamp(newest.st_mtime):%Y-%m-%d %H:%M})")
            if depth < max_depth:
                queue += [(posixpath.join(path, a.filename), depth + 1)
                          for a in entries if stat.S_ISDIR(a.st_mode)]
        if not found:
            log(f"No HSVMAN files found within {max_depth} folder levels of {start}.", "WARN")
    finally:
        sftp.close(); client.close()


def sftp_fetch(remote_dir, days, take_all):
    """Download new HSVMAN files into SFTP_INBOUND_DIR, keeping each file's
    server timestamp so the --days window means delivery time, not download time."""
    os.makedirs(SFTP_INBOUND_DIR, exist_ok=True)
    cutoff = dt.date.today() - dt.timedelta(days=max(0, days - 1))
    cutoff_ts = dt.datetime.combine(cutoff, dt.time()).timestamp()
    now = time.time()
    client, sftp = sftp_connect()
    got = 0
    try:
        for a in sftp.listdir_attr(remote_dir):
            if stat.S_ISDIR(a.st_mode) or not _is_hsvman(a.filename):
                continue
            if not take_all and a.st_mtime < cutoff_ts:
                continue
            if now - a.st_mtime < SFTP_SETTLE_SECS:
                log(f"SFTP: {a.filename} modified under {SFTP_SETTLE_SECS}s ago - leaving it for the next run")
                continue
            local = os.path.join(SFTP_INBOUND_DIR, a.filename)
            if os.path.exists(local) and os.path.getsize(local) == a.st_size:
                continue
            tmp = local + ".part"
            sftp.get(posixpath.join(remote_dir, a.filename), tmp)
            os.replace(tmp, local)
            os.utime(local, (a.st_mtime, a.st_mtime))
            got += 1
            log(f"SFTP: downloaded {a.filename} ({a.st_size:,} bytes)")
    finally:
        sftp.close(); client.close()
    log(f"SFTP: {got} new HSVMAN file(s) from {remote_dir}")


# ── Workbook building ───────────────────────────────────────────────────────

MASTER_HEADERS = ["Seq. No", "Load No", "Trailer ID", "Pallet ID", "Store Name", "Product ID",
                  "Short Code", "Item Name", "Total Cases", "Group", "Subgroup",
                  "Additional Comments", "Product ID"]
STORE_HEADERS  = ["Load No", "Trailer ID", "Pallet ID", "Store Name", "Product ID", "Short Code",
                  "Item Name", "Total Cases", "Group", "Subgroup", "firl1"]
MASTER_WIDTHS  = [8, 12.9, 13.7, 14.7, 22.7, 14.7, 15.7, 30.3, 16, 24.9, 28.7, 36.7, 14.7]
STORE_WIDTHS   = [12, 11, 16, 22, 14.7, 12, 30, 12, 16, 28, 8]


def enrich(items, lookup):
    """Attach Product ID / Group / Subgroup to each ITM row from the ItemMaster lookup.
    Unmatched short codes are flagged and shown as 'Not in Item Master' in the output."""
    out = []
    for it in items:
        hit = lookup.get(norm_code(it["short_code"]))
        row = dict(it)
        row["matched"] = hit is not None
        row["product_id"], row["group"], row["subgroup"] = hit if hit else ("Not in Item Master", "", "")
        row["short_int"] = to_int(it["short_code"], None)
        out.append(row)
    return out


def build_workbook(header, rows):
    load_no = header["load_no"]
    trailer = header.get("trailer_short") or ""

    # Store order = first appearance in the data (summary + pallet list);
    # per-store sheets are alphabetical (as in the sample).
    order, seen = [], set()
    for r in rows:
        s = r["store_name"]
        if s not in seen:
            seen.add(s); order.append(s)
    cases = {s: 0 for s in order}
    pallets = {s: [] for s in order}
    rowcount = {s: 0 for s in order}
    for r in rows:
        s = r["store_name"]
        cases[s] += r["total_cases"]
        rowcount[s] += 1
        if r["pallet_id"] and r["pallet_id"] not in pallets[s]:
            pallets[s].append(r["pallet_id"])

    ref_store = max(rowcount, key=rowcount.get) if rowcount else None   # most rows -> firl1 False

    wb = Workbook()
    _build_summary(wb.active, load_no, trailer, order, cases, pallets)
    _build_master(wb.create_sheet("Master"), load_no, trailer, rows, ref_store)
    used = {"Delivery Summary", "Master"}
    for store in sorted(order):
        ws = wb.create_sheet(sanitize_sheet_name(store, used))
        _build_store(ws, load_no, trailer, [r for r in rows if r["store_name"] == store])
    return wb, load_no, trailer


def _build_summary(ws, load_no, trailer, order, cases, pallets):
    ws.title = "Delivery Summary"
    ws.sheet_view.showGridLines = False
    ws["A2"] = f"Delivery Summary - {load_no} - {trailer}"
    ws["A2"].font = FONT_TITLE
    ws.row_dimensions[2].height = 28

    # Left table: Store Name | Total Cases.
    ws["A5"] = "Store Name"; ws["B5"] = "Total Cases."
    ws["A5"].font = ws["B5"].font = FONT_BODY
    r = 6
    for s in order:
        ws.cell(r, 1, s).font = FONT_BODY; ws.cell(r, 1).alignment = LEFT
        ws.cell(r, 2, cases[s]).font = FONT_BODY
        r += 1
    ws.cell(r, 1, "Grand Total").font = FONT_BODY
    ws.cell(r, 2, sum(cases.values())).font = FONT_BODY

    # Right table: heading + a bordered grid whose colour blocks run DOWN through
    # the data rows (Expected=amber, Actual=peach, Status=white) — matches sample.
    ws["D4"] = "Delivery Summary by Store"; ws["D4"].font = FONT_TITLE
    rt_heads = ["Serial no.", "Store Name", "Total Cases", "Total Pallets",
                "Expected Day of Arrival at Dublin Port", "Expected Time of Arrival at Dublin Port",
                "Actual Day of Arrival to stores", "Actual Time of Arrival to stores", "Delivery Status"]
    hdr_fill  = {4: FILL_BLUE, 5: FILL_BLUE, 6: FILL_BLUE, 7: FILL_BLUE,
                 8: FILL_AMBER, 9: FILL_AMBER, 10: FILL_PEACH, 11: FILL_PEACH, 12: None}
    data_fill = {8: FILL_AMBER, 9: FILL_AMBER, 10: FILL_PEACH, 11: FILL_PEACH}
    for col in range(4, 13):
        c = ws.cell(6, col, rt_heads[col - 4])
        c.font = FONT_HEAD; c.alignment = CENTER; c.border = BORDER
        if hdr_fill[col]:
            c.fill = hdr_fill[col]
    ws.row_dimensions[6].height = 40
    rr = 7
    for i, s in enumerate(order, start=1):
        ws.cell(rr, 4, i); ws.cell(rr, 5, s); ws.cell(rr, 6, cases[s]); ws.cell(rr, 7, len(pallets[s]))
        for col in range(4, 13):
            c = ws.cell(rr, col)
            c.font = FONT_BODY; c.alignment = CENTER_NW; c.border = BORDER
            if col in data_fill:
                c.fill = data_fill[col]
        rr += 1
    ws.cell(rr, 5, "Grand Total"); ws.cell(rr, 6, sum(cases.values()))
    ws.cell(rr, 7, sum(len(p) for p in pallets.values()))
    for col in (4, 5, 6, 7):
        ws.cell(rr, col).font = FONT_BOLD; ws.cell(rr, col).alignment = CENTER_NW; ws.cell(rr, col).border = BOTTOM

    # Pallet list: 3 blank rows after the right table, then a heading + per-store blocks.
    pr = rr + 4
    ws.cell(pr, 1, "Store Name").font = FONT_BODY
    pr += 1
    for s in order:
        ws.cell(pr, 1, s).font = FONT_BOLD; ws.cell(pr, 1).alignment = LEFT; pr += 1
        for pid in pallets[s]:
            ws.cell(pr, 1, pid).font = FONT_BODY; ws.cell(pr, 1).alignment = LEFT; pr += 1
    ws.cell(pr, 1, "Grand Total").font = FONT_BOLD
    ws.cell(pr, 2, sum(len(p) for p in pallets.values())).font = FONT_BOLD

    for col, w in {"A": 25.4, "B": 12, "E": 20.6, "F": 9.6, "G": 10.4,
                   "H": 31, "I": 32, "J": 24.6, "K": 25.7, "L": 16.7}.items():
        ws.column_dimensions[col].width = w


def _build_master(ws, load_no, trailer, rows, ref_store):
    ws.sheet_view.showGridLines = False
    ws["A2"] = f"Manifest - {load_no} - {trailer}"; ws["A2"].font = FONT_TITLE
    for i, h in enumerate(MASTER_HEADERS):
        c = ws.cell(5, i + 1, h)
        c.font = FONT_MHEAD; c.fill = FILL_YELLOW; c.border = BORDER
    r = 6
    for seq, row in enumerate(rows, start=1):
        flag = (row["store_name"] != ref_store) if ref_store is not None else False
        vals = [seq, load_no, trailer, row["pallet_id"], row["store_name"], row["product_id"],
                row["short_int"], row["item_name"], row["total_cases"], row["group"],
                row["subgroup"], flag, row["product_id"]]
        for i, v in enumerate(vals):
            c = ws.cell(r, i + 1, v)
            c.font = FONT_BODY; c.border = BORDER
        r += 1
    for i, w in enumerate(MASTER_WIDTHS):
        ws.column_dimensions[get_column_letter(i + 1)].width = w


def _build_store(ws, load_no, trailer, rows):
    ws.sheet_view.showGridLines = False
    for i, h in enumerate(STORE_HEADERS):
        ws.cell(1, i + 1, h).font = FONT_BODY
    r = 2
    for row in rows:
        vals = [load_no, trailer, row["pallet_id"], row["store_name"], row["product_id"],
                row["short_int"], row["item_name"], row["total_cases"], row["group"],
                row["subgroup"], False]
        for i, v in enumerate(vals):
            ws.cell(r, i + 1, v).font = FONT_BODY
        r += 1
    for i, w in enumerate(STORE_WIDTHS):
        ws.column_dimensions[get_column_letter(i + 1)].width = w
    if ws.max_row >= 1:
        ws.auto_filter.ref = f"A1:K{ws.max_row}"   # filter dropdowns like the original


# ── Rejection report ────────────────────────────────────────────────────────

def rejection_name(load_no, trailer):
    return f"Manifest- {load_no} - {trailer} - Rejections.xlsx"


def write_rejections(rejects, load_no, trailer, out_dir):
    """One row per unmatched Short Code: Short Code | Description | Reason."""
    seen, uniq = set(), []
    for r in rejects:
        key = norm_code(r["short_code"])
        if key in seen:
            continue
        seen.add(key); uniq.append(r)

    wb = Workbook()
    ws = wb.active
    ws.title = "Rejections"
    ws.sheet_view.showGridLines = False
    ws["A2"] = f"Rejections - {load_no} - {trailer}"; ws["A2"].font = FONT_TITLE
    headers = ["Short Code", "Description", "Reason for Rejection"]
    for i, h in enumerate(headers):
        c = ws.cell(4, i + 1, h)
        c.font = FONT_MHEAD; c.fill = FILL_YELLOW; c.border = BORDER
    r = 5
    for row in uniq:
        vals = [row["short_int"] if row["short_int"] is not None else row["short_code"],
                row["item_name"],
                "This Short Code is not in the VRS Item Master"]
        for i, v in enumerate(vals):
            c = ws.cell(r, i + 1, v)
            c.font = FONT_BODY; c.border = BORDER
        r += 1
    for col, w in zip("ABC", (14, 36, 44)):
        ws.column_dimensions[col].width = w
    out_path = os.path.join(out_dir, rejection_name(load_no, trailer))
    wb.save(out_path)
    return out_path, len(uniq)


# ── Process one file ────────────────────────────────────────────────────────

def output_name(load_no, trailer):
    return f"Manifest- {load_no} - {trailer}.xlsx"


def process_file(path, lookup, out_dir, report=False):
    started_at = dt.datetime.now(dt.timezone.utc).isoformat()
    header, items = parse_hsvman(path)
    if not items:
        log(f"SKIP (no ITM rows): {os.path.basename(path)}", "WARN")
        if report:
            record_run(file_name=os.path.basename(path), file_size=None,
                       imported=0, skipped=0, status="error",
                       message="No ITM rows found in the HSVMAN file", started_at=started_at)
        return None
    rows = enrich(items, lookup)
    wb, load_no, trailer = build_workbook(header, rows)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, output_name(load_no, trailer))
    wb.save(out_path)
    matched = sum(1 for r in rows if r["matched"])
    rate = 100.0 * matched / len(rows) if rows else 0.0
    stores = len({r["store_name"] for r in rows})
    log(f"WROTE {os.path.basename(out_path)} | rows={len(rows)} stores={stores} match={rate:.1f}%")
    rejects = [r for r in rows if not r["matched"]]
    n_rej = 0
    if rejects:
        rej_path, n_rej = write_rejections(rejects, load_no, trailer, out_dir)
        log(f"WROTE {os.path.basename(rej_path)} | {n_rej} short code(s) not in the VRS Item Master", "WARN")
    if report:
        msg = f"{stores} store(s), {rate:.1f}% matched, source {os.path.basename(path)}"
        if n_rej:
            msg += f" - {n_rej} short code(s) not in Item Master (see Rejections file)"
        record_run(file_name=os.path.basename(out_path),
                   file_size=os.path.getsize(out_path),
                   imported=len(rows), skipped=len(rejects),
                   status="ok", message=msg, started_at=started_at)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Write to a local preview folder instead of Y:.")
    ap.add_argument("--file", help="Force-process one HSVMAN file path.")
    ap.add_argument("--days", type=int, default=2, help="Only consider HSVMAN files from the last N days (default 2 = yesterday+today).")
    ap.add_argument("--all", action="store_true", help="Ignore the day window (process every HSVMAN; full backfill).")
    ap.add_argument("--sftp-list", nargs="?", const=".", metavar="PATH",
                    help="List which SFTP folders hold HSVMAN files, then exit. Changes nothing.")
    ap.add_argument("--sftp-dir", help="Override SFTP_REMOTE_DIR for this run.")
    ap.add_argument("--sftp-host", help="Override SFTP_HOST for this run (e.g. the server's internal LAN address).")
    ap.add_argument("--sftp-port", type=int, help="Override SFTP_PORT for this run.")
    args = ap.parse_args()

    # From inside the office the public address doesn't loop back (no NAT
    # hairpin), so the server is reached on its LAN address instead.
    global SFTP_HOST, SFTP_PORT
    if args.sftp_host:
        SFTP_HOST = args.sftp_host
    if args.sftp_port:
        SFTP_PORT = args.sftp_port

    log("=== Manifest generator starting ===")
    use_sftp = os.path.exists(SFTP_PASSWORD_FILE)
    if args.sftp_list is not None:
        if not use_sftp:
            log(f"No SFTP password file at {SFTP_PASSWORD_FILE}", "ERROR"); sys.exit(1)
        sftp_list(args.sftp_list)
        log("=== Manifest generator finished ==="); return

    itemmaster_dir = first_existing(ITEMMASTER_DIRS)
    im_path = latest(itemmaster_dir, "ItemMaster*.xlsx") if itemmaster_dir else None
    if not im_path:
        log(f"No ItemMaster found in any of {ITEMMASTER_DIRS}", "ERROR"); sys.exit(1)

    def get_lookup():
        log(f"ItemMaster: {os.path.basename(im_path)}")
        try:
            lk = load_itemmaster_lookup(im_path)
        except Exception as e:
            log(f"Could not load ItemMaster: {e}", "ERROR"); sys.exit(1)
        log(f"ItemMaster lookup rows: {len(lk):,}")
        return lk

    report  = not args.dry_run          # only live runs show in Settings -> Data Sync
    if args.dry_run:
        out_dir = PREVIEW_DIR
    else:
        out_dir = first_existing(OUTPUT_DIRS)
        if not out_dir:
            log(f"Output folder not reachable: {OUTPUT_DIRS[0]} (map Y: to \\\\192.168.1.205\\Buying Data)", "ERROR")
            sys.exit(1)

    if args.file:
        process_file(args.file, get_lookup(), out_dir, report=report)
        log("=== Manifest generator finished ==="); return

    input_dir = INPUT_DIR
    if use_sftp:
        remote_dir = args.sftp_dir or SFTP_REMOTE_DIR
        if not remote_dir:
            log("SFTP_REMOTE_DIR is not set yet - run with --sftp-list to find the HSVMAN folder.", "ERROR")
            sys.exit(1)
        try:
            sftp_fetch(remote_dir, args.days, args.all)
        except Exception as e:
            log(f"SFTP fetch failed: {e}", "ERROR")
            if report:
                record_run(file_name="SFTP fetch", file_size=None, imported=0, skipped=0,
                           status="error", message=f"SFTP fetch failed: {e}"[:300], started_at=None)
            sys.exit(1)
        input_dir = SFTP_INBOUND_DIR
    log(f"Input: {input_dir}")

    files = glob.glob(os.path.join(input_dir, "HSVMAN*.csv")) + glob.glob(os.path.join(input_dir, "HSVMAN*.CSV"))
    files = sorted(set(files), key=os.path.getmtime)
    if not args.all:
        cutoff = dt.date.today() - dt.timedelta(days=max(0, args.days - 1))
        files = [f for f in files if dt.date.fromtimestamp(os.path.getmtime(f)) >= cutoff]
    # Decide the work list BEFORE loading the 33MB ItemMaster (so idle runs are instant).
    # Live runs skip loads already generated; dry-runs always (re)build to preview.
    todo = []
    for f in files:
        ln, tr = peek_header(f)
        if args.dry_run or not os.path.exists(os.path.join(out_dir, output_name(ln, tr))):
            todo.append(f)
    if not todo:
        log("No HSVMAN files to process."); log("=== Manifest generator finished ==="); return
    log(f"{len(todo)} file(s) to process -> {out_dir}")
    lookup = get_lookup()
    done = 0
    for f in todo:
        try:
            if process_file(f, lookup, out_dir, report=report):
                done += 1
        except Exception as e:
            log(f"FAILED {os.path.basename(f)}: {e}", "ERROR")
            if report:
                record_run(file_name=os.path.basename(f), file_size=None,
                           imported=0, skipped=0, status="error",
                           message=str(e)[:300], started_at=None)
    log(f"Processed {done} manifest(s).")
    log("=== Manifest generator finished ===")


if __name__ == "__main__":
    main()
