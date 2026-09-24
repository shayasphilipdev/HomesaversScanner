#!/usr/bin/env python3
"""Weekly Department Check report — who did NOT do one last calendar week.

Sent Monday 09:00 about the PREVIOUS Monday-Sunday.

    GET /api/reports/dept-check-week   (auth: X-Sync-Secret, same secret as the
                                        sync jobs and the aging report)

Deliberately a SECOND script rather than another section bolted onto
aging-report.py: that one runs weekly on Wednesday at 08:00 about a completely
different subject (the pending query backlog), and the two want different
schedules, different recipients and different failure modes. One report per
invocation is the existing convention here -- deploy-scripts.ps1, the .cmd
wrappers and the Task Scheduler entries all assume it.

The endpoint works out which week "last week" is, so this script never does week
arithmetic. That matters at a year boundary, where ISO week numbering is its own
small minefield (2024-12-30 is week 1 of ISO-2025).

Usage:
    python dept-check-weekly.py                 # send
    python dept-check-weekly.py --dry-run       # build + write HTML, send nothing
    python dept-check-weekly.py --to me@x.ie    # send only to me (testing)
    python dept-check-weekly.py --week 2026-09-21   # a specific week's Monday
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import smtplib
import sys
from email.message import EmailMessage

import requests

# Resolve config + secret next to the script unless overridden. Same convention
# and the same secret file as aging-report.py.
HERE        = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("DEPT_CHECK_REPORT_CONFIG",
                             os.path.join(HERE, "dept-check-weekly.config.json"))
SECRET_FILE = r"C:\Homesavers\.sync-secret"
LOG_FILE    = r"C:\Homesavers\logs\dept-check-weekly.log"


# -- helpers -------------------------------------------------------------------

def log(msg, level="INFO"):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass  # never let logging break the report


def load_config():
    if not os.path.exists(CONFIG_PATH):
        log(f"Config not found: {CONFIG_PATH}", "ERROR")
        log("Copy dept-check-weekly.config.example.json and fill it in.", "ERROR")
        sys.exit(1)
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def read_secret():
    if not os.path.exists(SECRET_FILE):
        log(f"Secret file not found: {SECRET_FILE}", "ERROR")
        sys.exit(1)
    with open(SECRET_FILE, encoding="utf-8") as f:
        return f.read().strip()


def fetch(cfg, secret, week_monday=None):
    url = f"{cfg['base_url']}/api/reports/dept-check-week"
    params = {}
    if week_monday:
        # Explicit week: Monday 00:00 UTC through Sunday 23:59:59.999 UTC.
        start = dt.datetime.fromisoformat(week_monday).replace(tzinfo=dt.timezone.utc)
        end   = start + dt.timedelta(days=6, hours=23, minutes=59, seconds=59)
        params = {"from": start.isoformat(), "to": end.isoformat()}
    resp = requests.get(url, headers={"X-Sync-Secret": secret}, params=params, timeout=120)
    resp.raise_for_status()
    return resp.json()


# -- html ----------------------------------------------------------------------

def esc(v):
    return (str(v if v is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def build_html(data, cfg):
    week   = data.get("week", {}) or {}
    totals = data.get("totals", {}) or {}
    missed = data.get("missed", []) or []
    did    = [s for s in (data.get("stores") or []) if s.get("did_check")]

    # Best coverage first for the stores that did it: the useful ordering is
    # "who did the most thorough job", not alphabetical.
    did = sorted(did, key=lambda s: (-s.get("departments", 0), -s.get("records", 0)))

    n_missed = len(missed)
    accent   = "#C0392B" if n_missed else "#2D7A4E"

    def kpi(label, value, tone="#1F3A68"):
        return (f'<td style="padding:0 6px;"><div style="background:#F4F7FC;border:1px solid #DCE6F5;'
                f'border-radius:10px;padding:12px 14px;text-align:center;">'
                f'<div style="font-size:24px;font-weight:700;color:{tone};line-height:1.1;">{esc(value)}</div>'
                f'<div style="font-size:11px;color:#5A6B85;text-transform:uppercase;'
                f'letter-spacing:.4px;margin-top:4px;">{esc(label)}</div></div></td>')

    rows_missed = "".join(
        f'<tr><td style="padding:7px 10px;border-bottom:1px solid #EEE;">{esc(s["store_name"])}</td>'
        f'<td style="padding:7px 10px;border-bottom:1px solid #EEE;color:#777;">{esc(s.get("store_code") or "")}</td></tr>'
        for s in missed
    ) or ('<tr><td colspan="2" style="padding:12px 10px;color:#2D7A4E;font-weight:600;">'
          'Every active store completed a Department Check. </td></tr>')

    rows_did = "".join(
        f'<tr><td style="padding:6px 10px;border-bottom:1px solid #F0F0F0;">{esc(s["store_name"])}</td>'
        f'<td style="padding:6px 10px;border-bottom:1px solid #F0F0F0;text-align:right;">{s.get("records", 0):,}</td>'
        f'<td style="padding:6px 10px;border-bottom:1px solid #F0F0F0;text-align:right;">{s.get("departments", 0)}</td></tr>'
        for s in did
    ) or '<tr><td colspan="3" style="padding:12px 10px;color:#777;">No Department Checks recorded.</td></tr>'

    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#EEF2F8;font-family:Segoe UI,Arial,sans-serif;color:#22303F;">
<div style="max-width:720px;margin:0 auto;padding:18px;">

  <div style="background:linear-gradient(135deg,#1F3A68 0%,#2E78D6 100%);color:#fff;
              border-radius:12px;padding:18px 20px;">
    <div style="font-size:19px;font-weight:700;">Department Check — weekly summary</div>
    <div style="font-size:13px;opacity:.9;margin-top:3px;">{esc(week.get('label', ''))}</div>
  </div>

  <table style="width:100%;border-collapse:separate;border-spacing:0;margin-top:14px;"><tr>
    {kpi("Stores missed", n_missed, accent)}
    {kpi("Stores did it", totals.get("did", 0))}
    {kpi("Records", f"{totals.get('records', 0):,}")}
    {kpi("Departments", totals.get("departments", 0))}
  </tr></table>

  <div style="background:#fff;border-radius:12px;margin-top:16px;overflow:hidden;
              border:1px solid #E3EAF4;">
    <div style="background:{accent};color:#fff;padding:10px 14px;font-weight:700;font-size:14px;">
      Did NOT do a Department Check ({n_missed})
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">{rows_missed}</table>
  </div>

  <div style="background:#fff;border-radius:12px;margin-top:16px;overflow:hidden;
              border:1px solid #E3EAF4;">
    <div style="background:#F4F7FC;padding:10px 14px;font-weight:700;font-size:14px;color:#1F3A68;
                border-bottom:1px solid #E3EAF4;">
      Completed ({len(did)}) — most departments covered first
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#FAFCFF;">
        <th align="left"  style="padding:7px 10px;font-size:11px;color:#5A6B85;text-transform:uppercase;">Store</th>
        <th align="right" style="padding:7px 10px;font-size:11px;color:#5A6B85;text-transform:uppercase;">Records</th>
        <th align="right" style="padding:7px 10px;font-size:11px;color:#5A6B85;text-transform:uppercase;">Departments</th>
      </tr>
      {rows_did}
    </table>
  </div>

  <div style="font-size:11px;color:#7A8699;margin-top:14px;line-height:1.5;">
    Departments = distinct departments recorded by that store during the week, not
    the number of scans. Active stores only; test-app activity is excluded.<br>
    Generated {dt.datetime.now():%d/%m/%Y %H:%M} from {esc(cfg.get('base_url',''))}.
  </div>

</div></body></html>"""


