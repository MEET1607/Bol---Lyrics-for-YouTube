import type { LyricsResult } from '../types';
import type { CanonicalSong, LyricsProvider, ProviderOutcome } from './types';
import { buildQueryCandidates, type QueryCandidate } from '../normalize';
import { diceSimilarity } from '../similarity';
import { parseLrc } from '../lrc';
import { buildMatchContext, durationScoreModifier, durationTolerance, riskyMatchConfirmed } from './guards';
import { timedFetchJson } from './http';

const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';

// A candidate result must clear this to be accepted outright for the current strategy.
const ACCEPT_SCORE = 0.55;
// After all strategies, the best overall result is still used if it clears this
// floor. Was 0.3, raised to 0.5: at 0.3 a free-text query for "Bairan" returned
// "Dheere Bol Bairan Payaliya" (unrelated 1960s song, score 0.45) as a confident
// final answer. Wrong lyrics are worse than no lyrics.
const FLOOR_SCORE = 0.5;
// Synced lyrics are the core product. If the top scorer is plain-text-only but a
// synced result is within this margin of it (and above ACCEPT_SCORE), take the
// synced one instead — community entries often have junk suffixes in the track
// name ("Low Fade - PagalNew") that depress their similarity score.
const SYNCED_PREFERENCE_MARGIN = 0.35;

interface LrclibSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

function buildUrl(candidate: QueryCandidate): string {
  const params = new URLSearchParams();
  if (candidate.q) {
    params.set('q', candidate.q);
  } else {
    if (candidate.track) params.set('track_name', candidate.track);
    if (candidate.artist) params.set('artist_name', candidate.artist);
  }
  return `${LRCLIB_SEARCH_URL}?${params.toString()}`;
}

/**
 * Score how well an LRCLIB result matches what we asked for.
 * Synced lyrics get a bonus — they're the whole point of the product.
 */
function scoreResult(result: LrclibSearchResult, candidate: QueryCandidate, referenceText: string): number {
  let score: number;

  if (candidate.track) {
    score = diceSimilarity(result.trackName, candidate.track);
    if (candidate.artist) {
      // Track name dominates; artist confirms.
      score = 0.65 * score + 0.35 * diceSimilarity(result.artistName, candidate.artist);
    }
  } else {
    // Free-text query: compare against the combined track+artist string.
    score = diceSimilarity(`${result.trackName} ${result.artistName}`, referenceText);
  }

  if (result.syncedLyrics) score += 0.1;
  if (result.instrumental) score -= 0.5;

  return score;
}

function toLyricsResult(r: LrclibSearchResult): LyricsResult {
  return {
    provider: 'lrclib',
    trackName: r.trackName,
    artistName: r.artistName,
    albumName: r.albumName,
    duration: r.duration,
    plainLyrics: r.plainLyrics,
    syncedLyrics: r.syncedLyrics ? parseLrc(r.syncedLyrics) : undefined,
  };
}

