import { useState } from 'react';
import { Alert, Badge, Card, Field, PageHeader, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { DISC_KIND } from '../lib/labels';
import { norm } from '../lib/parsers/sheet';
import { friendlyError, supabase } from '../lib/supabase';
import type { DiscKind, ErpLocation, ReasonCode, Site } from '../lib/types';

type Tab = 'sla' | 'locations' | 'stores' | 'reasons';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('sla');
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'sla', label: 'SLA' }, { value: 'locations', label: 'ERP store codes' }, { value: 'stores', label: 'Stores' }, { value: 'reasons', label: 'Reason codes' },
      ]} />
      {tab === 'sla' && <Sla />}
      {tab === 'locations' && <Locations />}
      {tab === 'stores' && <Stores />}
      {tab === 'reasons' && <Reasons />}
    </div>
  );
}

function useSaver() {
  const a = useAuth();
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    const { error } = await fn();
    setMsg(error ? { tone: 'bad', text: friendlyError(error) } : { tone: 'good', text: 'Saved.' });
    if (!error) await a.reload();
  };
  return { msg, run };
}

function Sla() {
  const a = useAuth();
  const { msg, run } = useSaver();
  const [d, setD] = useState(a.dispatchSla);
  const [r, setR] = useState(a.receiptSla);
  return (
    <Card title="Service levels" className="max-w-xl">
      <div className="space-y-3">
        <Field label="Dispatch SLA (days after plan date)" hint="A plan not dispatched within this many days shows as late."><input className="input w-32" type="number" min={0} value={d} onChange={(e) => setD(Number(e.target.value))} /></Field>
        <Field label="Receiving SLA (days after dispatch)" hint="Stock still in an Allocation store after this many days is overdue and becomes a 'Not received' discrepancy."><input className="input w-32" type="number" min={0} value={r} onChange={(e) => setR(Number(e.target.value))} /></Field>
        <button className="btn-primary" onClick={() => run(() => supabase.from('settings').upsert([{ key: 'dispatch_sla_days', value: d }, { key: 'receipt_sla_days', value: r }]))}>Save</button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>
    </Card>
  );
}

function Locations() {
  const a = useAuth();
  const { msg, run } = useSaver();
  const [n, setN] = useState<ErpLocation>({ code: '', erp_name: '', site_id: a.sites[0]?.id ?? 0, kind: 'allocation', auto_created: false });
  const save = (l: ErpLocation) => run(() => supabase.from('erp_locations').upsert({ code: l.code.trim(), erp_name: l.erp_name.trim(), site_id: l.site_id, kind: l.kind, auto_created: false }));
  return (
    <div className="space-y-4">
      <Alert tone="info">Every ERP store number printed on an STV must map to a store and a type. <b>Allocation</b> = the virtual in-transit store. New codes seen on an STV are added automatically from their name - confirm them here.</Alert>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card pad={false}>
        <table className="w-full">
          <thead><tr><th className="th">Code</th><th className="th">Name on STV</th><th className="th">Store</th><th className="th">Type</th><th className="th" /></tr></thead>
          <tbody>
            {a.locations.map((l) => <LocationRow key={l.code} l={l} onSave={save} />)}
            <tr className="bg-slate-50">
              <td className="td"><input className="input w-24 font-mono" placeholder="e.g. 504" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} /></td>
              <td className="td"><input className="input" placeholder="e.g. Salmiya Allocation" value={n.erp_name} onChange={(e) => setN({ ...n, erp_name: e.target.value })} /></td>
              <td className="td"><SiteSel value={n.site_id} onChange={(v) => setN({ ...n, site_id: v })} /></td>
              <td className="td"><KindSel value={n.kind} onChange={(v) => setN({ ...n, kind: v })} /></td>
              <td className="td"><button className="btn-primary btn-sm" disabled={!n.code || !n.erp_name} onClick={() => save(n)}>Add</button></td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
function LocationRow({ l, onSave }: { l: ErpLocation; onSave: (l: ErpLocation) => void }) {
  const [v, setV] = useState(l);
  const dirty = v.erp_name !== l.erp_name || v.site_id !== l.site_id || v.kind !== l.kind;
  return (
    <tr>
      <td className="td font-mono">{l.code} {l.auto_created && <Badge tone="warn">auto - confirm</Badge>}</td>
      <td className="td"><input className="input" value={v.erp_name} onChange={(e) => setV({ ...v, erp_name: e.target.value })} /></td>
      <td className="td"><SiteSel value={v.site_id} onChange={(x) => setV({ ...v, site_id: x })} /></td>
      <td className="td"><KindSel value={v.kind} onChange={(x) => setV({ ...v, kind: x })} /></td>
      <td className="td"><button className="btn-secondary btn-sm" disabled={!dirty && !l.auto_created} onClick={() => onSave(v)}>{l.auto_created && !dirty ? 'Confirm' : 'Save'}</button></td>
    </tr>
  );
}
function SiteSel({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const a = useAuth();
  return <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>{a.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
}
function KindSel({ value, onChange }: { value: ErpLocation['kind']; onChange: (v: ErpLocation['kind']) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as ErpLocation['kind'])}>
      <option value="ds">D.S (sellable dark store)</option><option value="allocation">Allocation (virtual)</option><option value="dc">DC</option>
    </select>
  );
}

function Stores() {
  const a = useAuth();
  const { msg, run } = useSaver();
  const [n, setN] = useState({ name: '', kind: 'ds' as Site['kind'] });
  return (
    <div className="space-y-4">
      <Alert tone="info">Aliases are the names that may appear as column headers in allocation Excels or in ERP store names (lower case). Example: Hawally → hawally, hawally ds, hawalli.</Alert>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card pad={false}>
        <table className="w-full">
          <thead><tr><th className="th">Store</th><th className="th">Type</th><th className="th">Aliases (comma separated)</th><th className="th">Active</th><th className="th" /></tr></thead>
          <tbody>
            {a.sites.map((s) => <StoreRow key={s.id} s={s} onSave={(v) => run(() => supabase.from('sites').update({ name: v.name, aliases: v.aliases, active: v.active }).eq('id', s.id))} />)}
            <tr className="bg-slate-50">
              <td className="td"><input className="input" placeholder="New store name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></td>
              <td className="td"><select className="input" value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value as Site['kind'] })}><option value="ds">Dark store</option><option value="dc">DC</option></select></td>
              <td className="td text-xs text-slate-500">Aliases can be added after creating.</td><td className="td" />
              <td className="td"><button className="btn-primary btn-sm" disabled={!n.name.trim()} onClick={() => run(() => supabase.from('sites').insert({ name: n.name.trim(), kind: n.kind, aliases: [norm(n.name)], sort_order: a.sites.length + 1 }))}>Add</button></td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
