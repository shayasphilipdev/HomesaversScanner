"""
Homesavers Scanner - Space Plan status (simple, one-off Excel report).

One row per store with three plain numbers and a plain-English status:
  Planned     = total equipment Head Office planned for the store
  Entered     = total count the store has entered (that store only)
  Not Planned = of what they entered, how much was for equipment with no plan

Build the input JSON by running this SQL (Supabase SQL editor) and saving the
result array to a .json file, then run:  python spaceplan-status-report.py in.json out.xlsx

  WITH plan AS (
    SELECT store_id, COUNT(*) FILTER (WHERE planned_count>0) AS equip_planned,
           COALESCE(SUM(planned_count),0) AS planned_total
    FROM space_plan_planned GROUP BY store_id),
  ent AS (
    SELECT store_id, COALESCE(SUM(audited_count),0) AS entered_total,
           MAX(updated_at) AS last_entry
    FROM space_plan_counts GROUP BY store_id),
  noplan AS (
    SELECT c.store_id, COALESCE(SUM(c.audited_count),0) AS entered_not_planned
    FROM space_plan_counts c
    LEFT JOIN space_plan_planned p
      ON p.store_id=c.store_id AND p.equipment_id=c.equipment_id AND p.planned_count>0
    WHERE p.equipment_id IS NULL GROUP BY c.store_id)
  SELECT s.store_code, s.store_name,
         COALESCE(plan.equip_planned,0)        AS equip_types_planned,
         COALESCE(plan.planned_total,0)        AS planned_total,
         COALESCE(ent.entered_total,0)         AS entered_total,
         COALESCE(noplan.entered_not_planned,0) AS entered_not_planned,
         ent.last_entry::date                  AS last_entry
  FROM stores s
  LEFT JOIN plan   ON plan.store_id=s.id
  LEFT JOIN ent    ON ent.store_id=s.id
  LEFT JOIN noplan ON noplan.store_id=s.id
  ORDER BY s.store_name;
"""
import json, sys, datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

rows = json.load(open(sys.argv[1]))

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Space Plan Status"

# palette
HEAD = PatternFill("solid", fgColor="1F3864")
GREEN = PatternFill("solid", fgColor="C6EFCE")
AMBER = PatternFill("solid", fgColor="FFEB9C")
RED = PatternFill("solid", fgColor="FFC7CE")
GREY = PatternFill("solid", fgColor="F2F2F2")
white = Font(color="FFFFFF", bold=True, size=11)
thin = Side(style="thin", color="BFBFBF")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
center = Alignment(horizontal="center", vertical="center")
left = Alignment(horizontal="left", vertical="center")

# title
ws.merge_cells("A1:F1")
ws["A1"] = "Space Plan Status  -  " + datetime.date.today().strftime("%d %b %Y")
ws["A1"].font = Font(bold=True, size=14, color="1F3864")
ws["A1"].alignment = Alignment(horizontal="left", vertical="center")
ws.row_dimensions[1].height = 24

ws.merge_cells("A2:F2")
ws["A2"] = ("Planned = what Head Office planned for the store.   "
            "Entered = total the store has entered (that store only).   "
            "Not Planned = entries made for equipment that had no plan.")
ws["A2"].font = Font(italic=True, size=9, color="595959")
ws["A2"].alignment = Alignment(horizontal="left", vertical="center")
ws.row_dimensions[2].height = 16

headers = ["Store Code", "Store", "Planned", "Entered", "Not Planned", "Status"]
hr = 4
for c, h in enumerate(headers, 1):
    cell = ws.cell(row=hr, column=c, value=h)
    cell.fill = HEAD; cell.font = white; cell.alignment = center; cell.border = border
ws.row_dimensions[hr].height = 20


def status(p, e, np_):
    if p == 0 and e == 0:
        return "No plan, nothing entered", RED
    if p == 0 and e > 0:
        return "Entered without a plan", AMBER
    if p > 0 and e == 0:
        return "Plan set, nothing entered", RED
    if e >= p:
        return "Done", GREEN
    return "In progress", AMBER


rows.sort(key=lambda r: r["store_name"])
r = hr + 1
tp = te = tn = 0
for d in rows:
    p = int(d["planned_total"]); e = int(d["entered_total"]); np_ = int(d["entered_not_planned"])
    tp += p; te += e; tn += np_
    label, fill = status(p, e, np_)
    vals = [d["store_code"], d["store_name"], p, e, np_, label]
    for c, v in enumerate(vals, 1):
        cell = ws.cell(row=r, column=c, value=v)
        cell.border = border
        cell.alignment = left if c in (1, 2) else center
        if c == 6:
            cell.fill = fill
            cell.font = Font(bold=True, size=10)
        elif c == 5 and np_ > 0:
            cell.font = Font(bold=True, color="C00000")
    r += 1

# totals
for c, v in enumerate(["", "TOTAL", tp, te, tn, ""], 1):
    cell = ws.cell(row=r, column=c, value=v)
    cell.fill = GREY; cell.border = border
    cell.font = Font(bold=True)
    cell.alignment = left if c in (1, 2) else center

widths = [12, 30, 11, 11, 13, 26]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

ws.freeze_panes = "A5"
ws.sheet_view.showGridLines = False

out = sys.argv[2]
wb.save(out)
print("saved", out)
