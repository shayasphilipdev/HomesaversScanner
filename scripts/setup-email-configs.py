r"""
Create the three report-email config files on the PC (Phase 6 of
docs/post-wipe-restoration-plan.md), by asking questions instead of editing JSON:

    aging-report.config.json
    dept-check-weekly.config.json
    dept-check-area-managers.config.json

They are written next to the deployed scripts (C:\Homesavers\scripts), which is
where the scripts read them. Re-running it keeps the current values: press
Enter to accept the value shown. Secrets are typed at a hidden prompt and never
echoed. The Brevo login is tested before anything is written.

    "<python>" scripts\setup-email-configs.py
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import smtplib
import ssl
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = r"C:\Homesavers\scripts"
NAMES = ("aging-report", "dept-check-weekly", "dept-check-area-managers")

# Recipients documented in Project_Status.MD section 9 (the lost config's values).
AGING_TO = ["naeem@a-i-m.ie", "jeff@homesavers.ie", "shauna@supplychain1.ie"]
AGING_CC = ["shayas.philip@supplychain1.ie", "chamya.herath@supplychain1.ie"]
EMAIL_RE = re.compile(r"^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$")


def load(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    return None


def ask(label, default=""):
    shown = f" [{default}]" if default else ""
    val = input(f"{label}{shown}: ").strip()
    return val or default


def ask_secret(label, existing, check=None):
    hint = " [Enter = keep the saved one]" if existing else ""
    while True:
        val = getpass.getpass(f"{label}{hint}: ").strip()
        if not val:
            if existing:
                return existing
            print("  required")
            continue
        # Ctrl+V in a Windows console does not paste into a hidden prompt: it
        # types a control character (0x16) instead. Right-click pastes.
        if any(ord(c) < 32 or ord(c) == 127 for c in val):
            print("  That didn't paste properly (Ctrl+V doesn't work here). Paste with RIGHT-CLICK, then Enter.")
            continue
        # Copying from a web page can bring along an invisible character
        # (non-breaking or zero-width space) that the server cannot parse.
        odd = [c for c in val if ord(c) > 126 or c.isspace()]
        if odd:
            print(f"  The pasted text contains {len(odd)} hidden/non-standard character(s) "
                  f"({', '.join(sorted({f'U+{ord(c):04X}' for c in odd}))}). "
                  "Copy the key again (Brevo's copy button) and paste with right-click.")
            continue
        print(f"  received {len(val)} characters")
        if check:
            problem = check(val)
            if problem:
                print(f"  {problem}")
                continue
        return val


def check_smtp_key(key):
    if key.startswith("xkeysib-"):
        return "That is a Brevo API key. This needs the SMTP key (SMTP & API -> SMTP tab, starts with xsmtpsib-)."
    if not key.startswith("xsmtpsib-"):
        print("  note: Brevo SMTP keys normally start with 'xsmtpsib-' - check you copied the whole key.")
    return None


def ask_list(label, default, required):
    while True:
        raw = ask(f"{label} (comma-separated)", ", ".join(default))
        items = [x.strip() for x in raw.replace(";", ",").split(",") if x.strip()]
        bad = [x for x in items if not EMAIL_RE.match(x)]
        if bad:
            print(f"  not an email address: {', '.join(bad)}")
        elif required and not items:
            print("  at least one address is required")
        else:
            return items


# Login methods to try, each on its own fresh connection. Python's own
# s.login() tries CRAM-MD5, PLAIN and LOGIN in turn and reports only the
# LAST error, which hides which method the server actually objected to.
METHODS = (
    ("PLAIN", True),     # AUTH PLAIN <credentials> on one line
    ("LOGIN", False),    # AUTH LOGIN, then username and key on separate lines
    ("LOGIN", True),     # AUTH LOGIN <username>, then key
    ("CRAM-MD5", False),
)


def _describe_tls(s):
    try:
        cert = s.sock.getpeercert() or {}
    except Exception:
        return "unknown"
    subj = dict(x[0] for x in cert.get("subject", ()))
    issuer = dict(x[0] for x in cert.get("issuer", ()))
    return (f"server {subj.get('commonName', '?')}, issued by "
            f"{issuer.get('organizationName') or issuer.get('commonName', '?')}")


def _try_method(smtp, mech, initial):
    """One connection, one method. Returns (ok, detail). Never prints secrets."""
    with smtplib.SMTP(smtp["host"], smtp["port"], timeout=30) as s:
        s.ehlo()
        s.starttls(context=ssl.create_default_context())
        s.ehlo()
        info = {"tls": _describe_tls(s), "auth": s.esmtp_features.get("auth", "").strip()}
        if mech not in info["auth"].upper().split():
            return False, "not offered by the server", info
        s.user, s.password = smtp["username"], smtp["password"]
        authobj = getattr(s, "auth_" + mech.lower().replace("-", "_"))
        try:
            s.auth(mech, authobj, initial_response_ok=initial)
        except smtplib.SMTPAuthenticationError as e:
            return False, f"{e.smtp_code} {e.smtp_error.decode(errors='replace')}", info
        except smtplib.SMTPException as e:
            return False, str(e), info
        return True, "accepted", info


def test_login(smtp):
    """Find a login method the server accepts. Prints what each method was
    answered (never the secrets) and returns the settings to save, e.g.
    {"auth": "PLAIN", "auth_initial_response": True}. Raises on total failure."""
    print()
    print(f"  login: {smtp['username']}  key: {len(smtp['password'])} characters, "
          f"{'starts xsmtpsib-' if smtp['password'].startswith('xsmtpsib-') else 'does NOT start xsmtpsib-'}")
    shown = False
    answers = []
    for mech, initial in METHODS:
        label = f"{mech}{' (one line)' if initial and mech == 'LOGIN' else ''}"
        try:
            ok, detail, info = _try_method(smtp, mech, initial)
        except ssl.SSLCertVerificationError as e:
            raise RuntimeError(
                f"the secure connection to {smtp['host']} was not trusted ({e.verify_message}). "
                "Something on this PC or network (often antivirus 'email scanning' / 'SSL scanning') "
                "is intercepting port 587 - turn that off for smtp-relay.brevo.com") from e
        if not shown:
            print(f"  secure connection: {info['tls']}")
            print(f"  login methods offered: {info['auth'] or '(none)'}")
            if "brevo" not in info["tls"].lower() and "sendinblue" not in info["tls"].lower():
                print("  WARNING: the certificate is not Brevo's - antivirus/firewall may be intercepting email.")
            shown = True
        print(f"  {label:<18} {detail}")
        answers.append(f"{label}: {detail}")
        if ok:
            return {"auth": mech, "auth_initial_response": initial}
    raise RuntimeError("every login method was refused:\n    " + "\n    ".join(answers))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=DEST, help=f"Folder to write the configs to (default {DEST}).")
    args = ap.parse_args()
    if not os.path.isdir(args.dest):
        sys.exit(f"{args.dest} does not exist - run scripts\\setup-new-pc.ps1 first.")

    templates = {n: load(os.path.join(HERE, f"{n}.config.example.json")) for n in NAMES}
    current = {n: load(os.path.join(args.dest, f"{n}.config.json")) for n in NAMES}
    cur_smtp = next((c["smtp"] for c in current.values() if c and c.get("smtp")), {})
    tpl_smtp = templates["aging-report"]["smtp"]

    print("\n== Brevo (Brevo -> SMTP & API -> SMTP) - shared by all three emails ==")
    smtp = {
        "host": tpl_smtp["host"], "port": tpl_smtp["port"], "security": tpl_smtp["security"],
        "username": ask("SMTP login", cur_smtp.get("username", "")),
        "password": ask_secret("SMTP key (paste with right-click)", cur_smtp.get("password", ""), check_smtp_key),
        "from": ask("From (must be a sender verified in Brevo)", cur_smtp.get("from", tpl_smtp["from"])),
    }
    print("Testing the Brevo login...", end=" ", flush=True)
    try:
        smtp.update(test_login(smtp) or {})
    except Exception as e:
        print("FAILED")
        if "unauthorized ip" in str(e).lower():
            sys.exit(f"Brevo login failed: {e}\nNothing was written. The key and login are fine - Brevo is "
                     "blocking this office's internet address. In Brevo: profile menu -> Security -> "
                     "Authorised IPs (https://app.brevo.com/security/authorised_ips), add the office's public "
                     "IP (or approve it from Brevo's 'new IP' email), then run this again.")
        sys.exit(f"Brevo login failed: {e}\nNothing was written. Check the SMTP login and the SMTP key "
                 f"(Brevo -> SMTP & API -> SMTP tab; a newly generated key, pasted with right-click) and run again.\n"
                 f"If it still fails, send the lines above (they contain no secrets).")
    print(f"OK (login method {smtp.get('auth', 'default')})")
    print("Not finished yet - answer the questions below; the files are written at the end.")

    a, w, m = (current[n] or {} for n in NAMES)
    print("\n== Aging report (Wednesday 08:00) ==")
    aging_to = ask_list("To", a.get("recipients", AGING_TO), required=True)
    aging_cc = ask_list("Cc", a.get("cc", AGING_CC), required=False)
    print("\n== Weekly Department Check (paused - not scheduled; Enter to leave blank) ==")
    weekly_to = ask_list("To", w.get("recipients", []), required=False)
    weekly_cc = ask_list("Cc", w.get("cc", []), required=False)
    print("\n== Area-manager Department Check (paused - not scheduled) ==")
    print("   Each area manager's own address comes from Admin -> Employees.")
    area_bcc = ask_list("Bcc", m.get("bcc", templates["dept-check-area-managers"].get("bcc", [])), required=False)
    anon = ask_secret("Supabase anon key (Supabase -> Project Settings -> API keys; paste with right-click)",
                      m.get("supabase_anon_key", ""))

    def build(name, **over):
        cfg = {k: v for k, v in templates[name].items() if k != "_comment"}
        cfg.update(current[name] or {})       # keep any hand-tuned extras
        cfg.update(over)
        cfg.pop("_comment", None)
        cfg["smtp"] = dict(smtp)
        return cfg

    out = {
        "aging-report": build("aging-report", recipients=aging_to, cc=aging_cc),
        "dept-check-weekly": build("dept-check-weekly", recipients=weekly_to, cc=weekly_cc),
        "dept-check-area-managers": build("dept-check-area-managers", bcc=area_bcc, supabase_anon_key=anon),
    }
    print()
    for name, cfg in out.items():
        path = os.path.join(args.dest, f"{name}.config.json")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:   # no BOM: json.load would reject it
            json.dump(cfg, f, indent=2)
        os.replace(tmp, path)
        print(f"Wrote {path}")
    print("\nDone - all three settings files saved.")
    print("Next: send each email to yourself only, with --to, before it goes to the real list.")


if __name__ == "__main__":
    main()
