r"""
Nightly backup of everything the Homesavers Scanner app needs to be rebuilt,
onto the B: share (snapshots there are what protects it from ransomware: this
PC can write to B:, so a copy here alone would not survive an attack on it).

    B:\Supply Chain & Buying - Shared\HomesaversScannerBackup\
        daily\YYYY-MM-DD\
            database.dump          Supabase 'public' schema + data (pg_dump -Fc)
            database-schema.sql    the same schema as readable SQL
            cron-jobs.csv          the pg_cron jobs (they live outside 'public')
            storage-buckets.csv    photo bucket settings
            code.bundle            the whole git repository (git bundle --all)
            pc-settings.zip        C:\Homesavers settings + scheduled tasks, NO secrets
            MANIFEST.txt           what was saved, sizes, SHA-256, checks
        d1\YYYY-MM-DD-archive.sql.gz   Department Check archive (weekly, Sundays)
        photos\...                 copy of the task-photos bucket; photos the app deletes
                                   are removed from here 7 days later

Kept: 30 daily folders, 8 weekly archive exports; photos until 7 days after the app deletes them.
Product-master tables (prices, alt_barcodes, bm_daily_file, cn_code_master)
are saved as structure only: they are rebuilt from the daily source files.

NOT backed up, on purpose: passwords and keys. They are in Bitwarden.

One-off setup (downloads the PostgreSQL tools, stores the database password
on this PC only, tests the connection):
    "<python>" backup-app.py --setup
Normal run (the 03:00 scheduled task):
    "<python>" backup-app.py
Options: --skip-d1  --force-d1  --skip-photos  --dest <folder>
"""
from __future__ import annotations

import argparse
import datetime as dt
import getpass
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

# ── Settings ────────────────────────────────────────────────────────────────

DEST_CANDIDATES = [r"\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\HomesaversScannerBackup",
                   r"B:\Supply Chain & Buying - Shared\HomesaversScannerBackup"]
HOME         = r"C:\Homesavers"
REPO         = r"C:\Apps\HomesaversScanner"
PG_DIR       = os.path.join(HOME, "pgsql")                      # PostgreSQL client tools
PW_FILE      = os.path.join(HOME, ".supabase-db-password")      # secret: this PC only
CFG_FILE     = os.path.join(HOME, "backup-config.json")         # which pooler host works
LOG_FILE     = os.path.join(HOME, "logs", "backup-app.log")
SECRET_FILE  = os.path.join(HOME, ".sync-secret")
BASE_URL     = "https://homesaversscanner.pages.dev"
NPX          = r"C:\Program Files\nodejs\npx.cmd"

PROJECT_REF  = "eggspkdengnxktwkdwpw"
DB_USER      = f"postgres.{PROJECT_REF}"
# aws-1 is this project's pooler (confirmed 2026-11-10: aws-0 answers "tenant not found").
POOLER_HOSTS = ["aws-1-eu-central-1.pooler.supabase.com",
                "aws-0-eu-central-1.pooler.supabase.com"]
PHOTO_BUCKET = "task-photos"
PHOTO_URL    = f"https://{PROJECT_REF}.supabase.co/storage/v1/object/public/{PHOTO_BUCKET}/"
D1_NAME      = "homesavers-archive"
D1_ID        = "6c728765-d614-4282-a648-4b3fc3bf78fe"
CF_ACCOUNT   = "565191064c74a1e202aa0211133c895d"
D1_TOKEN_FILE = os.path.join(HOME, ".cloudflare-d1-export-token")   # secret: this PC only

# Database server is PostgreSQL 17: pg_dump must be 17 or newer.
PG_ZIPS = [f"https://get.enterprisedb.com/postgresql/postgresql-{v}-windows-x64-binaries.zip"
           for v in ("17.7-1", "17.6-2", "17.6-1", "17.5-1")]
STRUCTURE_ONLY = ["prices", "alt_barcodes", "bm_daily_file", "cn_code_master"]

KEEP_DAILY  = 30
KEEP_D1     = 8
PHOTO_GRACE_DAYS = 7   # photos deleted from the app stay in the backup this long
SECRET_KEYS = re.compile(r"pass|secret|token|key|cookie", re.I)


# ── Helpers ─────────────────────────────────────────────────────────────────

