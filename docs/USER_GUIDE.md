# IALC – Operating procedure

## The rule that stops the losses

> **Stock is only sellable after the receiving store posts `Allocation → D.S` in the ERP.**
> Until then it sits in a virtual store nobody sees. Every STV – sending *and* receiving – is uploaded to IALC the same day.

Receiving SLA: **1 day** after dispatch (Settings). Anything older turns red on every dashboard.

---

## Head office (admin)

**Daily**
1. Overview → *Needs attention* (same list as the **bell** at the top): approvals, late receiving, plans not sent,
   old-stock decisions to approve, possible duplicate STVs, missing STV numbers.
2. Discrepancies → *Awaiting HO approval* → select → Approve / Reject (rejection needs a note; the store sees it).
3. In transit → filter *Overdue* → chase the receiving stores.

**When sending an allocation**
1. Allocations → **Upload allocation plan** → drop the same Excel you send stores today
   (*From Jahra DS* format or DC format). Check the sending store, date and per-store totals → **Create**.
2. Stores see it under *To dispatch*; the sending store opens it and prints the **Pick list** (A4, one page per destination).

**Weekly**
1. Stuck stock & clean-up → **Upload ERP stock report** for each Allocation store (Excel/CSV: item code + qty; a
   last-receipt date column makes ageing exact). Work the *Unknown stuck stock* and *Received, not uploaded* lists.
2. **Clean-up** tab: approve the stores' decisions (*Waiting for approval*), decide the rest yourself, and give the
   **Approved** Excel list to the ERP team. Each new ERP report marks items that are gone as *Cleared*; the progress
   bar and the Dashboard trend show the backlog going down.
3. More → **STV checks**: duplicates (same route, ±3 days, identical lines) and missing STV numbers. Void real
   duplicates; mark the rest as checked with a note.
4. **Dashboard** → accuracy trend per store (sent exactly as planned / received in full), weekly flow, ageing, reasons.
5. Reports → **Allocation tracker** and **Discrepancy report** in Excel.
6. Items masterlist → upload the latest masterlist (include **cost** to get KWD values).

**Monthly**
1. **Month-end close** → pick last month → check the list (not sent, not received, open problems) → **Close**.
   After closing nothing dated in that month can be uploaded, voided or changed; the figures are frozen in the
   **Sign-off report** (Excel). Reopen only with a reason (kept in the activity log).

**Admin**
* Users & access: one login per person, assigned to their store(s). Disable leavers.
* Settings → ERP store codes: confirm auto-mapped codes (badge *auto – confirm*). Every ERP store number must be
  mapped: D.S = sellable store, Allocation = virtual store, DC.
* A wrong STV uploaded? Open it → **Void** (with reason) – figures recalculate and it can be uploaded again.

---

## Sending store (incl. DC)

1. Home → **To dispatch** shows the plans you must send. Open the plan → **Pick list** → print and pick exactly that.
2. Post the STV in the ERP (`your D.S → receiver's Allocation`), print/save the PDF.
3. IALC → **Upload STV** → drop the PDF. Check:
   * it says **Dispatch** and the right plan is selected;
   * the comparison: *not sent / short / over / not in plan* lines.
4. **Save STV**. Then Discrepancies → select your lines → **Explain** with a reason
   (no stock, near expiry, damaged…). HO approves.

If you sent the balance later on another STV, upload that STV too – the line closes automatically.

## Receiving store

1. **Receive stock** (or the bell) lists transfers waiting in your Allocation store (age in days).
2. When the goods arrive, open the transfer on a phone and count: **All** for complete lines, type or +/- for the
   rest, or scan barcodes (each scan adds 1; items not on the STV can be added as extras). **Save count** - head
   office sees it immediately. Download the list and post the ERP STV **`your Allocation → your D.S`** with the counted quantities.
3. IALC → **Upload STV** → drop the PDF. It says **Receipt**; tick the transfer(s) you are receiving
   (pre-selected) and check the comparison.
4. **Save STV**. Anything not received stays open → Discrepancies → **Explain** (did not arrive, damaged in transit…).

> Never leave stock in the Allocation store "for later". If something is wrong, receive what arrived and explain the rest.

**Old stock**: *Old stock clean-up* lists items stuck in your Allocation store. Tick them, choose what happens, send
for approval; after approval do it in the ERP.

**Search**: type an STV number, AL- number, item code, barcode or name in the search box at the top (shortcut `/`).

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
