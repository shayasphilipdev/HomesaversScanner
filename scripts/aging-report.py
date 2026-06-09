"""
Homesavers Scanner - Aging Report (scheduled email)

Emails management a dashboard of how long store-submitted records have been
sitting in PENDING status (today - created_at), so HO back-office turnaround can
be tracked. Three categories are reported separately:

    B = Non-Scans      C = Wrong Prices      D = Wrong Description

- Dashboard (counts per age bucket, per category, worst stores) goes in the
  EMAIL BODY.
- A detailed Excel file (.xlsx) per category is ATTACHED.

Reads pending records from the app's read-only endpoint:
    GET /api/reports/aging   (auth: X-Sync-Secret, same secret as the sync jobs)

Run:
    C:\\Scraping\\homesavers-scanner\\.venv\\Scripts\\python.exe aging-report.py
    python aging-report.py --dry-run          # build HTML, do NOT send
    python aging-report.py --to you@x.com     # send only to one address (test)

Config: aging-report.config.json (see aging-report.config.example.json).
Schedule it with Windows Task Scheduler (see README).
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import smtplib
import sys
from email.message import EmailMessage

import requests
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

# Resolve config + secret next to the script unless overridden.
HERE        = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("AGING_REPORT_CONFIG", os.path.join(HERE, "aging-report.config.json"))
SECRET_FILE = r"C:\Homesavers\.sync-secret"
LOG_FILE    = r"C:\Homesavers\logs\aging-report.log"

CATEGORIES = [("B", "Non-Scans"), ("C", "Wrong Prices"), ("D", "Wrong Description")]

DEFAULT_BUCKETS = [
    {"label": "0-1 days",  "min": 0,  "max": 1},
    {"label": "2-3 days",  "min": 2,  "max": 3},
    {"label": "4-7 days",  "min": 4,  "max": 7},
    {"label": "8-14 days", "min": 8,  "max": 14},
    {"label": "15+ days",  "min": 15, "max": None},
]


# -- helpers -------------------------------------------------------------------

def log(msg, level="INFO"):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_config():
    if not os.path.exists(CONFIG_PATH):
        log(f"Config not found: {CONFIG_PATH}", "ERROR")
        log("Copy aging-report.config.example.json -> aging-report.config.json and fill it in.", "ERROR")
        sys.exit(1)
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.setdefault("base_url", "https://homesaversscanner.pages.dev")
    cfg.setdefault("aging_buckets", DEFAULT_BUCKETS)
    cfg.setdefault("overdue_days", 3)
    cfg.setdefault("subject_prefix", "Homesavers Aging Report")
    return cfg


def read_secret():
    if not os.path.exists(SECRET_FILE):
        log(f"Secret file not found: {SECRET_FILE}", "ERROR")
        sys.exit(1)
    with open(SECRET_FILE, encoding="utf-8") as f:
        return f.read().strip()


def parse_iso(s):
    """Parse an ISO timestamp (with Z) to an aware datetime."""
    s = (s or "").replace("Z", "+00:00")
    try:
        return dt.datetime.fromisoformat(s)
    except ValueError:
        return None


def bucket_for(age_days, buckets):
    for b in buckets:
        lo = b.get("min", 0)
        hi = b.get("max", None)
        if age_days >= lo and (hi is None or age_days <= hi):
            return b["label"]
    return buckets[-1]["label"] if buckets else "?"


# -- core ----------------------------------------------------------------------

def fetch_records(cfg, secret):
    url = f"{cfg['base_url']}/api/reports/aging"
    resp = requests.get(url, headers={"X-Sync-Secret": secret}, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    return data.get("records", []), parse_iso(data.get("now")) or dt.datetime.now(dt.timezone.utc)


def enrich(records, now, buckets):
    """Add age_days + bucket to each record. Age = calendar days (today - created)."""
    today = now.date()
    out = []
    for r in records:
        created = parse_iso(r.get("created_at"))
        if not created:
            continue
        age = (today - created.date()).days
        if age < 0:
            age = 0
        rr = dict(r)
        rr["age_days"] = age
        rr["bucket"]   = bucket_for(age, buckets)
        rr["created_dt"] = created
        out.append(rr)
    return out


def build_html(by_cat, cfg, now):
    buckets = cfg["aging_buckets"]
    overdue = int(cfg["overdue_days"])
    bucket_labels = [b["label"] for b in buckets]

    total_all   = sum(len(v) for v in by_cat.values())
    overdue_all = sum(1 for v in by_cat.values() for x in v if x["age_days"] > overdue)
    oldest_all  = max((x["age_days"] for v in by_cat.values() for x in v), default=0)

    css = """
      body{font-family:Segoe UI,Arial,sans-serif;color:#1f2328;font-size:14px}
      h2{margin:18px 0 6px}
      table{border-collapse:collapse;margin:6px 0 16px;font-size:13px}
      th,td{border:1px solid #d0d7de;padding:6px 10px;text-align:left}
      th{background:#f3f0ea}
      td.n,th.n{text-align:right}
      .kpi{display:inline-block;border:1px solid #d0d7de;border-radius:8px;padding:10px 16px;margin:4px 8px 8px 0}
      .kpi b{display:block;font-size:22px}
      .muted{color:#6b7280}
      .bad{color:#b42318;font-weight:600}
    """

    def kpi(label, value, bad=False):
        cls = " bad" if bad else ""
        return f'<div class="kpi"><b class="{cls.strip()}">{value}</b><span class="muted">{label}</span></div>'

    html = [f"<html><head><style>{css}</style></head><body>"]
    html.append(f"<h2>Homesavers - Pending Records Aging</h2>")
    html.append(f'<div class="muted">As of {now.astimezone().strftime("%d/%m/%Y %H:%M")} - aging = today minus the date the store submitted the record (status still Pending).</div>')

    html.append("<div style='margin-top:10px'>")
    html.append(kpi("Total pending", total_all))
    html.append(kpi(f"Overdue (&gt;{overdue} days)", overdue_all, bad=overdue_all > 0))
    html.append(kpi("Oldest (days)", oldest_all, bad=oldest_all > overdue))
    html.append("</div>")

    # Per-category bucket breakdown
    html.append("<h2>By category &amp; age</h2>")
    html.append("<table><tr><th>Category</th>" + "".join(f'<th class="n">{l}</th>' for l in bucket_labels) +
                '<th class="n">Total</th><th class="n">Oldest</th></tr>')
    for code, name in CATEGORIES:
        rows = by_cat.get(code, [])
        counts = {l: 0 for l in bucket_labels}
        for x in rows:
            counts[x["bucket"]] = counts.get(x["bucket"], 0) + 1
        oldest = max((x["age_days"] for x in rows), default=0)
        tds = "".join(f'<td class="n">{counts[l] or ""}</td>' for l in bucket_labels)
        html.append(f'<tr><td>{name}</td>{tds}<td class="n"><b>{len(rows)}</b></td>'
                    f'<td class="n">{oldest}</td></tr>')
    html.append("</table>")

    # Worst stores (by overdue count, then oldest)
    store_stats = {}
    for code, name in CATEGORIES:
        for x in by_cat.get(code, []):
            k = (x["store_code"], x["store_name"])
            s = store_stats.setdefault(k, {"total": 0, "overdue": 0, "oldest": 0})
            s["total"] += 1
            if x["age_days"] > overdue:
                s["overdue"] += 1
            s["oldest"] = max(s["oldest"], x["age_days"])
    worst = sorted(store_stats.items(), key=lambda kv: (-kv[1]["overdue"], -kv[1]["oldest"]))[:15]
    if worst:
        html.append("<h2>Stores needing attention (top 15)</h2>")
        html.append('<table><tr><th>Store</th><th class="n">Pending</th>'
                    f'<th class="n">Overdue &gt;{overdue}d</th><th class="n">Oldest</th></tr>')
        for (code, nm), s in worst:
            label = f"{code} - {nm}" if code else nm
            od = f'<span class="bad">{s["overdue"]}</span>' if s["overdue"] else "0"
            html.append(f'<tr><td>{label}</td><td class="n">{s["total"]}</td>'
                        f'<td class="n">{od}</td><td class="n">{s["oldest"]}</td></tr>')
        html.append("</table>")

    html.append('<div class="muted" style="margin-top:14px">Detailed line-by-line records are attached as Excel files, one per category.</div>')
    html.append("</body></html>")
    return "\n".join(html)


def build_xlsx(rows):
    """Build an .xlsx workbook (as bytes) of the detailed pending rows."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Pending"
    ws.append(["Store Code", "Store Name", "Product Code", "Description",
               "Quantity", "Submitted (DD/MM/YYYY HH:MM)", "Age (days)"])
    for x in sorted(rows, key=lambda r: -r["age_days"]):
        submitted = x["created_dt"].astimezone().strftime("%d/%m/%Y %H:%M")
        ws.append([x["store_code"], x["store_name"],
                   str(x["product_code"]),          # text keeps leading zeros
                   x["description"], x["quantity"], submitted, x["age_days"]])
    for cell in ws[1]:                              # bold header row
        cell.font = Font(bold=True)
    for row in ws.iter_rows(min_row=2, min_col=3, max_col=3):  # product code = text
        for cell in row:
            cell.number_format = "@"
    ws.freeze_panes = "A2"
    for i, w in enumerate([12, 26, 16, 44, 10, 22, 10], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def send_email(cfg, html, attachments, recipients):
    smtp = cfg["smtp"]
    msg = EmailMessage()
    today = dt.date.today().strftime("%d/%m/%Y")
    msg["Subject"] = f'{cfg["subject_prefix"]} - {today}'
    msg["From"]    = smtp["from"]
    msg["To"]      = ", ".join(recipients)
    msg.set_content("This report needs an HTML-capable email client.")
    msg.add_alternative(html, subtype="html")

    for filename, blob in attachments:
        msg.add_attachment(
            blob,
            maintype="application",
            subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=filename,
        )

    host, port = smtp["host"], int(smtp.get("port", 587))
    security = (smtp.get("security") or "starttls").lower()
    if security == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=60) as s:
            if smtp.get("username"):
                s.login(smtp["username"], smtp["password"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=60) as s:
            if security == "starttls":
                s.starttls()
            if smtp.get("username"):
                s.login(smtp["username"], smtp["password"])
            s.send_message(msg)


# -- main ----------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Build the email but do not send; write HTML to disk.")
    ap.add_argument("--to", help="Send only to this address (overrides recipients) - for testing.")
    args = ap.parse_args()

    log("=== Aging report starting ===")
    cfg = load_config()
    secret = read_secret()

    try:
        records, now = fetch_records(cfg, secret)
    except Exception as e:
        log(f"Could not fetch aging data: {e}", "ERROR")
        sys.exit(1)
    log(f"Fetched {len(records)} pending B/C/D records.")

    enriched = enrich(records, now, cfg["aging_buckets"])
    by_cat = {code: [x for x in enriched if x["task_type"] == code] for code, _ in CATEGORIES}

    html = build_html(by_cat, cfg, now)

    attachments = []
    for code, name in CATEGORIES:
        rows = by_cat.get(code, [])
        if rows:
            fname = f"{name.replace(' ', '-')}-{dt.date.today():%Y%m%d}.xlsx"
            attachments.append((fname, build_xlsx(rows)))

    if args.dry_run:
        out = os.path.join(HERE, "aging-report-preview.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        log(f"DRY RUN - wrote preview to {out}; {len(attachments)} attachment(s) prepared. No email sent.")
        return

    recipients = [args.to] if args.to else cfg.get("recipients", [])
    recipients = [r for r in recipients if r]
    if not recipients:
        log("No recipients configured (config.recipients) and no --to given.", "ERROR")
        sys.exit(1)

    try:
        send_email(cfg, html, attachments, recipients)
        log(f"Sent aging report to {len(recipients)} recipient(s): {', '.join(recipients)}")
    except Exception as e:
        log(f"Failed to send email: {e}", "ERROR")
        sys.exit(1)

    log("=== Aging report finished OK ===")


if __name__ == "__main__":
    main()
