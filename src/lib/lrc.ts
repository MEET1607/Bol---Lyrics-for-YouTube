import type { SyncedLyricLine } from './types';

const LRC_LINE_RE = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

/** Parse standard LRC text ("[mm:ss.xx] line") into sorted timestamped lines. */
export function parseLrc(lrc: string): SyncedLyricLine[] {
  const lines: SyncedLyricLine[] = [];

  for (const rawLine of lrc.split('\n')) {
    const matches = [...rawLine.matchAll(LRC_LINE_RE)];
    if (matches.length === 0) continue;

    const text = rawLine.replace(LRC_LINE_RE, '').trim();
    if (!text) continue;

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fraction = match[3] ? parseFloat(`0.${match[3]}`) : 0;
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}
