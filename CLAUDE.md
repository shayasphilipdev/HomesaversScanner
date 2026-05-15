# Homesavers Scanner App

## Project overview

Retail Task / Error reporting app for Homesavers Ireland — 55 stores.
**Stack:** React 18 + Vite (frontend) · Cloudflare Pages Functions (backend API) · Supabase PostgreSQL (database).
**Deploy:** Cloudflare Pages only — single project, auto-deploys on every GitHub push.
**No Supabase Auth. No RLS.** Access controlled by PIN, isolation enforced at application layer via HMAC-signed session tokens.

Live URL: https://homesaversscanner.pages.dev/
GitHub: https://github.com/shayasphilipdev/HomesaversScanner

---

## Concept

The app collects **task records** from store staff. There are many **task types** (A–I, expandable), each with its own form fields. Records flow:

```
pending  ──► completed (HQ)  ──► store_completed (store confirms)
```

### Task types

| Code | Name | Frequency | Form fields |
|---|---|---|---|
| A | UOM Errors | daily | product_code, description (opt), uom, quantity, supplier, notes |
| B | Non-Scans | daily | barcode, description, uom, quantity, **2 mandatory photos** (product + barcode), supplier, notes |
| C | Wrong Prices | daily | product_code, reason_code (master), current_price (opt), notes |
| D | Wrong Description | daily | product_code, product_name_on_product, barcode, notes |
| E | Price Marked Products | daily | product_code, price_marked_price, supplier, notes |
| F | DRS Errors | daily | product_code, drs_size (master), units_per_package, supplier, notes — warning *"Check for Return Logo"* |
| G | Promotion Error | daily | product_code, promotion_description, promotion_price, notes |
| H | Stock Count | once_off | product_code, shop_floor_count, notes |
| I | Miscellaneous Tasks | once_off | product_code, product_name_on_product, barcode, notes |

New types can be added by inserting into `task_types`. Form schema for each lives in `client/src/lib/taskTypes.js`.

---

## Phased roadmap

| Phase | Title | Status | Scope |
|---|---|---|---|
| 0 | Foundation | ✅ done | Auth (PIN + HMAC tokens), deploy, Task A baseline, camera/scanner/manual entry |
| **1** | **Task Types + Suppliers re-foundation** | ✅ done | DB reshape, generic lookup_options master, suppliers master, Task A wired in new model |
| **2A** | **Task B + photo infrastructure** | ✅ done | `task-photos` Supabase Storage bucket, `/photos/upload` + `/photos` DELETE endpoints, client-side JPEG compression, reusable form widgets (ScannerInput, SupplierPicker, PhotoCapture), TaskBForm |
| **2B** | **Tasks D + I (Wrong Description, Miscellaneous)** | ✅ done | Shared TaskDIForm component (identical field sets); product_code + product_name_label + product_barcode + notes |
| **2C** | **Tasks C + E + G (Prices)** | ✅ done | C — Wrong Prices (reason_code from lookup_options, optional current_price). E — Price Marked Products (price_marked_price, supplier). G — Promotion Error (promotion_description + promotion_price). All type-specific fields stored in `details` JSONB. |
| 2D | Task F (DRS Errors) | next | drs_size dropdown + units_per_package + "Check for Return Logo" warning |
| 2E | Task H (Stock Count) | | shop_floor_count + notes |
| 3 | Master admin (back office) | | CRUD UI for Stores, Suppliers, Reason Codes, DRS Sizes, Products. CSV bulk upload |
| 4 | Reports + Modern Dashboard | | Per-task-type CSV with type-specific columns. Combined "All" report. Multi-filter (stores, task types, datetime). KPIs and charts |
| 5 | Responsive PC layout | | Sidebar nav on desktop, top nav on mobile. Wider tables on PC. Polish |
| 6 | Frequency grouping & scheduling | | Daily/Weekly/Monthly/Once-Off groups. Optional scheduling rules |
| 7 | Offline queue | | IndexedDB queue + service worker. Scan offline, sync on reconnect |

### Decisions on record (Q1–Q6)

- **Q1** Frequency stored on `task_types.frequency`; UI grouping in Phase 6, scheduling rules optional later.
- **Q2 + Q3** Reason Codes and DRS Sizes use a generic `lookup_options` master with a `task_types[]` array — each option can apply to multiple task types.
- **Q4** Supplier = dropdown from master + free-text fallback. Record stores either `supplier_id` or `supplier_name_text`. Reports COALESCE.
- **Q5** Existing test records wiped during Phase 1.
- **Q6** Task B requires **2 mandatory photos** (one product, one barcode), camera or gallery. Retention 7 days per `app_settings`.

---

## Architecture

```
Browser (React SPA)
  │  /api/* requests, Authorization: Bearer <HMAC token>
  ▼
Cloudflare Pages (serves client/dist + functions/)
  │  functions/api/[[route]].js — auth, routing, all backend logic
  │  reads SUPABASE_URL (wrangler.toml [vars]), SUPABASE_ANON_KEY (secret),
  │  SESSION_SECRET (secret) for HMAC
  ▼
Supabase REST API  (PostgreSQL, no RLS)
```

### Repo

