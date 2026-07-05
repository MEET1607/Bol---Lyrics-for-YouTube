/** Dev-gated logging: verbose lifecycle logs stay out of production consoles.
 * Warnings/errors are NOT gated — real problems must always surface. */
export const DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

export function dlog(...args: unknown[]): void {
  if (DEV) console.info(...args);
}
