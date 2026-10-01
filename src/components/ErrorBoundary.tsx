// Shows a clear message instead of a blank page when a screen fails to load.
// After a new version is published, a tab that was already open asks for page files that no longer
// exist: reload once to pick up the new version.
import { Component, type ReactNode } from 'react';

const RELOAD_KEY = 'ialc-reloaded-for-update';
export const isChunkError = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i
    .test(String((e as Error)?.message ?? e));

/** Reload the page once (per tab) to get the newly published version. */
export function reloadForUpdate() {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* storage blocked: still reload */ }
  window.location.reload();
  return true;
}
export function clearReloadFlag() {
  try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ }
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown) { if (isChunkError(error)) reloadForUpdate(); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const update = isChunkError(this.state.error);
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="card p-6 text-center">
          <h2 className="text-lg font-semibold">{update ? 'A new version is available' : 'This page could not be shown'}</h2>
          <p className="mt-1 text-sm text-slate-600">{update ? 'The system was updated. Reload to continue.' : 'Something went wrong. Reload the page - if it happens again, tell head office.'}</p>
          <button className="btn-primary mt-4" onClick={() => { clearReloadFlag(); window.location.reload(); }}>Reload</button>
        </div>
      </div>
    );
  }
}
