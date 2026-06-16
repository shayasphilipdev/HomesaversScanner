# Homesavers Scanner App — CLAUDE.md

Lightweight orientation. **Full, current detail: `Project_Status.MD`** (read it first in a new session) · `CLAUDE_CODE_INSTRUCTIONS.md`

---

## What it is

Retail task/query reporting PWA for Homesavers Ireland (~55 stores).
Store staff scan products and log issues across 11 task types; Support Office reviews (with per-record message threads). Also: Store Tasks checklists, **Space Plan** equipment-count collection, Reports/Dashboard, Suppliers, a weekly status-report email. Single login (username + PIN), role-based scope. See `Project_Status.MD` for everything.

Live: https://homesaversscanner.pages.dev  
Repo: https://github.com/shayasphilipdev/HomesaversScanner  
Local: `C:\Scraping\homesavers-scanner`  
Supabase: `eggspkdengnxktwkdwpw`  
Cloudflare: `565191064c74a1e202aa0211133c895d`

---

## Stack

React 18 + Vite · plain JS · react-router-dom v6  
Cloudflare Pages static + Pages Function (`functions/api/[[route]].js`)  
Supabase PostgreSQL (no RLS, no Supabase Auth)  
Supabase Storage `task-photos` (public-read)  
PWA: `sw.js` + `manifest.webmanifest` · Offline: IndexedDB outbox  
Auth: PIN → HMAC-signed token (Web Crypto)

---

## Roles (Phase 9 — current definitive list)

| Display name | System key | Notes |
|---|---|---|
| Sales Assistant | `sales_assistant` | Basic store staff. Submit HQ tasks; complete store tasks. |
| Store Manager | `store_manager` | + store task completion stats; own store reports |
| Area Manager | `area_manager` | Area-wide stats; **can create tasks** |
| Store Support Administrator | `support_admin` | Review/process HQ task records |
| Buying Manager | `buying_manager` | Former "Operations Manager". Full back office + **can create tasks** |
| Buying Head | `buying_head` | All-store reports + **can create tasks** _(renamed from Commercial Manager in 9B3)_ |
| Admin | `admin` | Full system access + **can create tasks** _(renamed from Director in 9B3)_ |

**Task creators:** `buying_manager` · `area_manager` · `buying_head` · `admin`

**⚠ Rename history:** `operations_manager` → `buying_manager` · `store_colleague` → `sales_assistant` · `director` → `admin` · `commercial_manager` → `buying_head` _(latest, Phase 9B3)_. Search the entire codebase for old strings before making changes.

---

## Two task systems

### System 1 — HQ task records (existing, Phases 0–7)
Store submits error (UOM, price, non-scan, etc.) → back office reviews → marks complete or no change. Task types A–I.

### System 2 — Store operational tasks (Phase 9, new)
Self-managed checklists. No back office review. Store users see own store only. Area Manager+ see aggregate compliance %.  
47 standard templates across 6 frequencies. See `docs/phase9-store-tasks-and-roles.md`.

**Task targeting (when creating):**
- Store scope: `all` / `area` (area_ids[]) / `stores` (store_ids[]) / `one` (store_ids with 1 entry)
- Assigned-to role: any role key, or `all` — back-office roles ignore store scope

---

## Products — supplier link (Phase 9)

`products.supplier_id` (uuid, nullable FK → `suppliers.id`) added in Phase 9.

When a Sales Assistant scans a product, the lookup response includes `supplier_name` (joined from `suppliers`). Displayed as a subtle secondary line in the scan result. If no supplier linked, line is omitted.

Admin Products page: supplier dropdown in product edit form; CSV bulk-upsert accepts optional `supplier_name` column (resolved to `supplier_id` by name match).

---

## Database tables

### Existing (Phases 0–7)
`stores` · `products` · `suppliers` · `task_types` · `lookup_options` · `task_records` · `app_settings`

### Phase 9 additions
`areas` · `users` · `store_task_templates` · `store_task_instances`

#### products change
```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
```

#### store_task_templates
```
id · title · description · instructions · category · frequency · due_window
requires_photo · requires_notes · applies_to · area_ids · store_ids
assigned_to_role · is_active · sort_order · created_at · updated_at
```
frequency: `daily | weekly | monthly | yearly | once_off`  
applies_to: `all | area | stores | one`

#### store_task_instances
```
id · template_id · store_id · period_key · due_date · status
completed_by · completed_at · photo_url · notes · created_at
UNIQUE (template_id, store_id, period_key)
```
status: `pending | completed | missed`  
period_key examples: `2025-05-16` (daily) · `2025-W21` (weekly) · `2025-05` (monthly) · `2025` (yearly) · `once_<ulid>` (once-off)

---

## API surface

All `/api/*` → `functions/api/[[route]].js` · Auth: `Authorization: Bearer <token>`

### Phase 9 new routes
| Method | Path | Guard |
|---|---|---|
| GET/POST | `/admin/task-templates` | `buying_manager`, `area_manager`, `buying_head`, `admin` |
| PATCH/DELETE | `/admin/task-templates/:id` | same |
| GET | `/store-tasks/today` | auth |
| PATCH | `/store-tasks/:id/complete` | auth |
| GET | `/store-tasks/stats` | auth |
| POST | `/store-tasks/generate` | task creators |

Instance generation: lazy — `ensureInstancesExist(db, storeId, date)` called by `/store-tasks/today`, not a scheduler.

---

## Frontend pages

