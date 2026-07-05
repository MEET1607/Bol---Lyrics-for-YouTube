/** Shared fetch wrapper: per-request abort timeout + explicit outcome status,
 * so logs can distinguish "provider timed out" from "genuine 0 results". */

// REGRESSION LESSON: this was 5000, which silently killed most LRCLIB lookups.
// Measured LRCLIB latency under the extension's 8-parallel-request load:
// 6 of 8 requests take 5–10s (all complete <10s). In the browser it's worse —
// Chrome queues past 6 connections/host and queue time counts against this
// timeout. 12s covers the real p100 with headroom. Do NOT lower this without
// re-measuring: an aborted search is indistinguishable from "song not found"
// to the user.
export const REQUEST_TIMEOUT_MS = 12000;

export interface TimedJsonResult<T> {
  status: 'ok' | 'timeout' | 'http-error' | 'network-error';
  httpStatus?: number;
  data?: T;
  ms: number;
  error?: string;
}

export async function timedFetchJson<T>(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<TimedJsonResult<T>> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { status: 'http-error', httpStatus: res.status, ms: Date.now() - t0 };
    const data = (await res.json()) as T;
    return { status: 'ok', data, ms: Date.now() - t0 };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return {
      status: aborted ? 'timeout' : 'network-error',
      ms: Date.now() - t0,
      error: aborted ? `aborted after ${timeoutMs}ms` : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
