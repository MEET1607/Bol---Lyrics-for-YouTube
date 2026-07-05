import type { LyricsResult } from '../types';

/**
 * A confident song identification a provider made even though it couldn't
 * supply usable lyrics itself (e.g. NetEase knows the song but has no LRC).
 * The orchestrator uses this to re-query other providers with the canonical
 * track/artist name — solving "YouTube title ≠ catalog title" mismatches.
 */
export interface CanonicalSong {
  trackName: string;
  artistName: string;
  durationSec?: number;
  /** The similarity score that backed this identification (high bar: >= 0.8). */
  confidence: number;
  /** Which provider identified it (for logs). */
  source: string;
}

export interface ProviderOutcome {
  lyrics: LyricsResult | null;
  /** Set when lyrics is null but the provider confidently identified the song. */
  canonical?: CanonicalSong;
}

/**
 * Pluggable lyrics provider (see ARCHITECTURE.md "Lyrics Provider Layer").
 *
 * To add a provider: implement this interface in a new file under
 * src/lib/providers/, then append it to PROVIDERS in providers/index.ts.
 * Nothing else in the app needs to change. If the provider's API host is not
 * already in manifest host_permissions, add it there too.
 */
export interface LyricsProvider {
  /** Stable id, used in logs and LyricsResult.provider. */
  name: string;
  /**
   * Search for lyrics given raw YouTube metadata. Return { lyrics: null } for
   * "no match" (optionally with a canonical identification); throw only for
   * unexpected failures (treated as "no match", but logged as errors).
   *
   * durationSec (YouTube video length) is used to corroborate or reject
   * matches — risky query candidates MUST NOT be accepted without it.
   *
   * Implementations fire their strategy queries in parallel (bounded by the
   * shared request timeout) but MUST apply selection in priority order.
   */
  search(rawTitle: string, channel: string, durationSec?: number): Promise<ProviderOutcome>;
}