def log(msg, level="INFO"):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def record_run(status, message, size=0):
    """Show the result on Admin -> Settings -> Data Sync (kind 'backup'). Best-effort."""
    try:
        import requests
        with open(SECRET_FILE, encoding="utf-8") as f:
            secret = f.read().strip()
        requests.post(f"{BASE_URL}/api/sync-runs", timeout=30,
                      headers={"X-Sync-Secret": secret, "Content-Type": "application/json"},
                      json={"kind": "backup", "file_name": "HomesaversScannerBackup",
                            "file_size_bytes": size, "records_imported": round(size / 1e6),
                            "records_skipped": 0,
                            "status": status, "message": message[:900]})
    except Exception as e:
        log(f"Could not record the run on the dashboard: {e}", "WARN")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tool(name):
    p = os.path.join(PG_DIR, "bin", name + ".exe")
    if not os.path.exists(p):
        raise RuntimeError(f"{p} missing - run backup-app.py --setup first")
    return p


def pg_env():
    with open(PW_FILE, encoding="utf-8") as f:
        pw = f.read().strip()
    env = dict(os.environ, PGPASSWORD=pw, PGSSLMODE="require", PGCONNECT_TIMEOUT="30")
    return env


def conn_args(host):
    return ["-h", host, "-p", "5432", "-U", DB_USER, "-d", "postgres"]


