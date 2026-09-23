export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

export type HealthState =
  { reachable: true; status: string } | { reachable: false; reason: string };

/**
 * Reads the server's health endpoint.
 *
 * Its real job in F001 is to prove the cross-origin path that D011 creates: a fetch
 * from the Next.js origin to the Express origin, with CORS preflight working.
 *
 * Never throws. CLAUDE.md requires the app to degrade to an honest message rather
 * than fake data, so an unreachable API has to be a rendered state, not a crash.
 */
export async function readHealth(fetchImpl: typeof fetch = fetch): Promise<HealthState> {
  try {
    const response = await fetchImpl(`${SERVER_URL}/api/health`, { cache: 'no-store' });

    if (!response.ok) {
      return { reachable: false, reason: `API responded ${String(response.status)}` };
    }

    const body: unknown = await response.json();

    if (typeof body !== 'object' || body === null || !('status' in body)) {
      return { reachable: false, reason: 'API response had no status field' };
    }

    return { reachable: true, status: String((body as { status: unknown }).status) };
  } catch {
    return { reachable: false, reason: 'API unreachable' };
  }
}
