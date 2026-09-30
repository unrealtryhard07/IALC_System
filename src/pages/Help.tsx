import type { ReactNode } from 'react';
import { Card, PageHeader } from '../components/ui';
import { useAuth } from '../lib/auth';
import { HowItWorks } from './Dashboard';

function Q({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white p-3 open:shadow-sm">
      <summary className="cursor-pointer list-none font-medium text-slate-800">
        <span className="mr-2 inline-block transition group-open:rotate-90">▸</span>{q}
      </summary>
      <div className="mt-2 space-y-2 pl-6 text-sm text-slate-600">{children}</div>
    </details>
  );
}

export default function Help() {
  const a = useAuth();
  const isStore = a.profile?.role === 'store';
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="How it works" subtitle="Everything in one page. Click a question to open it." />
      <HowItWorks />

      <Card title={isStore ? 'For store staff' : 'For store staff (what your stores see)'}>
        <div className="space-y-2">
          <Q q="I sent stock to another store. What do I do?">
            <p>0. Open the allocation and press <b>Pick list</b> - print it and pick exactly those quantities.</p>
            <p>1. Make the STV in the ERP as usual (<b>your D.S → the other store's Allocation</b>).</p>
            <p>2. Open <b>Upload STV</b>, drop the PDF. The system shows <b>"Sent"</b> and compares it with the plan.</p>
            <p>3. Press <b>Save</b>. If something was short or not sent, go to <b>Problems to explain</b> and pick a reason.</p>
          </Q>
          <Q q="Stock arrived at my store. What do I do?">
            <p>1. Open <b>Receive stock</b> on your phone and pick the transfer. Tap <b>All</b> on every line that is complete, type the count where it is not, or scan barcodes (each scan adds 1). Press <b>Save count</b>.</p>
            <p>1b. The app shows the exact list to key in: make the STV in the ERP <b>(your Allocation → your D.S)</b> with the counted quantities.</p>
            <p>2. Open <b>Upload STV</b>, drop the PDF. The system shows <b>"Received"</b> and ticks the transfer it belongs to.</p>
            <p>3. Press <b>Save</b>. Anything missing becomes a problem to explain.</p>
            <p className="rounded bg-amber-50 p-2 text-amber-900">Do this the same day. Stock that is not received stays invisible in the app and can expire.</p>
          </Q>
          <Q q="How do I see allocations coming to my store?">
            <p>Open <b>My allocations → Coming to me</b> (also on your home page). Every allocation planned for your store is listed from the moment head office plans it - even before the other store sends it - with a progress bar: <b>Planned → Sent → Received → Closed</b> and the next step.</p>
          </Q>
          <Q q="What is a 'problem to explain'?">
            <p>Any difference: sent less, not sent, sent extra, wrong item, or not received. Select the lines, choose a reason (no stock, damaged, expired…), add a note if needed, and send. Head office approves or rejects. If rejected you will see why - explain again.</p>
          </Q>
          <Q q="The upload says 'Already uploaded' or 'belongs to another store'.">
            <p><b>Already uploaded</b>: that STV number is already in the system - nothing to do.</p>
            <p><b>Belongs to another store</b>: only the sending store uploads a "Sent" STV, and only the receiving store uploads a "Received" STV.</p>
          </Q>
          <Q q="What is the bell at the top?">
            <p>Everything waiting for you: transfers to receive, allocations to send, problems to explain, and explanations head office rejected. Click a line to go straight there.</p>
          </Q>
          <Q q="How do I find an STV or an item quickly?">
            <p>Type in the search box at the top (or press <b>/</b>): an STV number, a plan number (AL-…), an item code, a barcode or part of the item name. An item page shows where that item is on its way, stuck, planned and every recent STV.</p>
          </Q>
          <Q q="What is 'Old stock clean-up'?">
            <p>Stock that has sat in your Allocation store for a long time. Tick the items, choose what happens (receive into the store, return to DC, write off, or investigate) and send it to head office. Once approved, make the transfer in the ERP. When the next ERP report no longer shows the item it becomes <b>Cleared</b>.</p>
          </Q>
          <Q q="The upload says the month is closed.">
            <p>Head office has closed that month, so nothing dated in it can be added. Ask head office - they can reopen it.</p>
          </Q>
          <Q q="I uploaded the wrong file.">
            <p>Tell head office - they can cancel (void) it and you upload the correct one.</p>
          </Q>
        </div>
      </Card>

      {!isStore && (
        <Card title="For head office">
          <div className="space-y-2">
            <Q q="How do I send a transfer plan to the stores?">
              <p><b>Allocation tracker → Upload a transfer plan</b>. Drop the same Excel you use today (the "From Jahra DS" format or the DC format). Check the sending store and the totals per store, then press <b>Create</b>. Stores see it on their home page.</p>
            </Q>
            <Q q="What should I check every day?">
              <p>Your <b>Home</b> page: explanations to approve, late receiving, plans not sent. Every card has one button that takes you to the list.</p>
            </Q>
            <Q q="How do I find old stock stuck in the Allocation stores?">
              <p>Export the stock report of each Allocation store from the ERP (Excel/CSV with item code and quantity). Open <b>Stuck stock check → Upload ERP report</b>. Items marked <b>Unknown stuck stock</b> are the ones to act on. Do this weekly.</p>
            </Q>
            <Q q="Where are the charts?">
              <p><b>Dashboard</b> has all charts: status, planned vs sent vs received, the monthly <b>accuracy trend per store</b> (sending exactly what was planned / receiving everything that was sent), weekly flow, ageing, reasons, and how the stuck stock in the virtual stores goes down over time.</p>
            </Q>
            <Q q="How does the old stock clean-up work?">
              <p><b>Stuck stock &amp; clean-up → Clean-up</b>. Stores (or you) decide per item; you approve in <b>Waiting for approval</b>. Your own decisions are approved at once. Download the <b>Approved</b> list for the ERP team. Every ERP report you upload afterwards moves the cleared items out and the progress bar up.</p>
            </Q>
            <Q q="What do the STV checks find?">
              <p><b>More → STV checks</b>: the same transfer uploaded twice under two numbers (same route, within 3 days, identical lines) and STV numbers missing between uploaded ones - possibly transfers nobody uploaded. If a finding is fine, mark it as checked with a note. The upload page also warns the store before a possible double upload.</p>
            </Q>
            <Q q="How do I close a month?">
              <p><b>Month-end close</b>, pick the month, look at the checklist and press <b>Close</b>. After that no STV, plan or ERP report dated in that month can be added, voided or changed, and the figures are frozen in the sign-off report (Excel). Open problems can still be explained. Reopen with a reason if needed.</p>
            </Q>
            <Q q="How do I get my Excel tracker?">
              <p><b>Excel reports → Download tracker</b>. It has the same columns as the tracker you used before, filled automatically. Every list also has an <b>Excel</b> button.</p>
            </Q>
            <Q q="How do I add a store user or reset a password?">
              <p><b>More → Users</b>. Give every person their own username so you can see who uploaded what. Store users only see their own store.</p>
            </Q>
          </div>
        </Card>
      )}

      <Card title="Words used in this system">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_1fr]">
          <dt className="font-semibold">STV</dt><dd>Stock Transfer Voucher - the PDF the ERP prints for every transfer.</dd>
          <dt className="font-semibold">Transfer plan</dt><dd>Head office's list of what each store should send (the allocation Excel).</dd>
          <dt className="font-semibold">Allocation store</dt><dd>A virtual store in the ERP (e.g. "Hawally Allocation 502"). Sent stock waits here until the receiving store receives it.</dd>
          <dt className="font-semibold">D.S</dt><dd>The real dark store - stock here can be sold in the app.</dd>
          <dt className="font-semibold">Sent / Received</dt><dd>Sent = STV into another store's Allocation. Received = STV from your Allocation into your D.S.</dd>
          <dt className="font-semibold">Stuck stock</dt><dd>Stock sitting in an Allocation store - not sellable, may expire.</dd>
        </dl>
      </Card>
    </div>
  );
}
