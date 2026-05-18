# Homesavers Scanner — Project Status

A full snapshot of the app as it stands today. Intended as a self-contained
orientation doc for any Claude session that opens this repo cold.

> **What changed in Phase 9J** (latest, live):
> - **Stores are now master records, no PINs.** `stores.pin_hash` dropped. Old `/stores/verify-pin` and `/backoffice/verify-pin` endpoints removed.
> - **Single login form** — username + PIN for every employee. No more "Store" vs "Staff/HQ" tabs.
> - **Two new roles**: `supervisor` and `assistant_store_manager`. Role catalogue in `client/src/lib/roles.js`.
> - **Multi-store / multi-area scope per employee.** New columns on `users`: `all_stores`, `store_ids uuid[]`, `area_ids uuid[]`. The old single `store_id` is kept in sync with `store_ids[0]` for backward compat. The `user_areas` join table is gone (data merged into `users.area_ids`).
> - **Per-employee task toggles**: `can_access_hq_tasks` and `can_access_store_tasks`. Hide either system entirely for a specific employee. Enforced both server-side (the API endpoints 403) and in the nav (links hidden).
> - **Server scope helper** `scopedStoreIds(db, session)` drives every multi-store filter (task records, store tasks, reports, dashboard). Returns `null` for admin / all_stores (no filter), `[]` for no scope, or the concrete set of store IDs.
> - **AdminStores**: PIN field gone; Reset PIN button gone. Stores are just master records.
> - **AdminEmployees** is now the unified employee admin (store + HQ). Single-role dropdown · `ScopePicker` component for store/area scope · two task-access toggles. The old "All users" tab is removed.
> - **Migration notes**: existing 8 sales_assistant accounts (one per store) keep working — they sign in with username = their store_code. Admin user's username is still `director` (only the role changed in earlier phases).
> - **Known gap for v1**: multi-store users (>1 store) can't yet pick a "current store" in the Tasks UI — that picker is a follow-up. Single-store users and `all_stores=true` admins work fully.
>
> **Phase 9G–9H**:
> - **9G — Store-task reports**: Reports page now has "HQ records" + "Store tasks" tabs. New `/api/reports/store-tasks` (CSV with answers flattened per block label) and `/api/reports/store-tasks/json` (on-screen table).
> - **9H — Permission tightening**: admin pages (`/admin/stores · areas · users · employees · suppliers · lookups · products · settings`) now require role `admin` or `buying_manager`. Task templates remain open to all task creators. `mode==='backoffice'` fallback removed from `isAdminRole` / `isBackOffice`. New `AdminGuard` wraps the routes; nav links auto-hide for unprivileged roles.
> - **9H — Cleanup**: dropped the unused `users.roles text[]` column from the abandoned multi-role experiment.
> - **9H — Task categories**: now backed by `lookup_options` with `kind='task_category'`. Seeded six defaults (Compliance, Cleanliness, Stock, Customer Service, Safety, Other). Template form's "Category" is a dropdown; admins manage the list under Admin → Reason / Size lookups.
>
> **Phase 9F**:
> - **Form-builder** for Store Task templates. New `store_task_templates.blocks` (jsonb) holds an ordered list of input blocks: text · long text · number · amount (€) · date · time · yes/no · single choice · multi choice · photo. Each block can be marked required and the server enforces it on completion.
> - **Advanced targeting**: `assigned_to_roles[]` (multi-role) and `assigned_to_user_ids[]` (specific employees) added alongside the existing `assigned_to_role`. New `start_at` / `end_at` window for when the template is active.
> - **Completion**: `store_task_instances.answers` (jsonb) keyed by block id. Legacy `requires_photo` / `requires_notes` still work when a template has no blocks (backward compat).
> - **HQ Tasks (Task Types A–I, `task_records`) are NOT affected** — this round only touches the Store Tasks system from Phase 9D/9E.
>
> **Phase 9B3**:
> - **Role renames**: `director` → `admin` · `commercial_manager` → `buying_head`. Full key + label change across DB (`users.role`, `store_task_templates.assigned_to_role`), backend constants, frontend role catalogue, and admin UIs. The seeded back-office login still uses **username `director`** — only the *role* is now `admin`.
>
> **Phase 9B2**:
> - HR-style fields added to `users`: `email`, `phone`, `department`, `employee_code` (unique when set), `start_date`, `notes`.
> - **One role per employee.** The role catalogue + per-role permissions live in `client/src/lib/roles.js` (and mirror the server-side guards in `[[route]].js`).
> - New **Employees** admin page at `/admin/employees`: HQ-only users with a single-role dropdown and an inline "What does this role do?" reference card. The lower-level `/admin/users` page still manages every account.
> - The unused `roles text[]` column added during an earlier multi-role experiment stays in the schema for now (no code reads or writes it).
>
> **What changed in Phase 9** (all live):
> - **9A — Areas admin UI** at `/admin/areas`. Store admin now uses a real Area dropdown (was free-text Region).
> - **9B — Users + role-aware auth.** New `users` table; the existing store-PIN flow still works because every store has a backfilled `sales_assistant` user. Back-office PIN → `director` user. New **Staff / HQ** login tab (username + PIN) for any non-store role. Token now carries `role`, `user_id`, `area_ids`. Token shape changed — existing logged-in sessions need to log in once.
> - **9C — `products.supplier_id`** + `/products/lookup` joins suppliers + admin dropdown + CSV `supplier_name` column. Scan result subtly shows the supplier.
> - **9D — Task templates** (`store_task_templates`). Admin page at `/admin/task-templates`, visible to task creators (`buying_manager`, `area_manager`, `commercial_manager`, `director`). Targeting: all / area / specific stores. Per-role or "everyone" assignment.
> - **9E — Store tasks page** at `/store-tasks` for everyone; store users see today's checklist with photo + notes completion, managers see compliance % per store. Lazy instance generation via `ensureInstancesExist(db, env, storeId, date)`.
> - Nav split: "HQ Tasks" (the existing error reporting) vs "Store Tasks" (the new operational checklist).
> - No seed templates were shipped — admins create from scratch via the new admin page.