# -- send ----------------------------------------------------------------------

def send_email(cfg, html, subject, recipients, cc=None):
    smtp = cfg["smtp"]
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"]    = smtp["from"]
    msg["To"]      = ", ".join(recipients)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg.set_content("This report needs an HTML-capable email client.")
    msg.add_alternative(html, subtype="html")

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
    ap.add_argument("--dry-run", action="store_true",
                    help="Build the email but do not send; write HTML to disk.")
    ap.add_argument("--to", help="Send only to this address (overrides recipients) - for testing.")
    ap.add_argument("--week", help="Monday of the week to report on, YYYY-MM-DD. "
                                   "Default: the last complete week.")
    args = ap.parse_args()

    log("=== Department Check weekly report starting ===")
    cfg = load_config()
    secret = read_secret()

    try:
        data = fetch(cfg, secret, args.week)
    except Exception as e:
        log(f"Could not fetch report data: {e}", "ERROR")
        sys.exit(1)

    week   = data.get("week", {}) or {}
    totals = data.get("totals", {}) or {}
    log(f"{week.get('label','?')}: {totals.get('missed',0)} of {totals.get('stores',0)} "
        f"stores missed; {totals.get('records',0)} records, "
        f"{totals.get('departments',0)} departments.")

    html    = build_html(data, cfg)
    subject = f'{cfg.get("subject_prefix", "Homesavers Department Check")} - {week.get("label", "")}'

    if args.dry_run:
        out = os.path.join(HERE, "dept-check-weekly-preview.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        log(f"Dry run - wrote {out}; no email sent.")
        return

    recipients = [args.to] if args.to else cfg.get("recipients", [])
    cc         = None if args.to else cfg.get("cc") or None
    if not recipients:
        log("No recipients configured.", "ERROR")
        sys.exit(1)

    try:
        send_email(cfg, html, subject, recipients, cc)
    except Exception as e:
        log(f"Send failed: {e}", "ERROR")
        sys.exit(1)
    log(f"Sent to {', '.join(recipients)}" + (f" (cc {', '.join(cc)})" if cc else ""))
    log("=== Done ===")


if __name__ == "__main__":
    main()
