# The Cabinet 🍸

A personal cocktail guide — synced across devices via Supabase.

---

## First-time setup (~30 min)

### 1. Prerequisites

- [Node.js](https://nodejs.org) v18+ — check with `node -v`
- A [GitHub](https://github.com) account
- A [Supabase](https://supabase.com) account (free)
- A [Vercel](https://vercel.com) account (free, sign in with GitHub)

---

### 2. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Give it a name (e.g. `cabinet`), set a database password, choose a region close to you
3. Wait ~2 minutes for it to provision

---

### 3. Set up the database

In your Supabase project, go to **SQL Editor → New query**:

**Step 1 — Create tables:** paste the contents of `supabase/schema.sql` → Run

**Step 2 — Seed recipes:** paste the contents of `supabase/seed.sql` → Run

You should see 180 rows inserted into the `recipes` table.

---

### 4. Get your API keys

In your Supabase project: **Project Settings → API**

Copy:
- **Project URL** (looks like `https://abcdefgh.supabase.co`)
- **anon / public key** (long string starting with `eyJ...`)

---

### 5. Configure the app

```bash
cp .env.example .env
```

Open `.env` and paste your values:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Never commit `.env` to git** — it's already in `.gitignore`.

---

### 6. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — you should see The Cabinet load with all 180 recipes.

---

### 7. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/cabinet.git
git push -u origin main
```

---

### 8. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → Add New Project
2. Import your GitHub repo
3. **Before deploying**, go to **Environment Variables** and add:
   - `VITE_SUPABASE_URL` → your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` → your anon key
4. Click Deploy

Vercel gives you a URL like `https://cabinet-xyz.vercel.app`. Every future `git push` auto-deploys.

---

## Editing recipes outside the app

Open your Supabase project → **Table Editor → recipes**. You can add, edit, or delete rows directly. Changes appear in the app on next load.

To bulk-update recipes programmatically, edit `supabase/seed.sql` and re-run it — the `ON CONFLICT DO UPDATE` clauses make it safe to re-run.

---

## Updating the app

Make changes to the source files, then:

```bash
git add .
git commit -m "describe your change"
git push
```

Vercel auto-deploys within ~30 seconds.

---

## Project structure

```
cabinet/
├── src/
│   ├── main.jsx              # React entry point
│   ├── App.jsx               # Main UI component
│   ├── data.js               # Static recipe data + drink visuals
│   ├── lib/
│   │   └── supabase.js       # Supabase client (2 lines)
│   └── hooks/
│       └── useSupabase.js    # All database reads/writes
├── supabase/
│   ├── schema.sql            # Run once to create tables
│   └── seed.sql              # Run to populate/update recipes
├── .env.example              # Copy to .env and fill in keys
├── .gitignore                # Keeps .env out of git
├── index.html
├── vite.config.js
└── package.json
```