---

## 1. What it is

A retail **task / error reporting** web app for **Homesavers Ireland** (currently
8 stores, scaling to 55). Store staff scan products with their phone (camera,
HID scanner gun, or manual entry) and log issues against one of nine **task
types** (e.g. UOM Errors, Non-Scans, Wrong Prices, DRS Errors). Back-office
reviews each record and marks it complete or "no change needed" with a note
back to the store. Also produces CSV reports and a live dashboard.

Mobile-first PWA; installable on Android and iOS home screens; works offline
via a service worker + IndexedDB outbox.

---

## 2. Where it lives

| Thing | URL |
|---|---|
| Live app | https://homesaversscanner.pages.dev/ |
| GitHub repo | https://github.com/shayasphilipdev/HomesaversScanner |
| Local source | `C:\Scraping\homesavers-scanner` |
| Supabase project | `eggspkdengnxktwkdwpw` · https://eggspkdengnxktwkdwpw.supabase.co |
| Cloudflare account | `565191064c74a1e202aa0211133c895d` |

Public repo. Code-wise that's fine: no secrets in the repo (verified by
`.gitignore` covering `.env`, `.dev.vars`, `node_modules`).

---

## 3. Tech stack

- **Frontend:** React 18 + Vite, plain JS (no TypeScript)
- **Routing:** react-router-dom v6
- **Backend:** single Cloudflare Pages Function (`functions/api/[[route]].js`),
  Web Crypto for HMAC tokens, fetch-only — no Node-only deps
- **Database:** Supabase PostgreSQL (no RLS, no Supabase Auth)
- **Storage:** Supabase Storage bucket `task-photos` (public-read), used for
  Task B's product + barcode photos
- **PWA:** `client/public/sw.js` service worker + `manifest.webmanifest`
- **Offline outbox:** IndexedDB (no library — vanilla wrapper in
  `client/src/lib/outbox.js`)
- **Fonts:** Fraunces (serif) + Inter (body) via Google Fonts
- **Camera scanner:** `html5-qrcode` (lazy-loaded only when user enables it)

Zero-cost stack. All free-tier limits comfortable.

---

## 4. Architecture

```
Browser (React SPA, PWA)
  │  all requests → /api/*
  │  Authorization: Bearer <HMAC-signed session token>
  ▼
Cloudflare Pages
  │  serves client/dist as static
  │  routes /api/* through functions/api/[[route]].js
  │  reads SUPABASE_URL (wrangler.toml [vars]),
  │  SUPABASE_ANON_KEY (Cloudflare Secret),
  │  SESSION_SECRET (Cloudflare Secret) for HMAC signing
  ▼
Supabase
  ├─ Postgres REST API (RLS disabled by design)
  └─ Storage REST API (task-photos bucket; anon insert/select/delete policies)
```

**Auth model:** PIN-based, signed-token JWT-style.

