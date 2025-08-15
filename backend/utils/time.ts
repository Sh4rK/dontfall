// dontfall/backend/utils/time.ts
// Utility functions for time handling in the server

/**
 * Returns the current monotonic time in milliseconds.
 * Uses `performance.now()` if available (Deno) otherwise falls back to Date.
 */
export function nowMs(): number {
  // Deno provides performance.now() which is monotonic.
  // In Deno, globalThis.performance is available.
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * Returns the timestamp (ms) of the next tick based on the tick rate.
 * @param tickRate ticks per second
 * @param lastTickTime timestamp of the previous tick (ms)
 */
export function nextTickTimestamp(tickRate: number, lastTickTime: number): number {
  const interval = 1000 / tickRate;
  return lastTickTime + interval;
}
