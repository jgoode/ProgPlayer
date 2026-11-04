import { useEffect, useState } from 'react';

import type { AppInfo } from '@core/contracts/api';

declare global {
  interface Window {
    practicePlayer?: {
      getAppInfo(): Promise<AppInfo>;
    };
  }
}

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<string>('Loading…');

  useEffect(() => {
    let cancelled = false;

    void window.practicePlayer?.getAppInfo().then((info) => {
      if (!cancelled) {
        setAppInfo(`${info.name} ${info.version}`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app-shell">
      <h1 className="app-title">PracticePlayer</h1>
      <p className="app-subtitle">Chord progression practice and improvisation backing track.</p>
      <p className="app-status" data-testid="app-version">
        {appInfo}
      </p>
    </main>
  );
}