- Stores have a 4+ character PIN, bcrypted in Postgres.
- Back office has a single master PIN, also bcrypted.
- `POST /api/stores/verify-pin` and `POST /api/backoffice/verify-pin` return
  an HMAC-SHA256-signed token containing `{mode, storeId, exp}`. Store sessions
  live 24h; back-office 12h.
- All data endpoints derive `mode` / `storeId` from the token, never from query
  strings — the old `?mode=` URL hack is closed.
- Store sessions persist in `localStorage`; back-office sessions in
  `sessionStorage` (clears on tab close).

---

## 5. Repository layout

```
homesavers-scanner/
├── client/
│   ├── public/
│   │   ├── favicon.svg
│   │   ├── icon-192.png            PWA install icon
│   │   ├── icon-512.png            PWA install icon (+ maskable variant)
│   │   ├── manifest.webmanifest    PWA manifest
│   │   └── sw.js                   service worker (cache app shell)
│   ├── src/
│   │   ├── App.css                 single CSS file, themed via [data-theme]
│   │   ├── App.jsx                 routes + Shell + session wiring
│   │   ├── main.jsx                React mount + SW registration
│   │   ├── components/
│   │   │   ├── Nav.jsx                top bar (brand, links, offline pill, theme toggle, sign-out)
│   │   │   ├── Sidebar.jsx            left rail on screens ≥1024px
│   │   │   ├── BottomNav.jsx          bottom tab bar on phones <720px
│   │   │   ├── AdminNav.jsx           tab strip across admin pages
│   │   │   ├── StoreSelector.jsx      login screen (store + back-office tabs)
│   │   │   ├── TaskTypePicker.jsx     chip picker grouped by frequency
│   │   │   ├── TaskForm.jsx           slim dispatcher to forms/Task*Form.jsx
│   │   │   ├── TaskRecordList.jsx     records table (status badges, HQ notes)
│   │   │   ├── OfflineIndicator.jsx   nav pill: offline / queued / failed
│   │   │   ├── Skeleton.jsx           shimmer placeholder
│   │   │   ├── Toast.jsx              ToastProvider + useToast()
│   │   │   └── forms/
│   │   │       ├── ScannerInput.jsx   barcode/code input — scanner gun + camera + lookup
│   │   │       ├── SupplierPicker.jsx supplier dropdown + free-text fallback
│   │   │       ├── PhotoCapture.jsx   take-or-upload + compress + preview
│   │   │       ├── TaskAForm.jsx      A — UOM Errors
│   │   │       ├── TaskBForm.jsx      B — Non-Scans (2 mandatory photos)
│   │   │       ├── TaskCForm.jsx      C — Wrong Prices
│   │   │       ├── TaskDIForm.jsx     D + I — Wrong Description / Miscellaneous
│   │   │       ├── TaskEForm.jsx      E — Price Marked Products
│   │   │       ├── TaskFForm.jsx      F — DRS Errors (warning banner)
│   │   │       ├── TaskGForm.jsx      G — Promotion Error
│   │   │       └── TaskHForm.jsx      H — Stock Count
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx          KPIs + 14-day chart + by-task-type / by-store + recent
│   │   │   ├── Tasks.jsx              task picker + form + records list (store + BO view)
│   │   │   ├── Reports.jsx            filters + on-screen table + bulk review + CSV download
│   │   │   ├── Sync.jsx               outbox inspector: list / retry / remove queued items
│   │   │   ├── AdminStores.jsx        stores CRUD + PIN reset
│   │   │   ├── AdminSuppliers.jsx     suppliers CRUD + CSV upload
│   │   │   ├── AdminLookups.jsx       reason_code + drs_size CRUD (lookup_options master)
│   │   │   ├── AdminProducts.jsx      products master: search + CSV upsert
│   │   │   └── AdminSettings.jsx      app_settings + "Run photo cleanup now"
│   │   └── lib/
│   │       ├── api.js                 fetch wrapper, token storage, all endpoint helpers
│   │       ├── theme.js               light / dark theme apply + persist
│   │       ├── outbox.js              IDB outbox (queue, drain, retries)
│   │       ├── photos.js              compressImage + UUID helper
│   │       ├── csv.js                 minimal CSV parser (quotes, BOM, newlines)
│   │       ├── taskTypes.js           per-type form schema metadata
│   │       └── uom.js                 UOM dropdown + Eachs warning
│   ├── index.html                  Vite entry: Google Fonts, manifest, apple meta
│   ├── package.json
│   └── vite.config.js
├── functions/
│   └── api/
│       └── [[route]].js            Pages Function: all backend logic
├── docs/
│   └── phase8-roles-and-scoped-tasks.md
├── supabase-schema.sql             initial schema (Phase 0; later phases via migrations)
├── .dev.vars.example               template — SUPABASE_URL/_ANON_KEY/SESSION_SECRET
├── wrangler.toml                   Pages config + [vars] SUPABASE_URL
├── package.json
├── README.md
├── CLAUDE.md                       lighter-weight orientation file
└── Project_Status.MD               THIS FILE
```