async function search(rawTitle: string, rawChannel: string, durationSec?: number): Promise<ProviderOutcome> {
  const t0 = Date.now();
  const ctx = buildMatchContext(rawTitle, durationSec);
  const candidates = buildQueryCandidates(rawTitle, rawChannel);
  console.info(
    `[adaptive-lyrics] [lrclib] ${candidates.length} strategies (parallel): ${candidates.map((c) => c.label).join(' → ')}`,
  );

  // PHASE 1 — fire every strategy query concurrently.
  const inFlight = candidates.map((c) => timedFetchJson<LrclibSearchResult[]>(buildUrl(c)));

  // PHASE 2 — evaluate in the ORIGINAL priority order (selection semantics
  // identical to the sequential version), awaiting each request as reached:
  // if strategy #1 answers in 2s and is accepted, we return immediately
  // without waiting for slower low-priority requests to finish or time out.
  let bestOverall: { result: LrclibSearchResult; score: number; strategy: string } | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let fetchResult: import('./http').TimedJsonResult<LrclibSearchResult[]>;
    try {
      fetchResult = await inFlight[i];
    } catch (err) {
      fetchResult = { status: 'network-error', ms: 0, error: String(err) };
    }

    if (fetchResult.status === 'timeout') {
      console.warn(
        `[adaptive-lyrics] [lrclib] [${candidate.label}] TIMED OUT after ${fetchResult.ms}ms — ` +
          `NOT a miss, LRCLIB was too slow to answer this query`,
      );
      continue;
    }
    if (fetchResult.status !== 'ok') {
      console.warn(
        `[adaptive-lyrics] [lrclib] [${candidate.label}] ${fetchResult.status}` +
          `${fetchResult.httpStatus ? ` HTTP ${fetchResult.httpStatus}` : ''}${fetchResult.error ? `: ${fetchResult.error}` : ''}`,
      );
      continue;
    }

    const results = fetchResult.data ?? [];
    const referenceText = candidate.q ?? `${candidate.track ?? ''} ${candidate.artist ?? ''}`;
    const scored = results
      .map((r) => ({
        result: r,
        score: scoreResult(r, candidate, referenceText) + durationScoreModifier(ctx, r.duration),
      }))
      .sort((a, b) => b.score - a.score);

    console.info(
      `[adaptive-lyrics] [lrclib] [${candidate.label}] (${fetchResult.ms}ms) ${buildUrl(candidate)} → ` +
        `${results.length} results` +
        (scored.length
          ? `; top: "${scored[0].result.trackName}" / "${scored[0].result.artistName}" ` +
            `(score ${scored[0].score.toFixed(2)}, synced: ${!!scored[0].result.syncedLyrics})`
          : ' (genuine 0 results)'),
    );

    if (scored.length === 0) continue;

    let top = scored[0];

    // Prefer a synced result over a marginally-better-scoring plain-text one.
    if (!top.result.syncedLyrics) {
      const bestSynced = scored.find((sc) => sc.result.syncedLyrics);
      if (bestSynced && bestSynced.score >= ACCEPT_SCORE && top.score - bestSynced.score <= SYNCED_PREFERENCE_MARGIN) {
        console.info(
          `[adaptive-lyrics] [lrclib] [${candidate.label}] preferring SYNCED "${bestSynced.result.trackName}" / ` +
            `"${bestSynced.result.artistName}" (score ${bestSynced.score.toFixed(2)}) over plain-text top ` +
            `"${top.result.trackName}" (score ${top.score.toFixed(2)})`,
        );
        top = bestSynced;
      }
    }

    // Risky candidates (bare dash-split fragments) can exact-match unrelated
    // songs, so they are only usable at all — acceptance AND best-overall
    // fallback — when fragment + duration corroboration confirms the match.
    if (candidate.risky) {
      const resultText = `${top.result.trackName} ${top.result.artistName} ${top.result.albumName ?? ''}`;
      const check = riskyMatchConfirmed(ctx, candidate.otherFragment, resultText, top.result.duration);
      if (!check.ok) {
        console.info(
          `[adaptive-lyrics] [lrclib] [${candidate.label}] top result "${top.result.trackName}" discarded: ${check.reason}`,
        );
        continue;
      }
    }

    if (top.score > (bestOverall?.score ?? -Infinity)) {
      bestOverall = { ...top, strategy: candidate.label };
    }

    if (top.score >= ACCEPT_SCORE) {
      console.info(
        `[adaptive-lyrics] [lrclib] Accepted via [${candidate.label}]: "${top.result.trackName}" / ` +
          `"${top.result.artistName}" (score ${top.score.toFixed(2)}, synced: ${!!top.result.syncedLyrics}) ` +
          `[provider total ${Date.now() - t0}ms]`,
      );
      return { lyrics: toLyricsResult(top.result) };
    }
  }

  if (bestOverall && bestOverall.score >= FLOOR_SCORE) {
    console.info(
      `[adaptive-lyrics] [lrclib] No strategy cleared ${ACCEPT_SCORE}; using best overall from ` +
        `[${bestOverall.strategy}]: "${bestOverall.result.trackName}" / "${bestOverall.result.artistName}" ` +
        `(score ${bestOverall.score.toFixed(2)})`,
    );
    return { lyrics: toLyricsResult(bestOverall.result) };
  }

  console.info(
    `[adaptive-lyrics] [lrclib] All ${candidates.length} strategies exhausted, nothing above floor ` +
      `${FLOOR_SCORE}${bestOverall ? ` (best was ${bestOverall.score.toFixed(2)})` : ''}. ` +
      `[provider total ${Date.now() - t0}ms]`,
  );
  return { lyrics: null };
}

