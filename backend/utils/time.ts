// Time utilities and drift-compensated tick loop

export function nowMs(): number {
  return Date.now();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export interface TickInfo {
  now: number;  // scheduled tick time (ms)
  dt: number;   // delta since previous tick (ms)
  tick: number; // tick counter
}

export interface TickLoopController {
  start(): void;
  stop(): void;
  get running(): boolean;
}

/**
 * Drift-compensated fixed-rate loop.
 * Calls fn at approximately hz times per second with fixed dt (1000/hz).
 * If the loop falls behind, it processes multiple ticks (capped) to catch up.
 */
export function createTickLoop(hz: number, fn: (t: TickInfo) => void): TickLoopController {
  const dt = 1000 / hz;
  let running = false;
  let expected = 0;
  let tick = 0;
  let handle: number | null = null;

  const step = () => {
    handle = null;
    if (!running) return;

    const now = nowMs();
    let catchups = 0;
    const MAX_CATCHUPS = 5;

    // Process 0..N catch-up ticks to reduce drift
    while (now >= expected && catchups < MAX_CATCHUPS) {
      fn({ now: expected, dt, tick });
      expected += dt;
      tick++;
      catchups++;
    }

    const delay = Math.max(0, expected - now);
    handle = setTimeout(step, delay) as unknown as number;
  };

  return {
    start() {
      if (running) return;
      running = true;
      const startNow = nowMs();
      expected = startNow + dt; // schedule first tick one interval from now
      tick = 0;
      handle = setTimeout(step, dt) as unknown as number;
    },
    stop() {
      running = false;
      if (handle !== null) {
        clearTimeout(handle as number);
        handle = null;
      }
    },
    get running() {
      return running;
    },
  };
}