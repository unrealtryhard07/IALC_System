# IALC – Operating procedure

## The rule that stops the losses

> **Stock is only sellable after the receiving store posts `Allocation → D.S` in the ERP.**
> Until then it sits in a virtual store nobody sees. Every STV – sending *and* receiving – is uploaded to IALC the same day.

Receiving SLA: **1 day** after dispatch (Settings). Anything older turns red on every dashboard.

---

## Head office (admin)

**Daily**
1. Dashboard → check *Overdue (not received)*, *Plans awaiting dispatch*, *Awaiting HO approval*.
2. Discrepancies → *Awaiting HO approval* → select → Approve / Reject (rejection needs a note; the store sees it).
3. In transit → filter *Overdue* → chase the receiving stores.

**When sending an allocation**
1. Allocations → **Upload allocation plan** → drop the same Excel you send stores today
   (*From Jahra DS* format or DC format). Check the sending store, date and per-store totals → **Create**.
2. Stores see it under *To dispatch*; they can download a **pick list**.

**Weekly**
1. Virtual store watch → **Upload ERP stock report** for each Allocation store (Excel/CSV: item code + qty; a
   last-receipt date column makes ageing exact). Work the *Not in system* list (old backlog / STVs never uploaded)
   and *Receipt not uploaded* list.
2. Reports → **Allocation tracker** (same layout as the old tracker) and **Discrepancy report** in Excel.
3. Items masterlist → upload the latest masterlist (include **cost** to get KWD values).

**Admin**
* Users & access: one login per person, assigned to their store(s). Disable leavers.
* Settings → ERP store codes: confirm auto-mapped codes (badge *auto – confirm*). Every ERP store number must be
  mapped: D.S = sellable store, Allocation = virtual store, DC.
* A wrong STV uploaded? Open it → **Void** (with reason) – figures recalculate and it can be uploaded again.

---

## Sending store (incl. DC)

1. Dashboard → **To dispatch** shows the plans you must send. Download the pick list if useful.
2. Post the STV in the ERP (`your D.S → receiver's Allocation`), print/save the PDF.
3. IALC → **Upload STV** → drop the PDF. Check:
   * it says **Dispatch** and the right plan is selected;
   * the comparison: *not sent / short / over / not in plan* lines.
4. **Save STV**. Then Discrepancies → select your lines → **Explain** with a reason
   (no stock, near expiry, damaged…). HO approves.

If you sent the balance later on another STV, upload that STV too – the line closes automatically.

## Receiving store

1. Dashboard → **To receive** lists transfers waiting in your Allocation store (age in days).
2. When the goods arrive, count them and post the ERP STV **`your Allocation → your D.S`** for what you actually received.
3. IALC → **Upload STV** → drop the PDF. It says **Receipt**; tick the transfer(s) you are receiving
   (pre-selected) and check the comparison.
4. **Save STV**. Anything not received stays open → Discrepancies → **Explain** (did not arrive, damaged in transit…).

> Never leave stock in the Allocation store "for later". If something is wrong, receive what arrived and explain the rest.

---

## Status meanings

| Status | Meaning |
|---|---|
| Awaiting dispatch | Plan exists, no dispatch STV uploaded yet |
| In transit | Dispatched, nothing received yet |
| Partly received | Some received, some still in the Allocation store |
| Discrepancy open | All received but plan differences not yet approved |
| Completed | Everything received and every difference approved |

| Discrepancy | Who explains |
|---|---|
| Short sent / Not sent / Over sent / Item not in plan / Transfer without plan | Sending store |
| Not received / Received without dispatch | Receiving store |
