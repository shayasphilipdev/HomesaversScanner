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


def fetch_week(cfg, secret, frm=None, to=None):
    """One week. With no bounds the API returns the last COMPLETE Mon-Sun."""
    url = f"{cfg['base_url']}/api/reports/dept-check-week"
    params = {}
    if frm and to:
        params = {"from": frm.isoformat(), "to": to.isoformat()}
    resp = requests.get(url, headers={"X-Sync-Secret": secret}, params=params, timeout=120)
    resp.raise_for_status()
    return resp.json()


def fetch(cfg, secret, week_monday=None):
    """Last week plus the week before it, for the side-by-side snapshot.

    The API works out "last week" itself; the previous week is derived from the
    bounds it returns rather than recomputed here, so the two can never disagree
    about where a week starts -- which matters at a year boundary, where
    2024-12-30 is week 1 of ISO-2025.
    """
    if week_monday:
        start = dt.datetime.fromisoformat(week_monday).replace(tzinfo=dt.timezone.utc)
        end = start + dt.timedelta(days=6, hours=23, minutes=59, seconds=59)
        last = fetch_week(cfg, secret, start, end)
    else:
        last = fetch_week(cfg, secret)

    lf = dt.datetime.fromisoformat(last["week"]["from"].replace("Z", "+00:00"))
    prev_from = lf - dt.timedelta(days=7)
    prev_to = lf - dt.timedelta(microseconds=1)
    try:
        prev = fetch_week(cfg, secret, prev_from, prev_to)
    except Exception as e:
        log(f"Previous week unavailable ({e}); showing last week only.", "WARN")
        prev = None
    return last, prev


# -- html ----------------------------------------------------------------------

