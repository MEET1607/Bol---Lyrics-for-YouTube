export interface SongMetadata {
  videoId: string;
  rawTitle: string;
  channel: string;
  /** YouTube video duration in seconds, when known — used to reject wrong-song matches. */
  durationSec?: number;
}

export interface SyncedLyricLine {
  time: number; // seconds
  text: string;
}

export type TimingMode =
  | 'exact' // provider timestamps used as-is
  | 'scaled' // slowed/sped-up upload: timestamps linearly rescaled by duration ratio
  | 'untimed'; // live performance: text shown without sync (studio timing is meaningless)

export interface LyricsResult {
  /** Which provider produced this (see src/lib/providers/). */
  provider: string;
  timingMode?: TimingMode;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  plainLyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
}

export type FetchLyricsRequest = {
  type: 'FETCH_LYRICS';
  videoId: string;
  rawTitle: string;
  channel: string;
  durationSec?: number;
};

export type FetchLyricsResponse =
  | { ok: true; result: LyricsResult | null }
  | { ok: false; error: string };

export type TogglePanelMessage = {
  type: 'TOGGLE_PANEL';
};