function StoreRow({ s, onSave }: { s: Site; onSave: (v: { name: string; aliases: string[]; active: boolean }) => void }) {
  const [name, setName] = useState(s.name);
  const [aliases, setAliases] = useState(s.aliases.join(', '));
  const [active, setActive] = useState(s.active);
  return (
    <tr>
      <td className="td"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="td text-sm">{s.kind === 'dc' ? 'DC' : 'Dark store'}</td>
      <td className="td"><input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} /></td>
      <td className="td"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /></td>
      <td className="td"><button className="btn-secondary btn-sm" onClick={() => onSave({ name: name.trim(), aliases: [...new Set(aliases.split(',').map((x) => norm(x)).filter(Boolean))], active })}>Save</button></td>
    </tr>
  );
}

function Reasons() {
  const a = useAuth();
  const { msg, run } = useSaver();
  const [n, setN] = useState<ReasonCode>({ code: '', label: '', applies_to: ['dispatch_short'], sort_order: 500, active: true });
  const kinds = Object.keys(DISC_KIND) as DiscKind[];
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card pad={false}>
        <table className="w-full">
          <thead><tr><th className="th">Code</th><th className="th">Label</th><th className="th">Used for</th><th className="th">Active</th></tr></thead>
          <tbody>
            {a.reasons.map((r) => (
              <tr key={r.code}>
                <td className="td font-mono text-xs">{r.code}</td><td className="td">{r.label}</td>
                <td className="td"><div className="flex flex-wrap gap-1">{r.applies_to.map((k) => <Badge key={k}>{DISC_KIND[k as DiscKind]?.short ?? k}</Badge>)}</div></td>
                <td className="td"><input type="checkbox" checked={r.active} onChange={(e) => run(() => supabase.from('reason_codes').update({ active: e.target.checked }).eq('code', r.code))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Add reason" className="max-w-2xl">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Code"><input className="input font-mono uppercase" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} /></Field>
          <Field label="Label"><input className="input" value={n.label} onChange={(e) => setN({ ...n, label: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {kinds.map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={n.applies_to.includes(k)} onChange={(e) => setN({ ...n, applies_to: e.target.checked ? [...n.applies_to, k] : n.applies_to.filter((x) => x !== k) })} />
              {DISC_KIND[k].label}
            </label>
          ))}
        </div>
        <button className="btn-primary mt-3" disabled={!n.code || !n.label || !n.applies_to.length} onClick={() => run(() => supabase.from('reason_codes').insert(n))}>Add reason</button>
      </Card>
    </div>
  );
}
