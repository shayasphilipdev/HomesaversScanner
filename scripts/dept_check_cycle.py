"""The stores' 3-week Department Check cycle, shared by the two dept-check emails.

Since week 44 of 2026 the stores no longer check every department every week.
They run a repeating 3-week cycle:

    week 1  FMCG departments        (anchor: Monday 2026-10-26, week 44)
    week 2  all other departments   (2026-11-02, week 45)
    week 3  no Department Check     (2026-11-09, week 46)
    ...then FMCG again              (2026-11-16, week 47)

This was read from the records, not assumed: in weeks 44 and 47 about 90% of
records were FMCG departments, in week 45 about 90% were non-FMCG, and week 46
had a sixth of a normal week's volume, from only 35 stores.

Consequences for the emails:
  * an "off" week gets no email at all;
  * an FMCG week is judged on FMCG departments only, a non-FMCG week on the
    rest. A store is "missed" when it logged nothing in that week's group;
  * the comparison week is the same kind of week one cycle (3 weeks) earlier,
    because the week just before is always a different kind.

If the stores' rota shifts (Christmas, say), set "cycle_anchor" in the config
file to the Monday of any FMCG week and the rest follows. "fmcg_departments"
in the config replaces the list below.
"""
from __future__ import annotations

import datetime as dt

DEFAULT_ANCHOR = "2026-10-26"          # Monday of an FMCG week

DEFAULT_FMCG = [
    "HEALTH & BEAUTY",
    "H&B Gift",
    "FOOD",
    "CONFECTIONERY",
    "SOFT DRINKS",
    "PAPER GOODS & CLEANING",
    "PET FOOD",
    "Grocery Seasonal",
]

FMCG, OTHER, OFF = "fmcg", "other", "off"
LABELS = {FMCG: "FMCG departments", OTHER: "Non-FMCG departments", OFF: "No Department Check"}
SHORT = {FMCG: "FMCG", OTHER: "Non-FMCG", OFF: "no-check"}
NO_DEPT = "(none)"                     # backend marker for records with no department


def _monday(d):
    if isinstance(d, str):
        d = dt.date.fromisoformat(d[:10])
    if isinstance(d, dt.datetime):
        d = d.date()
    return d - dt.timedelta(days=d.weekday())


def week_type(day, cfg=None):
    """'fmcg', 'other' or 'off' for the week containing `day`."""
    anchor = _monday((cfg or {}).get("cycle_anchor") or DEFAULT_ANCHOR)
    weeks = (_monday(day) - anchor).days // 7
    return (FMCG, OTHER, OFF)[weeks % 3]


def fmcg_set(cfg=None):
    return {d.upper() for d in ((cfg or {}).get("fmcg_departments") or DEFAULT_FMCG)}


def in_group(dept, kind, fmcg):
    if dept == NO_DEPT:
        return False                   # unattributed: belongs to neither group
    is_fmcg = dept.upper() in fmcg
    return is_fmcg if kind == FMCG else not is_fmcg


def filter_report(data, kind, cfg=None):
    """Return a copy of a /api/reports/dept-check-week response restricted to one
    department group. Same shape, so the email builders need no other change:
    stores[].records/departments/departments_breakdown/did_check, missed[],
    totals and department_totals are all recomputed from the breakdowns."""
    if not data or kind == OFF:
        return data
    fmcg = fmcg_set(cfg)
    out = dict(data)

    stores = []
    for s in data.get("stores") or []:
        bd = {d: n for d, n in (s.get("departments_breakdown") or {}).items()
              if in_group(d, kind, fmcg)}
        recs = sum(bd.values())
        stores.append({**s, "departments_breakdown": bd, "records": recs,
                       "departments": len(bd), "did_check": recs > 0})
    out["stores"] = stores
    out["missed"] = sorted((s for s in stores if not s["did_check"]),
                           key=lambda s: s.get("store_name") or "")

    totals = {}
    for s in stores:
        for d, n in s["departments_breakdown"].items():
            totals[d] = totals.get(d, 0) + n
    out["department_totals"] = [{"department": d, "records": n}
                                for d, n in sorted(totals.items(), key=lambda kv: -kv[1])]

    did = sum(1 for s in stores if s["did_check"])
    out["totals"] = {**(data.get("totals") or {}),
                     "stores": len(stores), "did": did, "missed": len(stores) - did,
                     "records": sum(totals.values()),
                     "departments": sum(s["departments"] for s in stores)}
    out["cycle"] = kind
    return out