---

## 6. Database schema (current state)

All tables in `public` schema, RLS disabled (architecture: API holds Supabase
key, client never talks to Supabase directly).

### `stores`
`id (uuid pk) · store_code (text unique) · store_name (text) · region (text) ·
area_id (uuid, fk → areas, nullable, Phase 8A — not yet applied) · pin_hash
(text, bcrypt) · is_active (bool) · created_at (timestamptz)`

### `products` — Product Master
`id (uuid pk) · product_id (text unique) · description (text) · uom (text) ·
category (text) · is_active (bool) · updated_at (timestamptz)`

### `suppliers`
`id (uuid pk) · supplier_code (text) · supplier_name (text) · is_active (bool) ·
created_at · updated_at`

### `task_types` — reference table (9 rows, A–I)
`code (text pk) · name (text) · frequency (text: daily|weekly|monthly|once_off) ·
sort_order (int) · is_active (bool) · created_at`

Current rows: A UOM Errors (daily), B Non-Scans (daily), C Wrong Prices (daily),
D Wrong Description (daily), E Price Marked Products (daily), F DRS Errors
(daily), G Promotion Error (daily), H Stock Count (once_off), I Miscellaneous
(once_off).

### `lookup_options` — generic dropdown master
`id (uuid pk) · kind (text: 'reason_code'|'drs_size'|…) · label (text) ·
task_types (text[] — which task types use this option) · sort_order (int) ·
is_active (bool) · created_at`

Seeded: 5 reason codes (Task C), 2 DRS sizes (Task F).

### `task_records` — the main fact table
Common columns:
`id (uuid pk) · store_id (uuid fk) · task_type (text fk → task_types) · status
(text: pending|completed|no_change_needed|store_completed) ·
marked_for_deletion (bool) · completed_at · store_completed_at · reviewed_at ·
review_notes (text — HQ note back to store) · created_at · updated_at`

Promoted columns (used by ≥2 task types):
`product_code · product_barcode · product_name_label · description · uom ·
quantity (numeric) · supplier_id (fk → suppliers) · supplier_name_text (free
text fallback) · notes (text) · photo_product_url · photo_barcode_url`

Type-specific fields live in `details (jsonb)` — e.g. reason_code, current_price,
price_marked_price, drs_size, units_per_package, promotion_description,
promotion_price, shop_floor_count.

### `app_settings` — key/value
`key (text pk) · value (text) · updated_at`

Keys: `backoffice_pin_hash` (bcrypt of master PIN) · `list_auto_close_hours` ·
`scan_record_retention_days` · `photo_retention_days` (default 7).

### Indexes
`idx_tr_store_id · idx_tr_task_type · idx_tr_status · idx_tr_created_at ·
idx_tr_store_date · idx_tr_supplier · idx_suppliers_active · idx_lookup_kind`

### SQL functions
- `verify_pin(hash, pin) → table(result boolean)` — `crypt(pin, hash) = hash`
- `hash_pin(pin) → table(hash text)` — `crypt(pin, gen_salt('bf'))`
- `list_old_photos(days int) → table(name text, created_at timestamptz)` —
  used by `/admin/cleanup/photos`

### Storage
- Bucket `task-photos`, public-read. Policies: anon can SELECT, INSERT, DELETE.
- Object paths: `<tempId-or-record-uuid>/product.jpg`, `<id>/barcode.jpg`.

---

## 7. API surface