/**
 * Targeted re-query using another provider's canonical identification (e.g.
 * NetEase knows the song is "Roz Roz" / "The Yellow Diary" but has no LRC).
 * The result must corroborate the canonical identification — track name,
 * artist, AND duration when known — a confident guess elsewhere is not a free
 * pass here.
 */
export async function searchLrclibByCanonical(canonical: CanonicalSong): Promise<LyricsResult | null> {
  const t0 = Date.now();
  const primaryArtist = canonical.artistName.split(/\s*[,&]\s*/)[0].trim();

  const queries: { label: string; params: Record<string, string> }[] = [
    { label: 'canonical track+artist', params: { track_name: canonical.trackName, artist_name: primaryArtist } },
    { label: 'canonical track-only', params: { track_name: canonical.trackName } },
  ];

  const settled = await Promise.allSettled(
    queries.map((q) =>
      timedFetchJson<LrclibSearchResult[]>(`${LRCLIB_SEARCH_URL}?${new URLSearchParams(q.params).toString()}`),
    ),
  );

  for (let i = 0; i < queries.length; i++) {
    const s = settled[i];
    const f = s.status === 'fulfilled' ? s.value : null;
    if (!f || f.status !== 'ok') {
      console.warn(
        `[adaptive-lyrics] [lrclib-canonical] [${queries[i].label}] ${f ? f.status : 'failed'}` +
          `${f?.error ? `: ${f.error}` : ''}`,
      );
      continue;
    }

    const results = f.data ?? [];
    const scored = results
      .map((r) => ({
        result: r,
        trackSim: diceSimilarity(r.trackName, canonical.trackName),
        artistSim: Math.max(
          diceSimilarity(r.artistName, canonical.artistName),
          diceSimilarity(r.artistName, primaryArtist),
        ),
      }))
      // Corroboration against the canonical identification, not the raw title.
      .filter((sc) => {
        if (sc.trackSim < 0.6 || sc.artistSim < 0.35) return false;
        if (sc.result.instrumental) return false;
        if (canonical.durationSec && sc.result.duration) {
          return Math.abs(sc.result.duration - canonical.durationSec) <= durationTolerance(canonical.durationSec);
        }
        return true;
      })
      .sort((a, b) => b.trackSim + b.artistSim - (a.trackSim + a.artistSim));

    console.info(
      `[adaptive-lyrics] [lrclib-canonical] [${queries[i].label}] (${f.ms}ms) → ${results.length} results, ` +
        `${scored.length} corroborate "${canonical.trackName}" / "${canonical.artistName}"`,
    );

    if (scored.length === 0) continue;

    const best = scored.find((sc) => sc.result.syncedLyrics) ?? scored[0];
    console.info(
      `[adaptive-lyrics] [lrclib-canonical] Accepted "${best.result.trackName}" / "${best.result.artistName}" ` +
        `(track sim ${best.trackSim.toFixed(2)}, artist sim ${best.artistSim.toFixed(2)}, ` +
        `synced: ${!!best.result.syncedLyrics}) [${Date.now() - t0}ms]`,
    );
    return toLyricsResult(best.result);
  }

  console.info(`[adaptive-lyrics] [lrclib-canonical] No corroborating entry found [${Date.now() - t0}ms]`);
  return null;
}

export const lrclibProvider: LyricsProvider = { name: 'lrclib', search };
