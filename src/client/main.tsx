import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { SetupWizard } from './setup/SetupWizard';
import { ToastProvider } from './components/Toast';
import { getSetupStatus } from './setup/setupApi';
import './index.css';

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById('root')!);

  let needsSetup = false;
  let initial: any = null;

  try {
    const status = await getSetupStatus();
    needsSetup = status.needsSetup || window.location.pathname.startsWith('/setup');
    initial = status.current;
  } catch {
    // If the status call fails, assume setup is needed rather than
    // falling through to the main app (which would show a login gate
    // for auth that hasn't been configured yet).
    needsSetup = true;
  }

  if (needsSetup) {
    // Use server-provided config or a minimal fallback so the wizard can render
    const fallback = initial ?? {
      port: 4440,
      cloneHeroSongsDir: '',
      auth: { mode: 'none', google: { clientId: '', clientSecret: '', callbackUrl: '', allowedEmails: [] } },
      tunnel: { enabled: false, hostname: '' },
    };
    root.render(
      <React.StrictMode>
        <SetupWizard initial={fallback} />
      </React.StrictMode>,
    );
  } else {
    root.render(
      <React.StrictMode>
        <ToastProvider>
          <App />
        </ToastProvider>
      </React.StrictMode>,
    );
  }
}

bootstrap();