All `/api/*` paths handled by `functions/api/[[route]].js`. All authenticated
endpoints expect `Authorization: Bearer <token>`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET    | `/stores` | public | login screen uses this |
| POST   | `/stores/verify-pin` | public | `{storeId, pin}` → `{ok, token, store}` |
| POST   | `/backoffice/verify-pin` | public | `{pin}` → `{ok, token}` |
| GET    | `/task-types` | auth | reference data |
| GET    | `/lookup-options?kind=&task_type=` | auth | dropdown options |
| GET    | `/suppliers` | auth | active suppliers for the picker |
| GET    | `/products/lookup?code=` | auth | Product Master lookup |
| GET    | `/task-records?storeId=&task_type=&status=&from=&to=` | auth | list with filters |
| POST   | `/task-records` | auth | create (store users locked to own store) |
| PATCH  | `/task-records/:id` | auth | edit; BO auto-stamps `reviewed_at` for completed/no_change_needed |
| DELETE | `/task-records/:id` | auth | store users limited to own `store_completed` |
| POST   | `/task-records/bulk-review` | back-office | `{ids[], status, review_notes}` |
| GET    | `/reports/task-records?from=&to=&storeId=&task_type=` | auth | CSV |
| GET    | `/dashboard/stats?from=&to=&storeId=` | auth | aggregated totals + by_task_type + by_store + by_day(14) + recent |
| POST   | `/photos/upload` | auth | multipart: `file`, `slot=product\|barcode`, `tempId` → `{url, path}` |
| DELETE | `/photos?path=` | auth | cleanup after save failure |
| GET    | `/admin/stores` | back-office | list all (active + inactive) |
| POST   | `/admin/stores` | back-office | `{store_code, store_name, region?, pin}` |
| PATCH  | `/admin/stores/:id` | back-office | edit store fields |
| POST   | `/admin/stores/:id/reset-pin` | back-office | `{pin}` |
| GET    | `/admin/suppliers` | back-office | list all |
| POST   | `/admin/suppliers` | back-office | create one |
| POST   | `/admin/suppliers/bulk` | back-office | array; bulk insert |
| PATCH  | `/admin/suppliers/:id` | back-office | edit |
| GET    | `/admin/lookup-options?kind=` | back-office | list |
| POST   | `/admin/lookup-options` | back-office | `{kind, label, task_types[], sort_order?}` |
| PATCH  | `/admin/lookup-options/:id` | back-office | edit |
| DELETE | `/admin/lookup-options/:id` | back-office | hard delete |
| GET    | `/admin/products?q=&limit=` | back-office | search |
| GET    | `/admin/products/count` | back-office | total row count |
| POST   | `/admin/products/bulk` | back-office | upsert on `product_id` (PostgREST `Prefer: resolution=merge-duplicates`) |
| GET    | `/admin/settings` | back-office | list app_settings (PIN hash excluded) |
| PATCH  | `/admin/settings` | back-office | `{key: value, …}` upsert |
| POST   | `/admin/cleanup/photos` | back-office | runs `list_old_photos` + storage DELETEs |

Server-side guarantees:
- Token `mode` is the only source of truth for authorization. Query string
  `mode` is never read.
- Store users' `store_id` is always the token's `storeId`, never the body's.
- Bulk endpoints validate UUID shape before constructing the PostgREST filter
  (no SQL-ish injection through `id=in.(…)`).

---

## 8. Authentication

### Login UX
Two-tab login screen (`StoreSelector.jsx`):
1. **Store**: dropdown of active stores → 4-digit PIN
2. **Back Office**: single master PIN

### Token flow
1. Client posts `{storeId, pin}` (or `{pin}` for BO) to verify-pin.
2. Server bcrypts via SQL `verify_pin(stored_hash, pin)`, returns
   `{token: '<b64url-json>.<b64url-sig>'}`.
3. Client stores the token: `sessionStorage` for BO, `localStorage` for store.
4. Every request: `Authorization: Bearer <token>`.
5. Server's `authenticate()` verifies HMAC + expiry, returns `{mode, storeId, exp}`.
6. On 401, client clears token + session and reloads to the login screen.

### Secrets in Cloudflare
- `SUPABASE_URL` — non-secret, in `wrangler.toml [vars]`
- `SUPABASE_ANON_KEY` — Cloudflare Secret
- `SESSION_SECRET` — Cloudflare Secret (random 64+ chars)

---

## 9. Frontend pages

| Route | Page | Visible to |
|---|---|---|
| `/dashboard` | KPI cards + charts + recent activity | all |
| `/tasks` | Task type picker + record form + records list | all (form hidden for BO) |
| `/reports` | Filter form + on-screen results + bulk review + CSV | all (review buttons BO only) |
| `/sync` | Outbox inspector — list / retry / remove queued items | all |
| `/admin/stores` | Stores CRUD + PIN reset | back-office only |
| `/admin/suppliers` | Suppliers CRUD + CSV upload | back-office only |
| `/admin/lookups` | Reason codes + DRS sizes CRUD | back-office only |
| `/admin/products` | Products master CSV upsert | back-office only |
| `/admin/settings` | App settings + photo cleanup | back-office only |
| `/` | redirect → `/dashboard` | |
| `*` | redirect → `/dashboard` | |

---

## 10. UI / theme system

### Two themes via `[data-theme="…"]`
- **Light** (default): warm ivory background, Claude coral accent
  (`#C96442`), glass morphism on cards (backdrop-blur over a soft radial body
  gradient).
