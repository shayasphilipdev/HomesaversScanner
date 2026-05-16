# CLAUDE.md — Claude Code Instructions
## Phase 9: Store Tasks, Roles, Supplier Link
### Homesavers Scanner App

---

## How to use this file

You are Claude Code working on the Homesavers Scanner App. **Read the codebase before writing anything.** This instruction file describes intent and decisions; the actual implementation must fit the existing patterns in the repo. Where this file and the code conflict, adapt to what the code actually does and note the deviation.

Start by reading:
1. `Project_Status.MD` — full system snapshot
2. `docs/phase9-store-tasks-and-roles.md` — Phase 9 design (the source of truth for schema and UX)
3. `functions/api/[[route]].js` — all backend logic
4. `client/src/App.jsx` — routing and session context
5. `client/src/App.css` — all styling (do not introduce a CSS framework)
6. `client/src/lib/api.js` — all API call helpers
7. The reference file `ShiftTasks.jsx` (provided separately) — shows a proven task-create modal pattern from a related app. Adapt its logic; do not copy it verbatim.

---

## Change 1 — Role renames

Two roles are being renamed. Update **every** place the old name/key appears: database values, API token payloads, frontend role-check arrays, display labels, admin UI, and any seeded SQL.

| Old key | New key | Old display | New display |
|---|---|---|---|
| `operations_manager` | `buying_manager` | Operations Manager | Buying Manager |
| `store_colleague` | `sales_assistant` | Store Colleague | Sales Assistant |

**Search for both the old key strings and the old display strings.** They may appear in:
- `functions/api/[[route]].js` — role checks in the `authenticate()` helper and individual endpoint guards
- `client/src/App.jsx` or session/context code — role-based route guards
- Any admin UI pages (AdminUsers, StoreSelector, etc.)
- SQL seeds or migration files
- `CLAUDE.md` and `Project_Status.MD` — update these docs too

Do not change any other role keys. The full role list after this change:
`sales_assistant` · `store_manager` · `area_manager` · `support_admin` · `buying_manager` · `commercial_manager` · `director`

---

## Change 2 — Task creation permissions

### Who can create store tasks

Tasks in the `store_task_templates` / `store_task_instances` system (Phase 9) can be created by:

- `buying_manager`
- `area_manager`
- `commercial_manager`
- `director`

Store Managers, Support Admins, and Sales Assistants **cannot** create tasks.

In the API (`functions/api/[[route]].js`), guard the task template POST/PATCH/DELETE endpoints with a helper like:

```js
const CAN_CREATE_TASKS = ['buying_manager', 'area_manager', 'commercial_manager', 'director']
```

Check the existing pattern for how back-office-only endpoints are guarded (look at `/admin/stores`, `/admin/suppliers`, etc.) and follow the same approach.

### Task targeting — what a creator can assign

When creating a task, the creator specifies two things:

**1. Store scope** (`applies_to` field):
- `all` — all active stores
- `area` — all stores in a specific area (area_ids array)
- `stores` — specific named stores (store_ids array)
- `one` — exactly one store (convenience alias; store_ids has one entry)

**2. Assigned-to role** (`assigned_to_role` field):
- Any single role key from the full role list, OR `all` to mean all users in scoped stores

This means a Buying Manager could create a task that targets "All Stores → Store Manager only", or "Dublin Area → Sales Assistant only", or "Store 1015 → all staff".

For **back-office roles** (support_admin, buying_manager, commercial_manager, area_manager) as the assignee — the store scope is ignored (back-office users are not attached to stores). The task appears in the task list for all users of that role. Research how users are stored (`users` table if it exists, or the current auth model) before implementing; the exact mechanism depends on what the code actually has.

### Task form modal — reference the ShiftTasks.jsx pattern

The provided `ShiftTasks.jsx` file contains a working `TaskCreateModal`. Key patterns to reuse:

- `recurrence` field: `once` | `daily` | `weekly` | `monthly` | `yearly` (add `yearly` to match phase9 design; the reference file has `fortnightly` which is not needed here)
- `task_date` (for once-off) vs `start_date` + `end_date` (for recurring)
- Store selector dropdown with "All Stores" option
- Assigned-to-role selector — **adapt the role options to Homesavers roles** (not the ShiftTasks roles)
- Priority selector: High / Medium / Low
- Category selector (use the categories from `store_task_templates.category` or `lookup_options`)

Do not copy the `blocks_json` / `answers_json` logic from ShiftTasks — the Homesavers task system uses simpler photo + notes completion, not a form-builder.

### New frontend page: Store Task Templates (admin)

Route: `/admin/task-templates`

Visible to: `buying_manager`, `commercial_manager`, `director`, `area_manager`

Features:
- List all templates (active and inactive)
- "+ Create Task" button → opens TaskCreateModal
- Edit and soft-delete (set `is_active = false`) per template
- Filter by category and frequency

Follow the existing admin page pattern (look at `AdminStores.jsx`, `AdminSuppliers.jsx` for structure and CSS class usage).

### Store task list page

Route: `/store-tasks`

Visible to: all roles

For `sales_assistant` and `store_manager`: shows today's pending task instances for their store, grouped by category, overdue instances highlighted.

For `area_manager`, `buying_manager`, `commercial_manager`, `director`: shows a compliance summary view — completion % per store, drill-down to see instances.

For `support_admin`: shows tasks assigned to the `support_admin` role.

Research the existing `Tasks.jsx` and `Dashboard.jsx` to understand the component patterns before building this page.

---

## Change 3 — Supplier link on Product Master

### Database

Add a nullable foreign key to the `products` table:

```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
```

Add this to `supabase-schema.sql` as a migration comment block so the file stays the source of truth.

