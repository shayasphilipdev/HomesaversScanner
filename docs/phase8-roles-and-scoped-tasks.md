# Phase 8 — Roles, Areas, and Assigned Tasks

**Status:** design — no code yet. Captures the requirements you flagged for
"later" so we can react to the shape before any of it is built.

---

## What's changing

Today the app only supports **store-initiated** task records: a store user
scans something they noticed, the back office reviews. Phase 8 inverts
the direction too: **HQ (or an area manager) can assign tasks to one
store, an area, or every store**. Plus a more nuanced role model so
permissions land in the right hands.

Three intertwined concepts arrive together:

1. **Areas** — a real table, not a free-text `region` column on `stores`.
   Stores belong to an area. Area managers are scoped to one or more areas.
2. **Roles** — `store_user`, `store_manager`, `area_manager`, `back_office`.
   Today's PIN-per-store collapses everyone in a store into one role; we
   need to distinguish at least "manager" from "regular user" at the store
   level too.
3. **Assigned tasks** — task records that originate from HQ / an area
   manager and target a scope: all stores, one area, or one specific
   store. These are the inbound version of the existing outbound flow.

---

## Schema sketch

```sql
-- 1. Areas (replaces the free-text stores.region)
CREATE TABLE areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_code   text UNIQUE,
  area_name   text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Stores gain a FK to areas (keep region text for now as fallback /
--    migration). New area_id is nullable until backfilled.
ALTER TABLE stores ADD COLUMN area_id uuid REFERENCES areas(id);

-- 3. Roles. We introduce a real user identity (separate from "the store
--    has one PIN"). Each user belongs to a store OR is an area manager
--    (with a many-to-many to areas) OR is back office.
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username    text UNIQUE NOT NULL,
  display_name text NOT NULL,
  role        text NOT NULL,             -- store_user | store_manager | area_manager | back_office
  store_id    uuid REFERENCES stores(id),   -- set for store_user / store_manager
  pin_hash    text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Many-to-many: an area_manager can cover several areas
CREATE TABLE user_areas (
  user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  area_id  uuid REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, area_id)
);

-- 4. Assigned tasks. The inbound side: HQ or an area manager creates a
--    template and the system materialises one task_records row per
--    target store. Existing task_records gets an optional FK back.
CREATE TABLE task_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type       text NOT NULL REFERENCES task_types(code),
  title           text NOT NULL,
  instructions    text,
  scope           text NOT NULL,        -- 'all' | 'area' | 'store'
  scope_area_id   uuid REFERENCES areas(id),
  scope_store_id  uuid REFERENCES stores(id),
  due_at          timestamptz,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE task_records ADD COLUMN assignment_id uuid REFERENCES task_assignments(id);
ALTER TABLE task_records ADD COLUMN assigned_to_user_id uuid REFERENCES users(id);
```

---

## Permissions matrix

| Action                                                  | store_user | store_manager | area_manager | back_office |
|---|:-:|:-:|:-:|:-:|
| Create a task record (current "noticed an issue" flow)  | ✅ own store | ✅ own store | ✅ any store they manage | ✅ any store |
| Review records (Complete / No change)                    | —          | ✅ own store's records | ✅ records from stores in their areas | ✅ all |
| Create an assignment scoped to a single store           | —          | own store only | stores in their areas | any |
| Create an assignment scoped to an area                  | —          | —             | their areas only | any area |
| Create an assignment scoped to all stores               | —          | —             | —             | ✅ |
| Manage stores / suppliers / lookups / products          | —          | —             | —             | ✅ |
| Manage users + PINs                                     | —          | own store users | users in their areas | all |
| Run reports                                             | own store | own store | their areas | all |

The current `mode = 'store' | 'backoffice'` collapses into role-based
behaviour. PIN flow stays the same, but the JWT payload gains
`{ role, storeId, areaIds[] }` and the API authorises against those.

---

## UI changes

- **Inbox** — a new page (or section on Dashboard) showing assignments
  waiting for the current user/store. Store users land here when an
  assignment targets them.
- **Tasks page** (existing) becomes "Tasks → Self-initiated". Reporting
  an issue not asked for is still here.
- **Tasks → Assignments** — for store_managers/area_managers/back_office,
  a list-view of open assignments with progress per store.
- **New "Create assignment" flow** — picks task type, scope (all / area
  / store), optional due date, optional instructions. Permissions hide
  the scopes the user can't reach.
- **Admin → Areas** — new tab for back office; areas CRUD.
- **Admin → Users** — replaces (or extends) the per-store PIN with
  a real user list per store / area.

---

## Migration path (no big-bang)

1. **Areas table + admin tab**, backfill area_id on stores from the
   existing `region` text. Region stays as a comment for one release.
2. **Users table + auth changes**, with a one-time script that creates
   a `store_user` row per existing store (PIN moves from `stores.pin_hash`
   to `users.pin_hash`). One back_office user gets the existing
   back-office PIN. App still logs in by PIN; the dropdown now shows
   "Store users" within each store.
3. **Assignments** as an additive feature — old "self-initiated" flow
   unchanged; assignments simply add an inbound channel.
4. **UI rollout** — Inbox first (read-only), then assignment creation
   per scope tier (store → area → all).

---

## Open questions

- Do store users self-identify with their own PIN (per-person) or stay
  with a shared store PIN? Per-person gives an audit trail; shared keeps
  onboarding simple. Recommend **per-person for managers, optional for
  rank-and-file**.
- Do assignments materialise records eagerly (one row per store at
  creation time) or lazily (record appears when a store first responds)?
  Eager is easier to report on; lazy avoids cluttering the table with
  unfulfilled assignments. Recommend **eager** — Reports already filter
  by status, and `pending` rows tell you who hasn't done it.
- Do area_managers need read-only access to other areas, or strict
  scope? Strict is simpler and probably correct.
- Notifications: in-app inbox is enough for v1. Email / SMS would need
  a paid provider — defer.

---

## What I'd estimate

Conservatively, four sub-phases:

- **8A** — Areas table + admin tab + backfill (~ day)
- **8B** — Users table + role-aware auth + migration (~ 2 days)
- **8C** — Assignments table + assignment-creation UI per role + Inbox (~ 2–3 days)
- **8D** — Reports + Dashboard updates to honour assignments and roles (~ 1 day)

Total: ~ a week of focused work.

When you're ready to start, react to this doc first — anything to add,
remove, or rename. The schema sketch above is the single biggest
decision; everything else flexes around it.