- **Dark** (high-contrast): deep navy background `#0F1419`, brighter coral
  `#FF8E5C`, status colors brighter for outdoor/shop-floor readability. No
  glass (clarity over ambience).

### Theme handling
- `lib/theme.js` applies the stored theme to `<html>` before first paint
  (no FOUC). Falls back to `prefers-color-scheme` on first visit.
- Toggle button in the top nav (`☾` / `☀`). Persists in localStorage.
- Updates the `<meta theme-color>` so iOS / Android status bar tints flip
  with the theme.

### Responsive layout — three nav tiers
- **< 720px** (phone): bottom tab bar (`BottomNav`), simplified top stripe.
  Safe-area inset honored so the bar sits above the iOS home indicator.
- **720–1023px** (tablet): inline links in the top bar.
- **≥ 1024px** (desktop): left sidebar (`Sidebar`), top bar simplifies.

Reports and Dashboard stretch to **1600px** max-width on PC; other pages
stay at 1180px.

### Typography
- Headings: **Fraunces** (free, ≈ Tiempos)
- Body: **Inter**
- Code/IDs: system mono

### Touch & input
- All `.btn` ≥ 40px tall desktop, ≥ 44px phones.
- Inputs ≥ 42px desktop, ≥ 46px phones with 16px font-size to prevent iOS
  Safari zoom on focus.

### Feedback
- `ToastProvider` + `useToast()` for non-blocking success / error / info
  notifications. Positioned bottom-right on PC, bottom-center above the
  bottom nav on phones.
- Skeleton shimmer on Dashboard KPIs while stats load.

---

## 11. Offline behaviour (PWA)

### Service worker (`client/public/sw.js`)
- `/api/*` → **never intercepted** (let the app handle outbox + auth).
- Navigation requests → **stale-while-revalidate** against cached SPA shell.
- `/assets/*` (Vite hashed) → **cache-first** (immutable).
- Cross-origin → passthrough.
- Versioned cache name (`homesavers-v1`) — bump in `sw.js` to evict.

### Manifest
- Installable. PNG icons 192 + 512 + maskable. Apple PWA meta tags.
- `start_url: /dashboard`, `display: standalone`, theme color coral.

### IndexedDB outbox (`client/src/lib/outbox.js`)
- Single object store `requests`, keyed on a client-generated UUID.
- Two record kinds:
  - `simple` — plain task record body
  - `with_photos` — body + two Blob photos (Task B)
- The UUID doubles as the photo storage namespace, so retries don't
  double-write photos.

### Sync triggers (event-driven, no polling)
- `online` event (Wi-Fi/airplane mode flip)
- `visibilitychange → visible` (app returns from background)
- First mount when online (boot drain)
- **Manual** — tap the offline pill → navigates to `/sync` page

### Reliability guards
- **Bounded retries**: server-side failures bump `attempts`; at 5 the record is
  marked `status='failed'` and skipped by auto-sync.
- **Pure network failures never count** against attempts — drain just breaks
  early.
- **Visible safety valve**: the pill turns red on failures; `/sync` lists
  every queued item with per-row Retry / Remove. Nothing rots silently.

### Form integration
- `createTaskRecord()` catches network errors and enqueues, returning
  `{queued: true, id}`. Every task form forwards the queued flag so the toast
  differs: "Record saved." vs "Saved offline — will sync when you're back
  online."
- TaskBForm queues the **whole** photos-then-record op atomically; partial
  photo uploads that did make it to storage are cleaned up.

---

## 12. Phase status

| Phase | Title | Status |
|---|---|---|
| 0 | Foundation (auth, deploy, baseline scanner) | ✅ |
| 1 | Task Types + Suppliers re-foundation | ✅ |
| 2A | Task B + photo infrastructure | ✅ |
| 2B | Tasks D + I | ✅ |
| 2C | Tasks C + E + G | ✅ |
| 2D | Task F (DRS) | ✅ |
| 2E | Task H (Stock Count) | ✅ |
| 3A | Stores admin | ✅ |
| 3B | Suppliers admin + CSV upload | ✅ |
| 3C | Reason Codes + DRS Sizes admin | ✅ |
| 3D | Products master CSV upload | ✅ |
| 3E | Settings + photo retention cleanup | ✅ |
| 4A | On-screen Reports + review flow | ✅ |
| 4B | Modern dashboard + design refresh | ✅ |
| 5 | Responsive layout (3-tier nav + sidebar) | ✅ |
| 6 | Frequency grouping on Tasks | ✅ |
| 7 | Offline queue + PWA + Sync inspector | ✅ |
| 8 | Roles, areas, assigned tasks | 📐 design only |

