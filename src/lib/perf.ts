/**
 * Lightweight perf-mark utility (M6 — PRD §10.1).
 *
 * Wraps `performance.now()` + the User Timing API so we can measure the
 * MVP performance targets without pulling in a dependency. Marks are
 * no-ops in production builds (controlled via the `VITE_PERF` env flag)
 * so shipping code pays zero runtime cost unless explicitly enabled.
 *
 * Usage:
 *   import { perf } from '@/lib/perf';
 *   perf.start('page-open');
 *   // ... work ...
 *   perf.end('page-open');              // logs `page-open: 142.3 ms`
 *   perf.wrap('slash-render', () => render());  // auto start/end
 *
 * Marks are also visible in DevTools → Performance → Timings, which is
 * how the PRD §10.1 acceptance evidence is captured.
 */

const ENABLED =
  import.meta.env.DEV ||
  (typeof import.meta.env.VITE_PERF === 'string' &&
    import.meta.env.VITE_PERF !== '0' &&
    import.meta.env.VITE_PERF.toLowerCase() !== 'false');

interface PerfApi {
  /** Start a named timer. Re-starting an existing name overwrites it. */
  start(name: string): void;
  /** End a named timer and log the elapsed milliseconds. */
  end(name: string): number | undefined;
  /** Wrap a function (sync or async) with start/end. Returns the function's result. */
  wrap<T>(name: string, fn: () => T): T;
  wrap<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Mark a point-in-time event (no duration) for timeline correlation. */
  mark(name: string): void;
}

const noopApi: PerfApi = {
  start() {},
  end() {
    return undefined;
  },
  wrap(_name, fn) {
    return fn();
  },
  mark() {},
};

const realApi: PerfApi = {
  start(name) {
    try {
      performance.mark(`folio:${name}:start`);
    } catch {
      // performance API may be unavailable in some test contexts
    }
  },
  end(name) {
    try {
      const start = `folio:${name}:start`;
      const end = `folio:${name}:end`;
      performance.mark(end);
      performance.measure(`folio:${name}`, start, end);
      const entry = performance.getEntriesByName(`folio:${name}`, 'measure').at(-1);
      const ms = entry ? entry.duration : performance.now();
      // eslint-disable-next-line no-console
      console.debug(`[perf] ${name}: ${ms.toFixed(1)} ms`);
      return ms;
    } catch {
      return undefined;
    }
  },
  wrap(name, fn) {
    realApi.start(name);
    if (fn instanceof Promise) {
      return (fn as Promise<unknown>).finally(() => realApi.end(name)) as never;
    }
    try {
      return fn as never;
    } finally {
      realApi.end(name);
    }
  },
  mark(name) {
    try {
      performance.mark(`folio:${name}`);
    } catch {
      // ignore
    }
  },
};

export const perf: PerfApi = ENABLED ? realApi : noopApi;

/** True when perf instrumentation is active. Useful for conditional UI hooks. */
export const PERF_ENABLED = ENABLED;