```
homesavers-scanner/
├── client/                            React + Vite (mobile-first, PC-friendly)
│   └── src/
│       ├── components/
│       │   ├── Nav.jsx
│       │   ├── StoreSelector.jsx
│       │   ├── TaskTypePicker.jsx     chips grouped by frequency
│       │   ├── TaskForm.jsx           slim dispatcher → forms/Task*Form.jsx
│       │   ├── TaskRecordList.jsx     table with task_type column
│       │   └── forms/
│       │       ├── ScannerInput.jsx   scanner-gun + camera + lookup widget
│       │       ├── SupplierPicker.jsx supplier dropdown + free-text fallback
│       │       ├── PhotoCapture.jsx   compress + preview + retake
│       │       ├── TaskAForm.jsx      UOM Errors
│       │       └── TaskBForm.jsx      Non-Scans (with 2 mandatory photos)
│       ├── pages/
│       │   ├── Tasks.jsx              picker + form + list
│       │   └── Reports.jsx            CSV with task_type filter
│       ├── lib/
│       │   ├── api.js                 fetch wrapper, token handling, 401 auto-logout
│       │   ├── photos.js              compressImage + tempId helper
│       │   ├── taskTypes.js           per-type form schema metadata
│       │   └── uom.js                 UOM dropdown + Eachs warning
│       ├── App.jsx                    routes + session split (BO=sessionStorage, store=localStorage)
│       └── App.css
├── functions/
│   └── api/[[route]].js               Pages Function — catch-all router
├── supabase-schema.sql                initial schema (Phase 0)
├── .dev.vars.example                  template — SUPABASE_URL/_ANON_KEY/SESSION_SECRET
├── wrangler.toml                      Pages config + [vars] SUPABASE_URL
└── CLAUDE.md                          this file
```

---

## Database schema (current)

### `stores`
`id · store_code (unique) · store_name · region · pin_hash · is_active · created_at`

### `products` (Product Master)
`id · product_id (unique text) · description · uom · category · is_active · updated_at`

### `suppliers` (Supplier Master — Phase 1)
`id · supplier_code · supplier_name · is_active · created_at · updated_at`

### `task_types` (Phase 1 — reference table)
`code (PK, 'A'..'I') · name · frequency (daily|weekly|monthly|once_off) · sort_order · is_active`

### `lookup_options` (Phase 1 — generic master for dropdowns)
`id · kind ('reason_code'|'drs_size'|…) · label · task_types[] (which task types use this option) · sort_order · is_active`

### `task_records` (Phase 1 — was `product_records`)
Common columns:
`id · store_id (FK) · task_type (FK→task_types) · status · marked_for_deletion · completed_at · store_completed_at · created_at · updated_at`

Promoted columns (used by ≥2 task types):
`product_code · product_barcode · product_name_label · description · uom · quantity · supplier_id (FK→suppliers, nullable) · supplier_name_text (free text fallback) · notes · photo_product_url · photo_barcode_url`

Type-specific fields go in `details jsonb` (e.g. reason_code, current_price, price_marked_price, drs_size, units_per_package, promotion_description, promotion_price, shop_floor_count).

### `app_settings` (key/value)
`backoffice_pin_hash · list_auto_close_hours · scan_record_retention_days · photo_retention_days`

### SQL functions
`verify_pin(hash, pin) → table(result boolean)` — runs `crypt(pin, hash) = hash` in-database.

### Indexes
`idx_tr_store_id · idx_tr_task_type · idx_tr_status · idx_tr_created_at · idx_tr_store_date · idx_tr_supplier · idx_suppliers_active · idx_lookup_kind`

---

## API surface (current)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET    | `/stores` | public | login screen |
| POST   | `/stores/verify-pin` | public | returns `{ ok, token, store }` |
| POST   | `/backoffice/verify-pin` | public | returns `{ ok, token }` |
| GET    | `/task-types` | auth | reference data |
| GET    | `/lookup-options?kind=reason_code&task_type=C` | auth | dropdown options |
| GET    | `/suppliers` | auth | active suppliers for dropdown |
| GET    | `/products/lookup?code=…` | auth | Product Master lookup |
| POST   | `/photos/upload` | auth | multipart/form-data: `file`, `slot=product\|barcode`, `tempId`. Returns `{ url, path }` |
| DELETE | `/photos?path=…` | auth | cleanup (used on save failure) |
| GET    | `/task-records?task_type=A&status=pending&storeId=…` | auth | store users always scoped to own store |
| POST   | `/task-records` | auth | server forces `store_id = token.storeId` for store users |
| PATCH  | `/task-records/:id` | auth | store users limited to own store |
| DELETE | `/task-records/:id` | auth | store users limited to own `store_completed` records |
| GET    | `/reports/task-records?from=&to=&storeId=&task_type=` | auth | CSV |

Admin write endpoints for suppliers / task_types / lookup_options are deferred to Phase 3.

---

## Local dev

```bash
cd client && npm install && npm run dev          # Vite on :5173
cp .dev.vars.example .dev.vars                    # add SUPABASE_URL/_ANON_KEY/SESSION_SECRET
npx wrangler pages dev --proxy 5173               # CF Pages on :8788
```

`SUPABASE_URL` lives in `wrangler.toml [vars]`; `SUPABASE_ANON_KEY` and `SESSION_SECRET` are Cloudflare Pages Secrets (set in dashboard).

---

## Session credentials (current)

- **Back office**: PIN `hjd456*`
- **Store 1015 (Tallaght)**: PIN `9876`

---

## Coding conventions

- Plain ES5/ES2020 JS — no TypeScript, no module bundler config beyond Vite defaults.
- React functional components + hooks.
- No CSS framework; all styles in `App.css` using CSS custom properties.
- Cloudflare Pages Function uses Web Crypto (`crypto.subtle`) — no Node-only deps.
- Mobile-first CSS; PC sidebar nav lands in Phase 5.
