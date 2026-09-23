'use client';

import { useEffect, useState } from 'react';
import { readHealth, SERVER_URL, type HealthState } from '../lib/health';

/**
 * Walking skeleton for F001.
 *
 * Deliberately a client component. The point of this page is to prove the
 * cross-origin path D011 creates, and a server component's fetch runs in Node, where
 * CORS does not apply. Only a request issued by the browser exercises preflight and
 * the Access-Control headers, which is also the path F009's streaming will take.
 */
export default function Home() {
  const [health, setHealth] = useState<HealthState | null>(null);

  useEffect(() => {
    let cancelled = false;

    void readHealth().then((result) => {
      if (!cancelled) setHealth(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>Tender Document Agent</h1>
      <p>Scaffold only. The chat interface arrives in F010.</p>
      <h2>API status</h2>
      {health === null && <p>Checking...</p>}
      {health?.reachable === true && (
        <p>
          Server at <code>{SERVER_URL}</code> reports: <strong>{health.status}</strong>
        </p>
      )}
      {health?.reachable === false && (
        <p>
          Could not reach the server at <code>{SERVER_URL}</code>: <strong>{health.reason}</strong>
        </p>
      )}
    </main>
  );
}
