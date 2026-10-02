/**
 * Prices are read from the environment, never hard-coded.
 *
 * Provider pricing changes, and a stale constant in the repo would report a cost that
 * looks measured and is not. With nothing configured, cost is reported as unknown.
 */
export function parsePrice(name: string): number | undefined {
  const raw = (process.env[name] ?? '').trim();

  // Blank is unset, not zero. Number('') is 0, so a blank placeholder would otherwise
  // report a cost of $0.0000, which reads as a measurement and is not one.
  if (raw === '') return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return value;
}
