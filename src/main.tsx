import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { clearReloadFlag, reloadForUpdate } from './components/ErrorBoundary';
import { AuthProvider } from './lib/auth';
import './index.css';

// A page file from an older version could not be loaded (the app was updated while this tab was open).
window.addEventListener('vite:preloadError', (e) => { if (reloadForUpdate()) e.preventDefault(); });
// loaded fine: allow one automatic reload again after the next update
window.setTimeout(clearReloadFlag, 10_000);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
