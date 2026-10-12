#!/usr/bin/env python3
"""Department Check report for Area Managers — scoped to each manager's stores.

Sent twice a week:
  Thursday 09:00 — covers Monday to Wednesday (mid-week snapshot)
  Monday   09:00 — covers previous Monday to Sunday (full week)

Each area manager receives their own email showing only their stores.
BCC goes to the address in config["bcc"].

Usage:
    python dept-check-area-managers.py --period full-week   # Mon 09:00
    python dept-check-area-managers.py --period mid-week    # Thu 09:00
    python dept-check-area-managers.py --dry-run            # write HTML, no send
    python dept-check-area-managers.py --to me@x.ie        # override recipient (all areas)
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

HERE        = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("DEPT_CHECK_AREA_CONFIG",
                             os.path.join(HERE, "dept-check-area-managers.config.json"))
SECRET_FILE = r"C:\Homesavers\.sync-secret"
LOG_FILE    = r"C:\Homesavers\logs\dept-check-area-managers.log"


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
        log("Copy dept-check-area-managers.config.example.json and fill it in.", "ERROR")
        sys.exit(1)
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def read_secret():
    if not os.path.exists(SECRET_FILE):
        log(f"Secret file not found: {SECRET_FILE}", "ERROR")
        sys.exit(1)
    with open(SECRET_FILE, encoding="utf-8") as f:
        return f.read().strip()


def period_dates(period):
    """Return (from_dt, to_dt, period_label) for the chosen period.

    full-week: previous Monday 00:00 UTC → previous Sunday 23:59:59 UTC
               (same window the chain-wide Monday report uses)
    mid-week:  this Monday 00:00 UTC → this Wednesday 23:59:59 UTC
    """
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    dow = today.weekday()           # Mon=0, Tue=1, …, Sun=6

    if period == "full-week":
        monday = today - dt.timedelta(days=dow + 7)
        sunday = monday + dt.timedelta(days=6)
        frm = dt.datetime(monday.year, monday.month, monday.day, tzinfo=dt.timezone.utc)
        to  = dt.datetime(sunday.year, sunday.month, sunday.day,
                          23, 59, 59, tzinfo=dt.timezone.utc)
        label = (f"Week {_iso_week(monday)} "
                 f"({monday.strftime('%d/%m/%y')} – {sunday.strftime('%d/%m/%y')})")
    else:  # mid-week
        monday    = today - dt.timedelta(days=dow)
        wednesday = monday + dt.timedelta(days=2)
        frm = dt.datetime(monday.year, monday.month, monday.day, tzinfo=dt.timezone.utc)
        to  = dt.datetime(wednesday.year, wednesday.month, wednesday.day,
                          23, 59, 59, tzinfo=dt.timezone.utc)
        label = (f"Mon–Wed "
                 f"({monday.strftime('%d/%m/%y')} – {wednesday.strftime('%d/%m/%y')})")

    return frm, to, label


def _iso_week(d):
    return d.isocalendar()[1]


def fetch_area_stores(cfg, area_code):
    """Return list of store UUIDs for the given area_code via Supabase REST."""
    supabase_url = cfg.get("supabase_url", "").rstrip("/")
    anon_key     = cfg.get("supabase_anon_key", "")
    if not supabase_url or not anon_key:
        log("supabase_url / supabase_anon_key not in config — cannot resolve stores.", "ERROR")
        return []

    headers = {"apikey": anon_key, "Authorization": f"Bearer {anon_key}"}
    # 1. area uuid
    r = requests.get(
        f"{supabase_url}/rest/v1/areas",
        headers=headers,
        params={"area_code": f"eq.{area_code}", "select": "id"},
        timeout=30,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return []
    area_id = rows[0]["id"]

    # 2. stores in that area
    r2 = requests.get(
        f"{supabase_url}/rest/v1/stores",
        headers=headers,
        params={"area_id": f"eq.{area_id}", "is_active": "eq.true", "select": "id"},
        timeout=30,
    )
    r2.raise_for_status()
    return [s["id"] for s in r2.json()]


def fetch_report(cfg, secret, frm, to, store_ids=None):
    url = f"{cfg['base_url']}/api/reports/dept-check-week"
    params = {"from": frm.isoformat(), "to": to.isoformat()}
    if store_ids:
        params["store_ids"] = ",".join(store_ids)
    resp = requests.get(url, headers={"X-Sync-Secret": secret}, params=params, timeout=120)
    resp.raise_for_status()
    return resp.json()


# -- html (same palette / components as dept-check-weekly.py) ------------------

def esc(v):
    return (str(v if v is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


ESPRESSO = "#241A13"
BROWN    = "#4A342A"
MOCHA    = "#6F4E37"
GOLD     = "#C8912F"
GOLD_LT  = "#F0DFC0"
CREAM    = "#FBF7F1"
TAN      = "#E4D5C3"
WHITE    = "#FFFFFF"
RED      = "#A63A28"
FONT     = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

DEPT_COLORS = ["#B85C1A","#0E9B90","#E0A92E","#7A4FA8",
                "#6F9B2E","#B8324F","#2E6FD4","#C4457E"]
DEPT_OTHER  = "#B9A894"


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
    if not w:
        return ''
    wk     = w.get("week", {}) or {}
    missed = w.get("missed", []) or []
    tot    = w.get("totals", {}) or {}
    n      = len(missed)
    chip   = RED if n else "#2E6B45"

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


def dept_label(d):
    return "Inactive Products" if d == "(none)" else d


def dept_palette(department_totals):
    ranked = [d["department"] for d in (department_totals or [])
              if d["department"] != "(none)"][:8]
    m = {d: DEPT_COLORS[i] for i, d in enumerate(ranked)}
    m["(none)"] = DEPT_OTHER
    return m, ranked


def stacked_bar(bd, palette, total, width_pct):
    if not total:
        return ''
    parts = sorted(bd.items(), key=lambda kv: -kv[1])
    cells = []
    for dept, n in parts:
        pct = n * 100.0 / total
        if pct < 0.8:
            continue
        col = palette.get(dept, DEPT_OTHER)
        cells.append(
            f'<td width="{pct:.4f}%" bgcolor="{col}" title="{esc(dept_label(dept))}: {n:,}" '
            f'style="width:{pct:.4f}%;background-color:{col};height:14px;'
            f'font-size:0;line-height:0;">&nbsp;</td>')
    if not cells:
        return ''
    return (f'<table role="presentation" width="{width_pct}%" cellpadding="0" cellspacing="0" '
            f'border="0" style="width:{width_pct}%;border-radius:3px;overflow:hidden;'
            f'table-layout:fixed;"><tr>{"".join(cells)}</tr></table>')


def build_html(last, cfg, first_name, area_name, period_label, is_mid_week):
    wk     = last.get("week", {}) or {}
    stores = [s for s in (last.get("stores") or []) if s.get("records", 0) > 0]
    stores.sort(key=lambda s: (-s.get("records", 0), -s.get("departments", 0)))
    top    = max([s.get("records", 0) for s in stores] or [1])

    palette, ranked = dept_palette(last.get("department_totals"))
    dept_totals = {d["department"]: d["records"] for d in (last.get("department_totals") or [])}

    def count_row(st):
        recs  = st.get("records", 0)
        bd    = st.get("departments_breakdown") or {}
        width = max(6, int(round(recs * 100.0 / top)))
        bar   = stacked_bar(bd, palette, recs, width)
        lead  = sorted(bd.items(), key=lambda kv: -kv[1])
        lead_txt = " · ".join(f"{esc(dept_label(d))} {n:,}" for d, n in lead)
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
        f'font-size:13.5px;color:#8A7866;">No Department Check records for this period.</td></tr>')

    def legend():
        items = []
        for d in ranked:
            items.append(
                f'<td style="padding:3px 10px 3px 0;font-family:{FONT};font-size:11.5px;'
                f'color:{ESPRESSO};white-space:nowrap;">'
                f'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;'
                f'background-color:{palette[d]};">&nbsp;</span>&nbsp;{esc(d)}</td>')
        inactive = sum(v for k, v in dept_totals.items() if k not in ranked)
        if inactive:
            items.append(
                f'<td style="padding:3px 10px 3px 0;font-family:{FONT};font-size:11.5px;'
                f'color:{ESPRESSO};white-space:nowrap;">'
                f'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;'
                f'background-color:{DEPT_OTHER};">&nbsp;</span>&nbsp;Inactive Products</td>')
        rows = ""
        for i in range(0, len(items), 2):
            rows += "<tr>" + "".join(items[i:i + 2]) + "</tr>"
        return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
                f'width="100%">{rows}</table>')

    if is_mid_week:
        report_type = "Mid-Week Update"
        greeting_body = (
            f"Here is the mid-week Department Check update for your stores "
            f"({esc(period_label)})."
        )
        missed_sub = "Stores that have not yet done a Department Check this week"
    else:
        report_type = "Weekly Report"
        greeting_body = (
            f"Here is last week&rsquo;s Department Check report for your stores "
            f"({esc(period_label)})."
        )
        missed_sub = "Stores that did not do a Department Check last week"

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

    # masthead
    H.append(f'<tr><td bgcolor="{ESPRESSO}" style="background-color:{ESPRESSO};padding:20px 18px;'
             f'border-radius:12px;font-family:{FONT};">'
             f'<div style="font-size:11px;letter-spacing:2px;color:{GOLD};font-weight:700;'
             f'text-transform:uppercase;">Homesavers</div>'
             f'<div style="font-size:21px;font-weight:700;color:{WHITE};margin-top:6px;'
             f'line-height:1.25;">Department Check &mdash; {esc(report_type)}</div>'
             f'<div style="font-size:13px;color:#C9B79E;margin-top:5px;">'
             f'{esc(area_name)} &middot; {esc(period_label)}</div></td></tr>')

    # greeting
    H.append(f'<tr><td align="left" style="padding:14px 4px 16px;font-family:{FONT};'
             f'font-size:14px;color:{ESPRESSO};line-height:1.55;">'
             f'Hi {esc(first_name)},<br>'
             f'{greeting_body}'
             f'</td></tr>')

    # card 1: missed
    H.append(_card_open(missed_sub, None, RED, WHITE, "#F3D6CF"))
    H.append(_week_block(last, "your area"))
    H.append(_card_close())

    # card 2: counts
    H.append(_card_open("Department Check records by department",
                        f'{esc(period_label)} &middot; busiest store first', BROWN))
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
             f'records were made of; every department is named under each bar.'
             f'</td></tr>')
    H.append(_card_close())

    # footer
    H.append(f'<tr><td style="padding:2px 6px 0;font-family:{FONT};font-size:11px;color:#9C8A76;'
             f'line-height:1.6;">Active stores only; test-app activity excluded. '
             f'Generated {dt.datetime.now():%d/%m/%Y %H:%M}.</td></tr>')
    H.append(f'<tr><td style="padding:16px 4px 0;font-family:{FONT};font-size:14px;'
             f'color:{ESPRESSO};line-height:1.5;">Regards,<br>Homesavers Scanner</td></tr>')
    H.append('</table></td></tr></table></body></html>')
    return "".join(H)


# -- send ----------------------------------------------------------------------

def send_email(cfg, html, subject, to_addrs, bcc=None):
    smtp = cfg["smtp"]
    msg  = EmailMessage()
    msg["Subject"] = subject
    msg["From"]    = smtp["from"]
    msg["To"]      = ", ".join(to_addrs)
    # BCC is not an SMTP header — we pass bcc_addrs to sendmail explicitly.
    msg.set_content("This report needs an HTML-capable email client.")
    msg.add_alternative(html, subtype="html")

    all_rcpt = list(to_addrs) + (list(bcc) if bcc else [])

    host, port = smtp["host"], int(smtp.get("port", 587))
    security   = (smtp.get("security") or "starttls").lower()
    if security == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=60) as s:
            if smtp.get("username"):
                s.login(smtp["username"], smtp["password"])
            s.sendmail(smtp["from"], all_rcpt, msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=60) as s:
            if security == "starttls":
                s.starttls()
            if smtp.get("username"):
                s.login(smtp["username"], smtp["password"])
            s.sendmail(smtp["from"], all_rcpt, msg.as_string())


# -- main ----------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--period", choices=["full-week", "mid-week"], default="full-week",
                    help="full-week = Mon 09:00, previous Mon-Sun. "
                         "mid-week = Thu 09:00, this Mon-Wed.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Build HTML files but do not send.")
    ap.add_argument("--to", help="Send all area emails to this address only (for testing).")
    args = ap.parse_args()

    log(f"=== Dept Check area-manager report starting (period={args.period}) ===")
    cfg    = load_config()
    secret = read_secret()

    frm, to, period_label = period_dates(args.period)
    is_mid_week = (args.period == "mid-week")
    log(f"Period: {frm.date()} to {to.date()} — {period_label}")

    managers = cfg.get("area_managers", [])
    if not managers:
        log("No area_managers configured.", "ERROR")
        sys.exit(1)

    bcc = cfg.get("bcc") or []
    if isinstance(bcc, str):
        bcc = [bcc]

    subject_prefix = cfg.get("subject_prefix", "Homesavers Department Check")
    subject = f'{subject_prefix} — Your Area — {period_label}'

    errors = 0
    for mgr in managers:
        name       = mgr.get("name", "")
        email      = args.to or mgr.get("email", "")
        area_code  = mgr.get("area_code", "")
        area_label = mgr.get("area_label") or f"Area {area_code}"
        first_name = name.split()[0] if name else "Manager"

        if not email:
            log(f"  {name} ({area_code}): no email configured — skipping.", "WARN")
            continue
        if not area_code:
            log(f"  {name}: no area_code configured — skipping.", "WARN")
            continue

        log(f"  {name} ({area_code}): fetching stores…")
        try:
            store_ids = fetch_area_stores(cfg, area_code)
        except Exception as e:
            log(f"  {name}: store lookup failed: {e}", "ERROR")
            errors += 1
            continue

        if not store_ids:
            log(f"  {name} ({area_code}): no active stores found — skipping.", "WARN")
            continue

        log(f"  {name}: {len(store_ids)} stores. Fetching report…")
        try:
            data = fetch_report(cfg, secret, frm, to, store_ids)
        except Exception as e:
            log(f"  {name}: report fetch failed: {e}", "ERROR")
            errors += 1
            continue

        totals = data.get("totals", {}) or {}
        log(f"  {name}: {totals.get('missed',0)} missed / {totals.get('stores',0)} stores, "
            f"{totals.get('records',0):,} records.")

        html = build_html(data, cfg, first_name, area_label, period_label, is_mid_week)

        if args.dry_run:
            out = os.path.join(HERE, f"dept-check-area-preview-{area_code}.html")
            with open(out, "w", encoding="utf-8") as f:
                f.write(html)
            log(f"  {name}: dry run — wrote {out}")
            continue

        try:
            send_email(cfg, html, subject, [email], bcc or None)
            bcc_note = f" (bcc {', '.join(bcc)})" if bcc else ""
            log(f"  {name}: sent to {email}{bcc_note}")
        except Exception as e:
            log(f"  {name}: send failed: {e}", "ERROR")
            errors += 1

    # Summary email to shayas (or whoever is in summary_to): chain-wide, all
    # stores, same format as the per-area emails but addressed "Hi All".
    summary_to = cfg.get("summary_to") or []
    if isinstance(summary_to, str):
        summary_to = [summary_to]
    if summary_to and not args.dry_run:
        log(f"Sending chain-wide summary to {', '.join(summary_to)}…")
        try:
            all_data = fetch_report(cfg, secret, frm, to)
            all_html = build_html(all_data, cfg, "All", "All Areas", period_label, is_mid_week)
            send_email(cfg, all_html, subject, summary_to)
            log(f"  Summary sent to {', '.join(summary_to)}")
        except Exception as e:
            log(f"  Summary send failed: {e}", "ERROR")
            errors += 1

    if errors:
        log(f"Finished with {errors} error(s).", "WARN")
        sys.exit(1)
    log("=== Done ===")


if __name__ == "__main__":
    main()