---

## 13. Decisions on record

Captured from earlier conversations so future sessions don't relitigate them.

### Architecture
- **No Supabase Auth, no RLS** — PIN flow + API-side authorization is enough
  for non-confidential retail stock data. Stronger isolation can come later
  without schema changes.
- **Cloudflare Pages Functions over Workers** — same runtime, billed under
  Pages free tier (100k req/day, plenty).
- **No CSS framework** — single hand-written `App.css` with CSS custom
  properties + `[data-theme]` selectors.
- **No chart library** — Dashboard uses inline SVG. Saves bundle + dependency.

### Data model
- **Task types as a reference table** (not enum) so admins can manage them.
- **Generic `lookup_options` master** instead of one table per dropdown — kind
  + label + task_types[] so a single option can be reused across task types.
- **`details` JSONB** for type-specific fields used by only one task — keeps
  the main table narrow without losing reportability.
- **Suppliers**: dropdown of master + free-text fallback. Records store either
  `supplier_id` or `supplier_name_text`. Reports COALESCE.

### Workflow
- **Status values**: `pending → completed | no_change_needed → store_completed`.
  Plain text in DB (no enum), driven by application code.
- **Bulk review**: BO can checkbox-select pending records and mark them in
  one call (`/task-records/bulk-review`).
- **Optimistic UI**: review / delete flips locally first, reverts on failure.

### Offline
- **Event-driven sync only**: online / visibilitychange / first-mount / manual
  tap. No `setInterval`. Cost: nothing held forever — visible safety valve.
- **Bounded retries (5)** for server errors; network errors don't count.

### Design
- **Light + dark themes** in the same CSS; light has glass morphism, dark is
  high-contrast for bright store lighting.
- **Fonts**: Fraunces (free) + Inter (free). Anthropic's Tiempos / Styrene
  are proprietary; Fraunces is the closest free editorial serif.
- **Three-tier nav**: bottom (phone) / top inline (tablet) / sidebar
  (desktop). Same destinations, different layout per width.

### Camera / Scanner
- **Scanner gun is the default**, camera is opt-in. Lazy-load `html5-qrcode`
  only when the user enables it (saves bundle).
- **Manual entry always works** — typing into the product code field is a
  first-class path, not a fallback.
- **Camera scanner uses N-times confirmation** (default 3) to filter partial
  reads, same gate the original v1 app used.

### Photos (Task B)
- **2 mandatory photos** (product + barcode), camera OR gallery.
- **Compressed client-side** to max 1600px wide JPEG q=0.8 — typically
  150–300 KB each.
- **7-day retention** by default (`photo_retention_days` in app_settings).
  Cleanup is on-demand (admin Settings → Run photo cleanup now); no scheduler.

---

## 14. Test credentials & access

| Login | PIN |
|---|---|
| Back office | originally `hjd456*` — **user has since rotated** |
| Store `1015` (Tallaght) | originally `9876` — **user has since rotated** |

The user has been adding stores and rotating PINs via the new Admin UI. Don't
assume any specific PIN is current.

There are now 8 stores in the DB: codes 1001, 1007, 1011, 1015, 1017, 1019,
1020, 1021.

---

## 15. Local dev

```powershell
# Terminal 1
cd C:\Scraping\homesavers-scanner\client
npm install
npm run dev          # Vite on http://localhost:5173

# Terminal 2 — Pages Functions emulator (proxies /api/* through them)
cd C:\Scraping\homesavers-scanner
Copy-Item .dev.vars.example .dev.vars     # fill in real values
npx wrangler pages dev --proxy 5173        # Pages on http://localhost:8788
```

`.dev.vars` needs:
```
SUPABASE_URL=https://eggspkdengnxktwkdwpw.supabase.co
SUPABASE_ANON_KEY=<from Cloudflare Secrets>
SESSION_SECRET=<random 64-char string>
```

Service worker registration is gated by `import.meta.env.PROD` so HMR doesn't
fight a cached shell in dev.

---

## 16. Deployment

Auto-deploys on every push to `main` via Cloudflare Pages.

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `cd client && npm install && npm run build` |
| Build output directory | `client/dist` |
| Root directory | *(blank)* |

Env vars in the Cloudflare dashboard:
- `SUPABASE_URL` — managed in `wrangler.toml [vars]`, not the dashboard
- `SUPABASE_ANON_KEY` — Secret
- `SESSION_SECRET` — Secret