### Phase 9 new pages
| Route | Visible to |
|---|---|
| `/store-tasks` | all roles |
| `/store-tasks/history` | `store_manager`+ |
| `/store-tasks/stats` | `store_manager`+ |
| `/admin/task-templates` | task creators |
| `/admin/areas` | `buying_manager`, `admin` |
| `/admin/users` | `buying_manager`, `admin` |

### Existing pages (unchanged routes)
`/dashboard` · `/tasks` · `/reports` · `/sync` · `/admin/stores` · `/admin/suppliers` · `/admin/lookups` · `/admin/products` · `/admin/settings`

---

## Phase status

| Phase | Title | Status |
|---|---|---|
| 0–7 | Foundation → PWA/offline | ✅ done |
| 8 | Old roles/areas design | ⏸ superseded |
| 9A | Areas admin UI + store dropdown | ✅ done |
| 9B | Users table + role-aware auth + Staff/HQ login tab | ✅ done |
| 9B2 | Employees admin (single role per employee) | ✅ done — HR fields on `users` (email, phone, department, employee_code, start_date, notes). One role per employee. New `/admin/employees` page filters to HQ staff with single-role dropdown and an inline "what can this role do?" reference. Role catalogue lives in `client/src/lib/roles.js`. The earlier multi-role `roles[]` column is unused; left in the schema. |
| 9C | products.supplier_id + lookup join + admin dropdown | ✅ done |
| 9D | Task templates table + admin CRUD + create modal | ✅ done |
| 9E | Store tasks page + completion + lazy generator + stats | ✅ done (no template seeds shipped) |
| 9F | Store task form-builder + advanced targeting | ✅ done — `blocks` jsonb on templates; `answers` jsonb on instances. Block types: text · long text · number · amount · date · time · yes/no · single choice · multi choice · photo. Targeting: multi-role + specific employees + start/end window. **Only Store Tasks** (Phase 9D/9E system); HQ task records (Task Types A–I) untouched. |
| 9J | Stores-as-master + single login + multi-store scope + task toggles | ✅ done — `stores.pin_hash` dropped. New roles `supervisor` + `assistant_store_manager`. Single `/users/verify-pin` login (no Store / Staff tabs). New `users.all_stores`, `users.store_ids[]`, `users.area_ids[]`, `users.can_access_hq_tasks`, `users.can_access_store_tasks`. `user_areas` join table dropped. Backend `scopedStoreIds()` drives every multi-store filter. AdminEmployees consolidates store + HQ accounts with `ScopePicker` + two task toggles. |
| 9K | Mandatory store picker · Dashboard scope · HQ→HO rename · wider layout | ✅ done — `CurrentStoreProvider` context so multi-store users must explicitly pick before logging an HO task. Top-of-screen context chip shows `Store Login / Head Office Login · <store>`. Dashboard scope is now a grouped dropdown (All / By area / By store) and Reports filter row is compact one-line. Every user-visible "HQ" label renamed to "HO". |
| 9L | Clear status · photo links · DRS deposit calc · supplier resolve · B optional · import dedup | ✅ done — `task_records.cleared_at` column + `cleared` status hidden from default views; backend `?includeCleared=1` to opt back in. `/task-records` embeds `suppliers(supplier_name)`. Photo URLs surfaced in Reports table + CSV. `TaskFForm` shows live "💰 DRS deposit: N × Xc = €Y.YY" once size + units are set. `TaskBForm` UOM/Quantity optional. `/admin/products/bulk` dedupes by `product_id` to avoid Postgres "cannot affect row a second time". `AdminProducts` UI chunks uploads with progress bar. |
| 9M | Product master sync · scope-aware capacity | ✅ done — daily 06:00 PowerShell job (`scripts/sync-products.ps1`) reads the latest workbook from a configurable network folder, trims to ~6 columns by alias, drops rows with no supplier_code, posts to `/api/products/sync` in 2,000-row chunks. Folder/file pattern editable in Admin → Settings. Supabase capacity meters (DB + Storage) on Admin → Settings for `admin` role only; flashing nav chip when usage ≥ 70/85%. New `/admin/cleanup/task-records` purges cleared records older than `scan_record_retention_days`. |
| 9N | Block builder expansion · multi-select dropdowns | ✅ done — new block types: temperature, percentage, rating, signature, file upload, auto-calculated (sum/avg/min/max/diff). Display blocks: heading, instruction, alert (info/warning/danger/success), divider. `MultiSelectDropdown` with checkbox + Select all / Clear all replaces chip rows and report `<select>`s. Required/optional toggle per block. `/photos/upload` preserves file extensions for the `store_task` slot. Inline category picker (`+ Add` writes to lookup_options on the spot). |

---

## Local dev

```powershell
cd C:\Scraping\homesavers-scanner\client && npm run dev   # Vite :5173
cd C:\Scraping\homesavers-scanner
npx wrangler pages dev --proxy 5173                        # Pages :8788
```

`.dev.vars`: `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SESSION_SECRET`

## Deploy

Push to `main` → Cloudflare Pages auto-deploys (~1–2 min).  
Build: `cd client && npm install && npm run build` → `client/dist`

## Known limitations

- `/dashboard/stats` fetches up to 5k records and aggregates in JS — add SQL aggregation past ~50k records
- `/task-records` GET has no pagination — add limit + cursor when needed
- PIN brute force is unrate-limited — add Cloudflare WAF rule when scaling
- Daily product sync depends on `Y:` being mapped under the scheduled task's account; switch to UNC path if it isn't (see `scripts/README-sync-products.md`)
- Capacity meter polls every 10 min — usage above the limit can spike between polls; the underlying RPC is cheap so this is fine for now
