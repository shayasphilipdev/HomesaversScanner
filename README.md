# Homesavers Scanner App

Retail barcode scanner and product data collection app.  
**Stack:** React + Vite (frontend) · Cloudflare Pages Functions (backend API) · Supabase (PostgreSQL)

---

## Project structure

```
homesavers-scanner/
├── client/                     React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Nav.jsx
│   │   │   ├── StoreSelector.jsx
│   │   │   ├── ProductForm.jsx
│   │   │   └── ProductList.jsx
│   │   ├── pages/
│   │   │   ├── ProductData.jsx
│   │   │   └── Reports.jsx
│   │   ├── lib/
│   │   │   ├── api.js          All fetch calls (proxy to /api/*)
│   │   │   └── uom.js          UOM constants and Eachs warning
│   │   ├── App.jsx             Routes + StoreContext
│   │   ├── App.css             All styling
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── functions/
│   └── api/
│       └── [[route]].js        Cloudflare Pages Function (all /api/* routes)
├── supabase-schema.sql         Run once in Supabase SQL Editor
├── .dev.vars.example           Copy to .dev.vars for local dev (git-ignored)
├── wrangler.toml               Cloudflare Pages config
├── .gitignore
└── package.json
```

---

## First-time setup

### 1 — Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor → New query**, paste `supabase-schema.sql`, and run it.
3. Add your stores:
   ```sql
   INSERT INTO stores (store_code, store_name, region)
   VALUES ('HS001', 'Homesavers Dublin', 'Leinster');

   UPDATE stores
   SET pin_hash = crypt('1234', gen_salt('bf'))
   WHERE store_code = 'HS001';
   ```
4. Set the back office PIN:
   ```sql
   UPDATE app_settings
   SET value = crypt('yourpin', gen_salt('bf'))
   WHERE key = 'backoffice_pin_hash';
   ```
5. Copy your **Project URL** and **anon public key** from  
   **Settings → API** — you'll need these in step 3.

### 2 — GitHub

1. Create a new **empty** repository on GitHub (e.g. `homesavers-scanner`).
2. Open **GitHub Desktop**, choose **Add existing repository**, point it at this folder.
3. Commit everything and push to GitHub.

### 3 — Cloudflare Pages

1. Sign in to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages**.
2. Connect your GitHub account and select the `homesavers-scanner` repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `cd client && npm install && npm run build`
   - **Build output directory:** `client/dist`
4. Add environment variables (under **Settings → Environment Variables**):
   - `SUPABASE_URL` = `https://xxxx.supabase.co`
   - `SUPABASE_ANON_KEY` = `eyJ...`
5. Click **Save and Deploy**.

Every `git push` from GitHub Desktop now triggers an automatic redeploy.

---

## Local development

```bash
# Terminal 1 — React dev server (hot reload)
cd client
npm install
npm run dev          # runs on http://localhost:5173

# Terminal 2 — Cloudflare Pages (serves functions + proxies to Vite)
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your Supabase URL and key
npx wrangler pages dev --proxy 5173
# Open http://localhost:8788
```

`.dev.vars` is git-ignored — never commit it.

---

## Deployment

Push any branch from GitHub Desktop → Cloudflare Pages auto-deploys within ~1 minute.

---

## UOM reference

| Value | Meaning |
|---|---|
| Gram | Weight in grams |
| KG | Weight in kilograms |
| Litre | Volume in litres |
| ML | Volume in millilitres |
| Metre | Length in metres |
| CM | Length in centimetres |
| Packs | Sold as a pack |
| PCS | Pieces |
| Nos | Numbers |
| Washes | Wash count (detergent etc.) |
| **Eachs** | **Single piece — triggers warning** |

**Eachs warning:** When a product is marked as Eachs (single piece), every item inside its parent pack must use the same UOM. Staff are shown a warning at data entry and a ⚠️ icon on each Eachs record in the table.

---

## Status workflow

```
pending  →  completed (back office marks done)  →  store_completed (store confirms)
                                                         ↓
                                               marked_for_deletion = true
                                               (can be deleted before retention period)
```

- **Store users** can see all statuses; can only confirm `completed` → `store_completed`.
- **Back office** can mark `pending` → `completed` and delete any record.
- **Store users** can delete their own `store_completed` records.

---

## Adding a new store

```sql
INSERT INTO stores (store_code, store_name, region)
VALUES ('HS002', 'Homesavers Cork', 'Munster');

UPDATE stores
SET pin_hash = crypt('5678', gen_salt('bf'))
WHERE store_code = 'HS002';
```

No code changes needed — the store selector auto-loads from the database.