### Admin UI — Products page

In `AdminProducts.jsx` (or whatever the products admin page is called), add a `Supplier` column and selector:

- When editing or adding a product, show a supplier dropdown (loaded from active suppliers)
- Display the linked supplier name in the product table
- The CSV bulk-upsert for products should also accept an optional `supplier_id` or `supplier_name` column. If `supplier_name` is provided and matches an active supplier (case-insensitive), resolve to `supplier_id` automatically during import.

### Product lookup — show supplier name on scan

When a Sales Assistant scans a product code, the app calls `/products/lookup?code=`. Currently this returns product fields. Update the backend query to JOIN `suppliers` and return `supplier_name` alongside the product.

In the frontend scan result display (find the component that shows the looked-up product — likely in `ScannerInput.jsx` or a form that uses it), show the supplier name as a secondary line beneath the product description. Keep it subtle — it is informational, not a required field.

Example display after scan:
```
PROD-001234
Kitchen Storage Set 3pc
Supplier: Johnson Housewares Ltd
UOM: PCS
```

If no supplier is linked, simply omit the supplier line — do not show "Supplier: —".

---

## Change 4 — API additions (Phase 9 store tasks)

Research `functions/api/[[route]].js` thoroughly before adding routes. Follow the existing routing pattern exactly (the file uses regex matching, not a router library).

New routes to add:

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/admin/task-templates` | can_create_tasks | List all templates |
| POST | `/admin/task-templates` | can_create_tasks | Create template |
| PATCH | `/admin/task-templates/:id` | can_create_tasks | Edit template |
| DELETE | `/admin/task-templates/:id` | can_create_tasks | Soft delete (is_active=false) |
| GET | `/store-tasks/today` | auth | Today's instances for user's store |
| PATCH | `/store-tasks/:id/complete` | auth | Complete instance (photo_url, notes) |
| GET | `/store-tasks/stats` | auth | Completion % — store users get own store; seniors get area/all |
| POST | `/store-tasks/generate` | can_create_tasks | Manually trigger instance generation for a period |

Instance generation (creating `store_task_instances` rows from `store_task_templates`) can be lazy — run on first request for a given period, not via a scheduler. Write a shared `ensureInstancesExist(db, storeId, date)` helper that the `/store-tasks/today` endpoint calls.

---

## Database schema reference

The Phase 9 schema is fully specified in `docs/phase9-store-tasks-and-roles.md`. Key tables:

- `areas` — area_name, area_code
- `users` — name, role, store_id, area_id, pin_hash (may not exist yet — check the DB)
- `store_task_templates` — title, description, instructions, category, frequency, due_window, requires_photo, requires_notes, applies_to, area_ids, store_ids, assigned_to_role, is_active, sort_order
- `store_task_instances` — template_id, store_id, period_key, due_date, status, completed_by, completed_at, photo_url, notes
  - UNIQUE constraint: `(template_id, store_id, period_key)`

Before running any migrations, check which tables already exist in `supabase-schema.sql` and in Supabase directly if you can. Do not recreate tables that already exist.

---

## What to check before you start

Run these checks first:

1. **Does `users` table exist?** The Phase 9B design calls for it. If it doesn't exist yet, the role-based auth is still using the shared PIN model. Note this and implement around it.

2. **Do `store_task_templates` and `store_task_instances` exist?** If not, create them via SQL migrations appended to `supabase-schema.sql`.

3. **Does `areas` table exist?** If not, create it.

4. **Where are role strings defined in the frontend?** Search for existing role check patterns — they may be in `App.jsx`, a `lib/auth.js`, or inline in components. Follow whatever pattern exists.

5. **How does the token currently encode role?** Check `authenticate()` in `functions/api/[[route]].js`. If the token only has `mode` (store/backoffice) and no `role` field yet, adding roles requires updating the token payload — which means existing sessions will break and users will need to log in again. This is acceptable; note it in a `## Breaking changes` section at the top of your PR.

6. **How does the product lookup endpoint join suppliers?** Check the current SQL query in `[[route]].js` for `/products/lookup`. It currently queries the `products` table. You need to add a LEFT JOIN to `suppliers`.

---

## CSS and component conventions

- **No new CSS classes if an existing one covers it.** Read `App.css` first.
- Use existing `.card`, `.card-body`, `.card-header`, `.btn`, `.badge`, `.form-group`, `.form-grid`, `.table-wrap`, `table` patterns.
- Admin pages follow the pattern: page header → optional filter bar → card with table → action modal.
- Toasts use `useToast()` from `components/Toast.jsx`.
- All loading states use `<Skeleton />` or the spinner pattern — check what exists.
- Mobile: buttons ≥ 44px tall on phones. Inputs use `font-size: 16px` minimum to prevent iOS zoom.

---

## Deferred / out of scope for this phase

Do not implement these in this phase:

- Push notifications for assigned tasks
- Background sync for task instances (lazy generation is sufficient)
- Gamification / completion leaderboards
- Per-task comments or discussion threads
- Task templates importing via CSV

---

## Output expected

At the end of this phase, provide:

1. All changed/new source files committed and pushed
2. A SQL migration snippet (can be appended to `supabase-schema.sql`) for any new columns or tables
3. A brief `## What changed` summary at the top of `Project_Status.MD` noting:
   - Role renames applied everywhere
   - New routes added
   - `supplier_id` added to products
   - New pages added (routes, visible to which roles)
4. Updated `CLAUDE.md` reflecting the new role keys and Phase 9 sub-phase status

If you discover that the codebase differs significantly from what this file describes — for example the auth model is different, or certain tables don't exist — document what you found, adapt the implementation to fit reality, and note the deviation clearly.
