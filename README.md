# IALC – Internal Allocation Control System

Web system for Circle's quick-commerce operation to plan, execute and supervise stock allocations
between the dark stores (Jahra, Egaila, Salmiya, Hawally) and Jahra DC, based on the ERP's
**Stock Transfer Vouchers (STVs)**.

## Why it exists

In the ERP an allocation is **two** stock moves:

1. **Dispatch** – sender posts `Sender D.S / DC → Receiver Allocation` (e.g. `Jahraa D.S 303 → Hawally Allocation 502`).
   The stock leaves the sender and waits in the receiver's *virtual* Allocation store.
2. **Receipt** – receiver posts `Receiver Allocation → Receiver D.S` when goods arrive.
   Only now is the stock visible/sellable in the app.

When step 2 is skipped, stock sits in the virtual store until it expires (e.g. 1.8k SKUs in Egaila
Allocation for 18 months, KWD 15k loss). IALC tracks **plan → dispatch → receipt** line by line,
ages everything left in Allocation stores, and makes every difference someone's explicit, approved
responsibility.

## What it does

| Area | What happens |
|---|---|
| **Allocation plans** | HO uploads the same Excel used today (internal *From X DS* format or DC format). One plan → one leg per destination. |
| **STV upload** | Stores drop the ERP STV **PDF** (or Excel/CSV). It is parsed in the browser, classified as *dispatch / receipt / direct* from the ERP store codes, matched to the plan (dispatch) or to open dispatches (receipt) and compared line by line **before** saving. Original file is archived. |
| **Reconciliation** | Planned vs dispatched vs received per item; receipts are matched to dispatches (linked first, then oldest first), so out-of-order uploads still reconcile. |
| **Discrepancies** | Short / not sent / over / wrong item / unplanned STV / not received / received without dispatch. The responsible store gives a reason, HO approves or rejects (bulk). |
| **In transit** | Everything sitting in Allocation stores with age, SLA status and KWD value. |
| **Virtual store watch** | Upload the ERP stock report of the Allocation stores; each item is classified (not in system / receipt not uploaded / explained) and aged – covers the historical backlog. |
| **Old stock clean-up** | Per item in an Allocation store: receive into store / return to DC / write off / investigate. Store proposes, HO approves, the next ERP report marks it cleared; progress and trend per virtual store. |
| **Receiving count** | Mobile screen for the receiving store: tick, type or scan each line, save the count (HO sees differences at once) and download the exact list to key into the ERP receiving STV. |
| **Pick list** | Printable A4 pick list per destination with barcodes, tick boxes and signatures. |
| **STV checks** | Warns before uploading an STV identical to another on the same route (±3 days); HO page for duplicate pairs and missing STV numbers (global or per-store series). |
| **Month-end close** | HO closes a month: STVs, plans and ERP reports dated in it can no longer be added, voided or changed (enforced by database triggers); a frozen sign-off report is kept. |
| **Search, bell, dashboard** | Search STVs / plans / items from anywhere; notification bell with the user's open tasks; Dashboard tab with charts and the monthly accuracy trend per store. |
| **Items masterlist** | Upload Excel/CSV any time (auto column detection; cost enables KWD values). |
| **Reports** | Excel exports everywhere, incl. the existing tracker layout (received dates, SKUs sent/received, days, SLA per store) generated automatically. |
| **Access** | HO admin (full), HO viewer (read-only), store users (only their stores – enforced in the database with row-level security). Audit log of every action. |

## Architecture

```
Browser (React + Vite, Tailwind)          Supabase
  ├─ pdf.js  → STV PDF parser  ─────────▶ Postgres: tables, RPCs (SECURITY DEFINER), views, RLS
  ├─ exceljs → Excel read / export        Storage: private "documents" bucket (original files)
  └─ supabase-js ───────────────────────▶ Auth (username/password) + Edge Function admin-users
Hosted on Vercel (static)
```

* `src/lib/parsers/` – STV PDF layout parser (column zones calibrated from the header row, wrapped names,
  page breaks, Arabic unit text), allocation/masterlist/snapshot/STV-sheet parsers.
* `supabase/migrations/` – schema, business logic, reconciliation views, security, seed data.
* `supabase/functions/admin-users/` – user management (needs the service role).
* `supabase/tests/` – SQL scenario test incl. RLS isolation; `tests/` – parser tests.

## Setup

1. **Supabase** – apply `supabase/migrations/*.sql` in order and deploy `supabase/functions/admin-users`
   (with *Verify JWT* off – the function checks the caller itself). In *Authentication → Providers → Email*
   turn **off "Allow new users to sign up"** (accounts are created by HO only).
2. **Frontend env** – `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key). See `.env.example`.
3. **Vercel** – framework Vite, build `npm run build`, output `dist` (see `vercel.json`).
4. **First admin** – open `/setup` and use the one-time setup code:
   `select value from public.app_secrets where key = 'bootstrap_code';` (SQL editor).
5. In **Settings → ERP store codes** add/confirm the remaining ERP codes (only 303, 502, 505, 603 were known
   from the sample STVs; new codes on uploaded STVs are auto-mapped from their name and flagged for confirmation).
6. Create store users in **Users & access**, upload the **items masterlist**.

## Development

```bash
npm install
cp .env.example .env.local   # fill in
npm run dev
npm test                     # parser tests
npm run typecheck
PGHOST=/tmp PGPORT=5432 supabase/tests/run.sh   # SQL + RLS tests on a local Postgres
```

The parser and scenario tests use real STV PDFs and allocation sheets placed in `tests/fixtures/`.
These are company documents and are **not committed** (the tests skip when they are absent).

Operating procedure for stores and HO: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).