def esc(v):
    return (str(v if v is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# Coffee-shop palette. Every one of these is used as a SOLID colour.
#
# The previous version put white text on a CSS gradient. Email clients drop
# background-image, so the band vanished and left white on white -- unreadable in
# Outlook while looking fine in a browser preview. Nothing here depends on a
# gradient, every coloured block carries both the bgcolor ATTRIBUTE and an inline
# background-color, and no text relies on a background that might not paint.
ESPRESSO = "#241A13"   # near-black
BROWN    = "#4A342A"   # header band
MOCHA    = "#6F4E37"   # secondary band
GOLD     = "#C8912F"   # accent / bars
GOLD_LT  = "#F0DFC0"   # table head
CREAM    = "#FBF7F1"   # page
TAN      = "#E4D5C3"   # borders
WHITE    = "#FFFFFF"
RED      = "#A63A28"   # "did not do"

FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"


def _card_open(title, sub, band=BROWN, title_col=WHITE, sub_col="#E8D6BC"):
    return (
        f'<tr><td style="padding:0 0 16px 0;">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'bgcolor="{WHITE}" style="background-color:{WHITE};border:1px solid {TAN};border-radius:12px;">'
        f'<tr><td bgcolor="{band}" style="background-color:{band};padding:13px 16px;'
        f'border-radius:12px 12px 0 0;font-family:{FONT};">'
        f'<div style="font-size:16px;font-weight:700;color:{title_col};line-height:1.3;">{title}</div>'
        + (f'<div style="font-size:12.5px;color:{sub_col};margin-top:3px;line-height:1.35;">{sub}</div>' if sub else '')
        + '</td></tr>'
    )


def _card_close():
    return '</table></td></tr>'


def _week_block(w, tag):
    """One week's missed-store list. Stacked, not columned: a two-column layout
    collapses unpredictably on a phone, and this has to be readable there."""
    if not w:
        return ''
    wk = w.get("week", {}) or {}
    missed = w.get("missed", []) or []
    tot = w.get("totals", {}) or {}
    n = len(missed)
    chip = RED if n else "#2E6B45"

    rows = "".join(
        f'<tr><td style="padding:7px 14px;border-top:1px solid {TAN};font-family:{FONT};'
        f'font-size:13.5px;color:{ESPRESSO};">{esc(m["store_name"])}</td>'
        f'<td align="right" style="padding:7px 14px;border-top:1px solid {TAN};font-family:{FONT};'
        f'font-size:12px;color:#8A7866;white-space:nowrap;">{esc(m.get("store_code") or "")}</td></tr>'
        for m in missed
    ) or (f'<tr><td colspan="2" style="padding:12px 14px;border-top:1px solid {TAN};'
          f'font-family:{FONT};font-size:13.5px;color:#2E6B45;font-weight:600;">'
          f'Every store completed a Department Check.</td></tr>')

    return (
        f'<tr><td style="padding:12px 16px 0;font-family:{FONT};">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td style="font-size:13.5px;font-weight:700;color:{ESPRESSO};">'
        f'{esc(wk.get("label",""))}'
        f'<span style="font-weight:400;color:#8A7866;"> &middot; {tag}</span></td>'
        f'<td align="right">'
        f'<span style="display:inline-block;background-color:{chip};color:{WHITE};'
        f'border-radius:99px;padding:2px 10px;font-size:12.5px;font-weight:700;">{n} missed</span>'
        f'</td></tr></table></td></tr>'
        f'<tr><td style="padding:6px 0 2px;">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{rows}</table>'
        f'</td></tr>'
        f'<tr><td style="padding:6px 16px 12px;font-family:{FONT};font-size:11.5px;color:#8A7866;">'
        f'{tot.get("did",0)} of {tot.get("stores",0)} stores &middot; '
        f'{tot.get("records",0):,} records</td></tr>'
    )


# Department colours.
#
# VALIDATED, not chosen by eye, with the dataviz validator:
#   lightness band PASS · chroma floor PASS
#   CVD separation PASS (worst adjacent dE 11.4 deutan)
#   normal-vision floor PASS (23.3)
# The gold carries a contrast warning against white, which is discharged by the
# legend and by the record counts printed beside every bar -- never colour alone.
#
# A first attempt kept strictly to browns and golds to match the email's chrome.
# It FAILED three of the four checks: browns are inherently low-chroma and read as
# grey, and the darks and lights fell outside the lightness band. The email's
# frame stays coffee-shop; the data series need hues that are actually
# distinguishable. Those are different jobs.
DEPT_COLORS = [
    "#B85C1A",  # 1
    "#0E9B90",  # 2
    "#E0A92E",  # 3
    "#7A4FA8",  # 4
    "#6F9B2E",  # 5
    "#B8324F",  # 6
    "#2E6FD4",  # 7
    "#C4457E",  # 8
]
DEPT_OTHER = "#B9A894"   # everything past the top 8
DEPT_NONE  = "#9C9186"   # unattributed -- a data-quality state, not a category,
                         # so it deliberately does not consume a categorical hue


def dept_palette(department_totals):
    """Fixed department -> colour, decided ONCE chain-wide and shared by every
    bar. If each store picked its own top 8, the same hue would mean HOMEWARES on
    one row and TOYS on the next."""
    ranked = [d["department"] for d in (department_totals or [])
              if d["department"] != "(none)"][:8]
    m = {d: DEPT_COLORS[i] for i, d in enumerate(ranked)}
    m["(none)"] = DEPT_NONE
    return m, ranked


def stacked_bar(bd, palette, total, width_pct):
    """A stacked bar as a TABLE of coloured cells.

    Not a div with flex -- Outlook's Word engine ignores flex entirely and would
    collapse the bar to nothing. A table row of <td>s with width percentages and
    a bgcolor attribute is the one construction that renders everywhere.
    """
    if not total:
        return ''
    parts = sorted(bd.items(), key=lambda kv: -kv[1])
    cells = []
    for dept, n in parts:
        pct = n * 100.0 / total
        if pct < 0.8:                      # below this a cell renders as a sliver
            continue                        # or gets dropped; folded into the rest
        col = palette.get(dept, DEPT_OTHER)
        cells.append(
            f'<td width="{pct:.4f}%" bgcolor="{col}" title="{esc(dept)}: {n:,}" '
            f'style="width:{pct:.4f}%;background-color:{col};height:14px;'
            f'font-size:0;line-height:0;">&nbsp;</td>')
    if not cells:
        return ''
    return (f'<table role="presentation" width="{width_pct}%" cellpadding="0" cellspacing="0" '
            f'border="0" style="width:{width_pct}%;border-radius:3px;overflow:hidden;'
            f'table-layout:fixed;"><tr>{"".join(cells)}</tr></table>')


def build_html(last, prev, cfg):
    wk = last.get("week", {}) or {}
    stores = [s for s in (last.get("stores") or []) if s.get("records", 0) > 0]
    # Highest count first, as asked.
    stores.sort(key=lambda s: (-s.get("records", 0), -s.get("departments", 0)))
    top = max([s.get("records", 0) for s in stores] or [1])

    palette, ranked = dept_palette(last.get("department_totals"))
    dept_totals = {d["department"]: d["records"] for d in (last.get("department_totals") or [])}

    def count_row(st):
        recs = st.get("records", 0)
        bd = st.get("departments_breakdown") or {}
        # Bar length shows this store against the busiest; the SEGMENTS show what
        # its records were made of. Two facts, one mark.
        width = max(6, int(round(recs * 100.0 / top)))
        bar = stacked_bar(bd, palette, recs, width)
        lead = sorted(bd.items(), key=lambda kv: -kv[1])[:2]
        lead_txt = " · ".join(f"{esc(d)} {n:,}" for d, n in lead)
        return (
            f'<tr>'
            f'<td style="padding:9px 10px 9px 14px;border-top:1px solid {TAN};font-family:{FONT};'
            f'font-size:13.5px;color:{ESPRESSO};">'
            f'<div style="font-weight:600;">{esc(st["store_name"])}</div>'
            f'<div style="margin-top:5px;">{bar}</div>'
            f'<div style="margin-top:4px;font-size:11px;color:#8A7866;">{lead_txt}</div>'
            f'</td>'
            f'<td align="right" valign="top" style="padding:9px 14px 9px 10px;border-top:1px solid {TAN};'
            f'font-family:{FONT};font-size:15px;font-weight:700;color:{ESPRESSO};white-space:nowrap;">'
            f'{recs:,}</td>'
            f'</tr>'
        )

    count_rows = "".join(count_row(st) for st in stores) or (
        f'<tr><td colspan="2" style="padding:14px;border-top:1px solid {TAN};font-family:{FONT};'
        f'font-size:13.5px;color:#8A7866;">No Department Check records last week.</td></tr>')

    # Legend: colour -> department only. The chain-wide totals that used to sit
    # here are gone -- the owner wants store-wise figures, not a chain roll-up.
    # The legend still has to exist: with more than one series, identity must
    # never be carried by colour alone.
    def legend():
        items = []
        for d in ranked:
            n = dept_totals.get(d, 0)
            items.append(
                f'<td style="padding:3px 10px 3px 0;font-family:{FONT};font-size:11.5px;'
                f'color:{ESPRESSO};white-space:nowrap;">'
                f'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;'
                f'background-color:{palette[d]};">&nbsp;</span>&nbsp;{esc(d)}</td>')
        if "(none)" in dept_totals:
            items.append(
                f'<td style="padding:3px 10px 3px 0;font-family:{FONT};font-size:11.5px;'
                f'color:{ESPRESSO};white-space:nowrap;">'
                f'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;'
                f'background-color:{DEPT_NONE};">&nbsp;</span>&nbsp;No department</td>')
        other = sum(v for k, v in dept_totals.items() if k not in ranked and k != "(none)")
        if other:
            items.append(
                f'<td style="padding:3px 10px 3px 0;font-family:{FONT};font-size:11.5px;'
                f'color:{ESPRESSO};white-space:nowrap;">'
                f'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;'
                f'background-color:{DEPT_OTHER};">&nbsp;</span>&nbsp;Other</td>')
        # Two per row: a single row of 10 legend items would scroll off a phone.
        rows = ""
        for i in range(0, len(items), 2):
            rows += "<tr>" + "".join(items[i:i + 2]) + "</tr>"
        return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
                f'width="100%">{rows}</table>')

    H = []
    H.append('<!DOCTYPE html><html><head><meta charset="utf-8">'
             '<meta name="viewport" content="width=device-width,initial-scale=1">'
             '<title>Department Check</title></head>')
    H.append(f'<body style="margin:0;padding:0;background-color:{CREAM};">')
    H.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
             f'bgcolor="{CREAM}" style="background-color:{CREAM};"><tr>'
             f'<td align="center" style="padding:16px 10px;">')
    H.append('<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
             'style="width:600px;max-width:100%;">')

    # ---- masthead -------------------------------------------------------
    H.append(f'<tr><td bgcolor="{ESPRESSO}" style="background-color:{ESPRESSO};padding:20px 18px;'
             f'border-radius:12px;font-family:{FONT};">'
             f'<div style="font-size:11px;letter-spacing:2px;color:{GOLD};font-weight:700;'
             f'text-transform:uppercase;">Homesavers</div>'
             f'<div style="font-size:21px;font-weight:700;color:{WHITE};margin-top:6px;'
             f'line-height:1.25;">Department Check &mdash; Weekly Report</div>'
             f'<div style="font-size:13px;color:#C9B79E;margin-top:5px;">'
             f'{esc(wk.get("label",""))}</div></td></tr>')
    H.append('<tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>')

    # ---- card 1: not done, two weeks ------------------------------------
    H.append(_card_open("Stores that did not do a Department Check",
                        "Last week, with the week before for comparison", RED, WHITE, "#F3D6CF"))
    H.append(_week_block(last, "last week"))
    if prev:
        H.append(f'<tr><td style="padding:0 16px;"><div style="height:1px;background-color:{TAN};'
                 f'font-size:0;line-height:0;">&nbsp;</div></td></tr>')
        H.append(_week_block(prev, "previous week"))
    H.append(_card_close())

    # ---- card 2: counts --------------------------------------------------
    H.append(_card_open("Department Check records by department",
                        f'{esc(wk.get("label",""))} &middot; busiest store first', BROWN))
    H.append(f'<tr><td style="padding:12px 14px 4px;">{legend()}</td></tr>')
    H.append(f'<tr><td style="padding:0;">'
             f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
             f'<tr bgcolor="{GOLD_LT}" style="background-color:{GOLD_LT};">'
             f'<th align="left" style="padding:8px 14px;font-family:{FONT};font-size:11px;'
             f'letter-spacing:.6px;text-transform:uppercase;color:{BROWN};">Store &amp; department split</th>'
             f'<th align="right" style="padding:8px 14px 8px 10px;font-family:{FONT};font-size:11px;'
             f'letter-spacing:.6px;text-transform:uppercase;color:{BROWN};">Records</th>'
             f'</tr>{count_rows}</table></td></tr>')
    H.append(f'<tr><td style="padding:10px 14px 12px;font-family:{FONT};font-size:11.5px;'
             f'color:#8A7866;line-height:1.5;">'
             f'Bar length = that store against the busiest. The colours show what its '
             f'records were made of; the two biggest departments are named under each bar.'
             f'</td></tr>')
    H.append(_card_close())

    # ---- footer ----------------------------------------------------------
    H.append(f'<tr><td style="padding:2px 6px 0;font-family:{FONT};font-size:11px;color:#9C8A76;'
             f'line-height:1.6;">Active stores only; test-app activity excluded. '
             f'Generated {dt.datetime.now():%d/%m/%Y %H:%M}.</td></tr>')

    H.append('</table></td></tr></table></body></html>')
    return "".join(H)


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
        data, prev = fetch(cfg, secret, args.week)
    except Exception as e:
        log(f"Could not fetch report data: {e}", "ERROR")
        sys.exit(1)

    week   = data.get("week", {}) or {}
    totals = data.get("totals", {}) or {}
    log(f"{week.get('label','?')}: {totals.get('missed',0)} of {totals.get('stores',0)} "
        f"stores missed; {totals.get('records',0)} records, "
        f"{totals.get('departments',0)} departments.")

    html    = build_html(data, prev, cfg)
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
