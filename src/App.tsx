import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Alert, Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { configured } from './lib/supabase';
import Login from './pages/Login';
import Setup from './pages/Setup';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Overview = lazy(() => import('./pages/Overview'));
const StvUpload = lazy(() => import('./pages/StvUpload'));
const Stvs = lazy(() => import('./pages/Stvs'));
const StvDetail = lazy(() => import('./pages/StvDetail'));
const Allocations = lazy(() => import('./pages/Allocations'));
const AllocationNew = lazy(() => import('./pages/AllocationNew'));
const AllocationDetail = lazy(() => import('./pages/AllocationDetail'));
const InTransit = lazy(() => import('./pages/InTransit'));
const Discrepancies = lazy(() => import('./pages/Discrepancies'));
const VirtualStores = lazy(() => import('./pages/VirtualStores'));
const Items = lazy(() => import('./pages/Items'));
const Reports = lazy(() => import('./pages/Reports'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const Audit = lazy(() => import('./pages/Audit'));
const Account = lazy(() => import('./pages/Account'));
const Help = lazy(() => import('./pages/Help'));
const Analytics = lazy(() => import('./pages/Analytics'));
const ReceiveList = lazy(() => import('./pages/Receive'));
const ReceiveCount = lazy(() => import('./pages/Receive').then((m) => ({ default: m.ReceiveCountPage })));
const ItemDetail = lazy(() => import('./pages/ItemDetail'));
const PickList = lazy(() => import('./pages/PickList'));
const StvChecks = lazy(() => import('./pages/StvChecks'));
const MonthEnd = lazy(() => import('./pages/MonthEnd'));

function Guard({ when, children }: { when: boolean; children: ReactNode }) {
  return when ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const a = useAuth();
  if (!configured) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert tone="bad" title="Not configured">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).</Alert>
      </div>
    );
  }
  if (a.loading) return <Spinner />;
  if (!a.session) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (!a.profile || !a.profile.active) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert tone="warn" title="No access">
          Your account is not active or has no role yet. Ask head office to set it up.
          <div className="mt-3"><button className="btn-secondary" onClick={a.signOut}>Sign out</button></div>
        </Alert>
      </div>
    );
  }
  const storeOrAdmin = a.isAdmin || a.profile.role === 'store';
  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={a.isHO ? <Overview /> : <Dashboard />} />
          <Route path="/dashboard" element={<Guard when={a.isHO}><Analytics /></Guard>} />
          <Route path="/receive" element={<ReceiveList />} />
          <Route path="/receive/:id" element={<ReceiveCount />} />
          <Route path="/items/:code" element={<ItemDetail />} />
          <Route path="/allocations/:id/print" element={<PickList />} />
          <Route path="/stv-checks" element={<Guard when={a.isHO}><StvChecks /></Guard>} />
          <Route path="/month-end" element={<Guard when={a.isHO}><MonthEnd /></Guard>} />
          <Route path="/upload" element={<Guard when={storeOrAdmin}><StvUpload /></Guard>} />
          <Route path="/stvs" element={<Stvs />} />
          <Route path="/stvs/:id" element={<StvDetail />} />
          <Route path="/allocations" element={<Allocations />} />
          <Route path="/allocations/new" element={<Guard when={a.isAdmin}><AllocationNew /></Guard>} />
          <Route path="/allocations/:id" element={<AllocationDetail />} />
          <Route path="/in-transit" element={<InTransit />} />
          <Route path="/discrepancies" element={<Discrepancies />} />
          <Route path="/virtual-stores" element={<VirtualStores />} />
          <Route path="/items" element={<Items />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/users" element={<Guard when={a.isAdmin}><Users /></Guard>} />
          <Route path="/settings" element={<Guard when={a.isAdmin}><Settings /></Guard>} />
          <Route path="/audit" element={<Guard when={a.isHO}><Audit /></Guard>} />
          <Route path="/account" element={<Account />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