def run(cmd, env=None, cwd=None, timeout=1800, stdout=None):
    r = subprocess.run(cmd, env=env, cwd=cwd, timeout=timeout,
                       stdout=stdout if stdout is not None else subprocess.PIPE,
                       stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        err = (r.stderr or b"").decode(errors="replace").strip()
        # never echo the password if a tool prints its environment
        raise RuntimeError(f"{os.path.basename(cmd[0])} failed: {err[-600:]}")
    return r


def psql_csv(host, sql, out_path):
    with open(out_path, "wb") as f:
        run([tool("psql"), *conn_args(host), "-X", "-q", "-v", "ON_ERROR_STOP=1",
             "-c", f"COPY ({sql}) TO STDOUT WITH CSV HEADER"], env=pg_env(), stdout=f)


def psql_rows(host, sql):
    r = run([tool("psql"), *conn_args(host), "-X", "-q", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1",
             "-c", sql], env=pg_env())
    return [line.split("\t") for line in r.stdout.decode("utf-8", "replace").splitlines() if line]


def first_dir(candidates):
    for p in candidates:
        if os.path.isdir(p):
            return p
    for p in candidates:
        if os.path.isdir(os.path.dirname(p)):
            os.makedirs(p, exist_ok=True)
            return p
    return None


def working_host():
    try:
        with open(CFG_FILE, encoding="utf-8") as f:
            return json.load(f)["pooler_host"]
    except Exception:
        return POOLER_HOSTS[0]


# ── Setup ───────────────────────────────────────────────────────────────────

def setup():
    import requests
    if os.path.exists(os.path.join(PG_DIR, "bin", "pg_dump.exe")):
        log(f"PostgreSQL tools already in {PG_DIR}")
    else:
        for url in PG_ZIPS:
            log(f"Downloading PostgreSQL tools: {url}")
            try:
                with requests.get(url, stream=True, timeout=60) as r:
                    if r.status_code != 200:
                        log(f"  not available ({r.status_code})", "WARN"); continue
                    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
                    for chunk in r.iter_content(1 << 20):
                        tmp.write(chunk)
                    tmp.close()
                with zipfile.ZipFile(tmp.name) as z:
                    members = [m for m in z.namelist() if m.startswith("pgsql/bin/") or m.startswith("pgsql/lib/")
                               or m.startswith("pgsql/share/")]
                    z.extractall(HOME, members)
                os.remove(tmp.name)
                break
            except Exception as e:
                log(f"  download failed: {e}", "WARN")
        if not os.path.exists(os.path.join(PG_DIR, "bin", "pg_dump.exe")):
            sys.exit("Could not download the PostgreSQL tools. Download 'PostgreSQL 17 Windows x86-64 "
                     "binaries (zip)' from enterprisedb.com and unzip its 'pgsql' folder to C:\\Homesavers\\pgsql.")
    ver = run([tool("pg_dump"), "--version"]).stdout.decode().strip()
    log(f"Using {ver}")

    if os.path.exists(PW_FILE):
        keep = input("A database password is already saved. Keep it? [Y/n]: ").strip().lower()
    else:
        keep = "n"
    if keep == "n":
        pw = getpass.getpass("Supabase DATABASE password (Bitwarden; paste with right-click, it stays hidden): ").strip()
        if not pw or any(ord(c) < 32 for c in pw):
            sys.exit("Nothing usable was pasted (Ctrl+V does not work here - use right-click).")
        with open(PW_FILE, "w", encoding="utf-8") as f:
            f.write(pw)
        log(f"Password saved to {PW_FILE} (this PC only; {len(pw)} characters received)")

    for host in POOLER_HOSTS:
        log(f"Testing the database connection via {host} ...")
        try:
            rows = psql_rows(host, "select current_setting('server_version'), count(*) from information_schema.tables where table_schema='public'")
            log(f"  OK: PostgreSQL {rows[0][0]}, {rows[0][1]} tables in 'public'")
            with open(CFG_FILE, "w", encoding="utf-8") as f:
                json.dump({"pooler_host": host}, f)
            break
        except Exception as e:
            log(f"  failed: {e}", "WARN")
            if "password authentication failed" in str(e):
                sys.exit("This is the right server, but it refused the PASSWORD. A password reset takes "
                         "a minute or two to apply: wait, then run --setup again and answer n to re-enter it "
                         "(copy it with Supabase's copy button, paste with right-click).")
    else:
        sys.exit("Could not connect to the database. Check the password (Supabase -> Project Settings -> "
                 "Database) and that this PC can reach the internet on port 5432, then run --setup again.")

    have = os.path.exists(D1_TOKEN_FILE)
    ans = input("Cloudflare token for the weekly archive export: " +
                ("keep the saved one? [Y/n]: " if have else "add it now? [Y/n]: ")).strip().lower()
    if (have and ans == "n") or (not have and ans != "n"):
        tok = getpass.getpass("Cloudflare API token with D1 Edit (paste with right-click, hidden): ").strip()
        if tok and not any(ord(c) < 32 for c in tok):
            with open(D1_TOKEN_FILE, "w", encoding="utf-8") as f:
                f.write(tok)
            log(f"Token saved to {D1_TOKEN_FILE} (this PC only; {len(tok)} characters)")
    if os.path.exists(D1_TOKEN_FILE):
        import requests
        with open(D1_TOKEN_FILE, encoding="utf-8") as f:
            tok = f.read().strip()
        r = requests.get(f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/d1/database/{D1_ID}",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=30)
        if r.status_code == 200:
            log(f"  OK: the token can see the archive database ({r.json()['result'].get('name')})")
        else:
            log(f"  token check failed ({r.status_code}): {r.text[:200]}", "WARN")

    dest = first_dir(DEST_CANDIDATES)
    log(f"Backup folder: {dest or 'NOT REACHABLE'}")
    if os.path.exists(NPX):
        log("Node/npx found (needed for the weekly archive export)")
    else:
        log(f"{NPX} not found - the weekly archive export will be skipped", "WARN")
    log("Setup finished. Now run backup-app.py once by hand to make the first backup.")


# ── Backup parts ────────────────────────────────────────────────────────────

def backup_database(host, day_dir, notes):
    dump = os.path.join(day_dir, "database.dump")
    excl = sum((["--exclude-table-data", f"public.{t}"] for t in STRUCTURE_ONLY), [])
    run([tool("pg_dump"), *conn_args(host), "-Fc", "-Z", "6", "--no-owner", "-n", "public", *excl,
         "-f", dump], env=pg_env(), timeout=3600)
    run([tool("pg_dump"), *conn_args(host), "-s", "--no-owner", "-n", "public",
         "-f", os.path.join(day_dir, "database-schema.sql")], env=pg_env())
    # Check the dump can be read back and holds every table's data.
    listing = run([tool("pg_restore"), "--list", dump]).stdout.decode("utf-8", "replace")
    data_entries = len(re.findall(r" TABLE DATA public ", listing))
    tables = int(psql_rows(host, "select count(*) from information_schema.tables "
                                 "where table_schema='public' and table_type='BASE TABLE'")[0][0])
    expected = tables - len(STRUCTURE_ONLY)
    if data_entries < expected:
        raise RuntimeError(f"database dump holds data for {data_entries} tables, expected {expected}")
    counts = psql_rows(host, "select relname, n_live_tup from pg_stat_user_tables "
                             "where schemaname='public' order by n_live_tup desc limit 12")
    notes.append(f"database: {tables} tables ({data_entries} with data); largest: "
                 + ", ".join(f"{t} {int(n):,}" for t, n in counts[:6]))
    psql_csv(host, "select jobname, schedule, command, active from cron.job order by jobname",
             os.path.join(day_dir, "cron-jobs.csv"))
    psql_csv(host, "select id, name, public, file_size_limit, allowed_mime_types from storage.buckets",
             os.path.join(day_dir, "storage-buckets.csv"))


def backup_photos(host, root, notes):
    import requests
    pdir = os.path.join(root, "photos")
    rows = psql_rows(host, f"select name, coalesce(metadata->>'size','0') from storage.objects "
                           f"where bucket_id='{PHOTO_BUCKET}' order by name")
    new = 0
    for name, size in rows:
        if ".." in name or name.startswith(("/", "\\")):
            continue
        local = os.path.join(pdir, *name.split("/"))
        if os.path.exists(local) and os.path.getsize(local) == int(size or 0):
            continue
        os.makedirs(os.path.dirname(local), exist_ok=True)
        r = requests.get(PHOTO_URL + "/".join(requests.utils.quote(p) for p in name.split("/")), timeout=60)
        if r.status_code == 200:
            with open(local + ".part", "wb") as f:
                f.write(r.content)
            os.replace(local + ".part", local)
            new += 1
        else:
            log(f"photo {name}: HTTP {r.status_code}", "WARN")

    # Photos the app has deleted are kept PHOTO_GRACE_DAYS more, then removed
    # (user, 2026-11-10: photos are not important; a week's safety net is enough).
    # The day each one was first seen missing is remembered in photos-removed.json.
    in_bucket = {os.path.normcase(os.path.join(pdir, *n.split("/"))) for n, _ in rows}
    state_path = os.path.join(root, "photos-removed.json")
    try:
        with open(state_path, encoding="utf-8") as f:
            missing_since = json.load(f)
    except Exception:
        missing_since = {}
    today = dt.date.today()
    still, removed = {}, 0
    if rows:   # an empty listing is more likely an error than an empty bucket: delete nothing
        for base, _dirs, files in os.walk(pdir):
            for fn in files:
                p = os.path.join(base, fn)
                if os.path.normcase(p) in in_bucket or fn.endswith(".part"):
                    continue
                rel = os.path.relpath(p, pdir)
                since = dt.date.fromisoformat(missing_since.get(rel, today.isoformat()))
                if (today - since).days >= PHOTO_GRACE_DAYS:
                    os.remove(p); removed += 1
                else:
                    still[rel] = since.isoformat()
        for base, dirs, files in os.walk(pdir, topdown=False):   # tidy empty folders
            if base != pdir and not dirs and not files:
                try:
                    os.rmdir(base)
                except OSError:
                    pass
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(still, f, indent=0)
    notes.append(f"photos: {len(rows)} in the bucket, {new} new copied, "
                 f"{len(still)} deleted from the app kept for now, {removed} removed after {PHOTO_GRACE_DAYS} days")


def backup_code(day_dir, notes):
    if not os.path.isdir(os.path.join(REPO, ".git")):
        notes.append(f"code: {REPO} not found - skipped"); return
    try:
        run(["git", "-C", REPO, "fetch", "--quiet", "origin"], timeout=300)
    except Exception as e:
        log(f"git fetch failed ({e}); bundling what is on this PC", "WARN")
    out = os.path.join(day_dir, "code.bundle")
    run(["git", "-C", REPO, "bundle", "create", out, "--all"], timeout=600)
    run(["git", "bundle", "verify", out], cwd=REPO)
    head = run(["git", "-C", REPO, "rev-parse", "--short", "origin/main"]).stdout.decode().strip()
    notes.append(f"code: git bundle of all branches (origin/main {head})")


def redact(obj):
    if isinstance(obj, dict):
        return {k: ("***" if SECRET_KEYS.search(k) and isinstance(v, str) and v else redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


def backup_pc_settings(day_dir, notes):
    out = os.path.join(day_dir, "pc-settings.zip")
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(HOME):
            rel_base = os.path.relpath(base, HOME)
            # skip big/derived folders and the PostgreSQL tools
            if rel_base.split(os.sep)[0] in ("pgsql", "logs", "bm-daily-inbound", "manifest-inbound", "manifest-preview"):
                dirs[:] = []; continue
            dirs[:] = [d for d in dirs if not d.startswith((".", "__pycache__"))]
            for fn in files:
                if fn.startswith(".") or fn.endswith((".tmp", ".part", ".pyc")):
                    continue                                  # .sync-secret, passwords, cookies
                p = os.path.join(base, fn)
                arc = os.path.join(rel_base, fn) if rel_base != "." else fn
                if fn.endswith(".json"):
                    try:
                        with open(p, encoding="utf-8-sig") as f:
                            data = redact(json.load(f))
                        z.writestr(arc, json.dumps(data, indent=2)); n += 1; continue
                    except Exception:
                        pass
                if os.path.getsize(p) > 20 * 1024 * 1024:
                    continue
                z.write(p, arc); n += 1
        # the scheduled tasks, as XML, so they can be re-imported exactly
        try:
            r = run(["schtasks", "/query", "/fo", "csv", "/nh"])
            names = sorted({row.split('","')[0].strip('"') for row in r.stdout.decode("utf-8", "replace").splitlines()
                            if "\\Homesavers" in row})
            for t in names:
                xml = run(["schtasks", "/query", "/tn", t, "/xml"]).stdout
                z.writestr("scheduled-tasks/" + t.strip("\\").replace("\\", "_") + ".xml", xml); n += 1
        except Exception as e:
            log(f"scheduled tasks not exported: {e}", "WARN")
    notes.append(f"pc settings: {n} files (secret files left out, passwords in .json blanked)")


def backup_d1(root, notes, force):
    d1dir = os.path.join(root, "d1")
    os.makedirs(d1dir, exist_ok=True)
    existing = sorted(f for f in os.listdir(d1dir) if f.endswith("-archive.sql.gz"))
    newest = existing[-1][:10] if existing else ""
    today = dt.date.today()
    due = force or today.weekday() == 6 or not newest or \
        (today - dt.date.fromisoformat(newest)).days >= 7
    if not due:
        notes.append(f"archive: weekly export not due (last {newest})"); return
    tmp = os.path.join(tempfile.gettempdir(), f"d1-{today}.sql")
    if os.path.exists(D1_TOKEN_FILE):
        d1_export_api(tmp)
    elif os.path.exists(NPX):
        cwd = os.path.join(REPO, "workers", "archiver")
        run([NPX, "--yes", "wrangler", "d1", "export", D1_NAME, "--remote", "--output", tmp],
            env=dict(os.environ, NO_COLOR="1", FORCE_COLOR="0"),
            cwd=cwd if os.path.isdir(cwd) else None, timeout=3600)
    else:
        raise RuntimeError(f"no {D1_TOKEN_FILE} and no Node - run backup-app.py --setup")
    if os.path.getsize(tmp) < 1024 * 1024:
        raise RuntimeError(f"archive export is only {os.path.getsize(tmp):,} bytes")
    out = os.path.join(d1dir, f"{today}-archive.sql.gz")
    with open(tmp, "rb") as src, gzip.open(out + ".part", "wb", compresslevel=6) as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    os.replace(out + ".part", out)
    os.remove(tmp)
    for old in sorted(f for f in os.listdir(d1dir) if f.endswith("-archive.sql.gz"))[:-KEEP_D1]:
        os.remove(os.path.join(d1dir, old))
    notes.append(f"archive: exported ({os.path.getsize(out) / 1e6:.0f} MB compressed)")


def d1_export_api(out_path):
    """Cloudflare's D1 export API (polling): start, poll until complete, then
    download the SQL from the signed URL. Needs a token with D1 Edit - the
    export locks the database while it runs, so Cloudflare treats it as a write."""
    import requests
    with open(D1_TOKEN_FILE, encoding="utf-8") as f:
        token = f.read().strip()
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/d1/database/{D1_ID}/export"
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {"output_format": "polling"}
    deadline = time.time() + 1800
    while True:
        r = requests.post(url, headers=h, json=body, timeout=120)
        j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code != 200 or not j.get("success"):
            raise RuntimeError(f"D1 export API {r.status_code}: {json.dumps(j.get('errors') or j)[:300]}")
        res = j.get("result") or {}
        status = res.get("status")
        if status == "complete":
            signed = (res.get("result") or {}).get("signed_url")
            if not signed:
                raise RuntimeError("D1 export finished without a download link")
            with requests.get(signed, stream=True, timeout=600) as d, open(out_path, "wb") as f:
                d.raise_for_status()
                for chunk in d.iter_content(1 << 20):
                    f.write(chunk)
            return
        if status == "error":
            raise RuntimeError(f"D1 export failed: {res.get('error') or res.get('messages')}")
        if time.time() > deadline:
            raise RuntimeError("D1 export did not finish within 30 minutes")
        body = {"output_format": "polling", "current_bookmark": res.get("at_bookmark")}
        time.sleep(3)


def prune_daily(root):
    ddir = os.path.join(root, "daily")
    days = sorted(d for d in os.listdir(ddir) if re.fullmatch(r"\d{4}-\d\d-\d\d", d))
    for d in days[:-KEEP_DAILY]:
        shutil.rmtree(os.path.join(ddir, d), ignore_errors=True)
        log(f"Removed old backup {d}")


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--setup", action="store_true", help="One-off: tools, password, connection test.")
    ap.add_argument("--dest", help="Backup folder (default: the HomesaversScannerBackup share folder).")
    ap.add_argument("--skip-d1", action="store_true")
    ap.add_argument("--force-d1", action="store_true", help="Export the archive even if not due.")
    ap.add_argument("--skip-photos", action="store_true")
    args = ap.parse_args()
    if args.setup:
        setup(); return 0

    started = time.time()
    log("=== App backup starting ===")
    notes, problems = [], []
    root = args.dest or first_dir(DEST_CANDIDATES)
    if not root:
        msg = f"backup folder not reachable: {DEST_CANDIDATES[0]}"
        log(msg, "ERROR"); record_run("error", msg); return 1
    day = dt.date.today().isoformat()
    day_dir = os.path.join(root, "daily", day)
    work = day_dir + ".part"
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    host = working_host()

    steps = [("database", lambda: backup_database(host, work, notes)),
             ("code", lambda: backup_code(work, notes)),
             ("pc settings", lambda: backup_pc_settings(work, notes))]
    if not args.skip_photos:
        steps.append(("photos", lambda: backup_photos(host, root, notes)))
    if not args.skip_d1:
        steps.append(("archive", lambda: backup_d1(root, notes, args.force_d1)))
    for name, fn in steps:
        try:
            log(f"-- {name}")
            fn()
        except Exception as e:
            log(f"{name} FAILED: {e}", "ERROR")
            problems.append(f"{name}: {e}")

    # Manifest: what is in today's folder, with checksums to spot later corruption.
    total = 0
    with open(os.path.join(work, "MANIFEST.txt"), "w", encoding="utf-8") as m:
        m.write(f"Homesavers Scanner app backup {day} (made {dt.datetime.now():%H:%M})\n\n")
        for fn in sorted(os.listdir(work)):
            if fn == "MANIFEST.txt":
                continue
            p = os.path.join(work, fn)
            total += os.path.getsize(p)
            m.write(f"{os.path.getsize(p):>14,}  {sha256(p)}  {fn}\n")
        m.write("\n" + "\n".join(notes) + "\n")
        if problems:
            m.write("\nPROBLEMS:\n" + "\n".join(problems) + "\n")
        m.write("\nRestore: see README-RESTORE.txt in the backup root (docs/backup-and-restore.md in the repo).\n")
    shutil.rmtree(day_dir, ignore_errors=True)
    os.replace(work, day_dir)
    try:
        src = os.path.join(REPO, "docs", "backup-and-restore.md")
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(root, "README-RESTORE.txt"))
        if not problems:            # never age out good backups while new ones are failing
            prune_daily(root)
    except Exception as e:
        log(f"housekeeping: {e}", "WARN")

    mins = (time.time() - started) / 60
    summary = f"{day}: {total / 1e6:.0f} MB in {mins:.0f} min. " + " | ".join(notes)
    if problems:
        msg = "PROBLEMS: " + " | ".join(problems) + " || " + summary
        log(msg, "ERROR"); record_run("error", msg, total)
        log("=== App backup finished WITH PROBLEMS ===")
        return 1
    log(summary)
    record_run("ok", summary, total)
    log("=== App backup finished OK ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