A push typically rebuilds in 1–2 min. Service worker version (`v1` in
`sw.js`) needs bumping if cache shape changes; otherwise the SPA shell
refreshes via stale-while-revalidate within one navigation.

---

## 17. Common operations

### Add a store
Back office → **Admin → Stores → + Add store**. Provide store_code, name,
region, initial PIN (≥4 chars). Or via SQL:
```sql
INSERT INTO stores (store_code, store_name, region)
VALUES ('1022', 'Limerick', 'Munster');
UPDATE stores
SET pin_hash = (SELECT hash FROM hash_pin('1234'))
WHERE store_code = '1022';
```

### Reset a store PIN
Admin → Stores → row → **Reset PIN** → enter new PIN.

### Bulk-import suppliers
Admin → Suppliers → **↥ Bulk CSV upload**. CSV needs `supplier_name`
column; `supplier_code` optional. Tolerant aliases: `name`, `code`, `id`.

### Bulk-import products master
Admin → Products → **↥ Bulk CSV upload**. CSV needs `product_id`. Optional:
`description`, `uom`, `category`. Upsert on `product_id`. Tolerant aliases:
`id`, `barcode`, `name`.

### Run photo cleanup
Admin → Settings → **🧹 Run photo cleanup now**. Deletes photos older than
`photo_retention_days` (default 7) from Storage.

### Approve records in bulk
Reports → set filters → Run report → tick pending rows → **Mark complete** or
**No change needed** (with optional note). Bulk endpoint hits all in one call.

### Inspect / unstick the offline queue
On any device with queued data, the amber/red pill appears in the nav. Tap →
`/sync` page. Per-row Retry / Remove, or **Sync now** for the whole queue.

---

## 18. Known limitations & risks

### Security
- **Anon key is semi-public** (Supabase design). RLS is disabled, so anyone
  who gets the anon key can hit Supabase REST directly and read/write
  everything. Mitigated by keeping the key in CF Secrets and only proxying.
  Acceptable for non-confidential retail stock data — flagged in
  conversations.
- **PIN brute force is unrate-limited.** For 4-digit PINs that's 10,000
  attempts. Cloudflare has some basic DDoS protection but no per-IP rate
  limit on the verify-pin endpoint specifically.

### Sync
- **Supabase Storage CDN caches deleted photo URLs** for a few minutes —
  `DELETE` removes the DB object but the URL may serve image briefly. The
  7-day retention cleanup is the source of truth.
- **`navigator.onLine` is sometimes wrong** on flaky cellular — visibility
  change + manual sync cover for it.

### Scale
- `/dashboard/stats` fetches up to 5,000 records and aggregates in JS. Fine
  for current volume; a SQL aggregation function will be needed past ~50k
  records.
- `/task-records` GET has no pagination — list could get large per store
  after months of use. Add limit + cursor when needed.

---

## 19. Phase 8 — planned, not started

Full design in [docs/phase8-roles-and-scoped-tasks.md](docs/phase8-roles-and-scoped-tasks.md).

What it adds:
- **Areas** as a first-class table (replaces text `region`)
- **Roles**: `store_user` · `store_manager` · `area_manager` · `back_office`
- **Assigned tasks**: HQ or area manager pushes a task to all stores / an
  area / one store. The current self-initiated reporting flow is unchanged.
- **Inbox** for store users to see assigned tasks waiting for them.

Sub-phases planned:
- **8A** — Areas table + admin tab + backfill
- **8B** — Users table + role-aware auth + migration from store PIN
- **8C** — Assignments table + creation UI + Inbox
- **8D** — Reports + Dashboard honoring roles + assignments

The first migration attempt was deferred at the user's request. Before
restarting, react to the design doc — especially the open questions on
per-person vs shared PINs and eager vs lazy assignment materialization.

---

## 20. Open work / nice-to-haves (post-Phase 8)

- **Sidebar collapse** on smaller desktop widths (toggle to icon-only rail)
- **Skeleton loaders** beyond the Dashboard (Tasks list, Reports table)
- **More optimistic UI** flows (status toggles, supplier edits)
- **Real PNG icons** designed instead of the auto-generated coral "H"
- **Push notifications** for newly assigned tasks (Android-only; iOS needs
  iOS 16.4+ PWA push)
- **Background sync** via the Background Sync API — Android-only,
  currently skipped since iOS doesn't support it
- **Per-IP rate limit** on verify-pin (Cloudflare WAF rule)
- **SQL-side dashboard aggregation** function when record volume crosses
  ~50k

---

*Last updated: live snapshot of commit `59d5ebe`.*
