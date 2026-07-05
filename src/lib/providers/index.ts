import type { LyricsResult } from '../types';
import type { LyricsProvider, ProviderOutcome } from './types';
import { lrclibProvider, searchLrclibByCanonical } from './lrclib';
import { neteaseProvider } from './netease';
import { getTitleModifiers } from '../normalize';

/**
 * Provider chain. All providers run CONCURRENTLY; results are selected in this
 * array's priority order (lrclib preferred over netease when both hit). To add
 * a provider, implement LyricsProvider (see ./types.ts) and append it here.
 */
const PROVIDERS: LyricsProvider[] = [lrclibProvider, neteaseProvider];

/**
 * Post-process a matched result based on what kind of upload the video is:
 * - Live performance → timestamps from the studio recording are meaningless;
 *   mark untimed so the UI shows a static list instead of wrong highlighting.
 * - Slowed/sped-up edit → same audio stretched uniformly; linearly rescale
 *   every timestamp by the video/track duration ratio so sync actually works.
 * - Otherwise → exact.
 */
function applyTimingMode(result: LyricsResult, rawTitle: string, durationSec?: number): LyricsResult {
  const mods = getTitleModifiers(rawTitle);

  if (mods.live) {
    console.info('[adaptive-lyrics] Live performance detected — marking lyrics untimed (static display)');
    return { ...result, timingMode: 'untimed' };
  }

  if (mods.tempoScaled && result.syncedLyrics?.length && result.duration && durationSec) {
    const ratio = durationSec / result.duration;
    // Sanity band: beyond this it's probably not a plain tempo edit.
    if (ratio >= 0.55 && ratio <= 1.6 && Math.abs(ratio - 1) > 0.02) {
      console.info(
        `[adaptive-lyrics] Tempo edit detected — scaling ${result.syncedLyrics.length} timestamps by ` +
          `${ratio.toFixed(3)} (video ${durationSec}s / track ${result.duration}s)`,
      );
      return {
        ...result,
        timingMode: 'scaled',
        syncedLyrics: result.syncedLyrics.map((l) => ({ ...l, time: l.time * ratio })),
      };
    }
    console.info(
      `[adaptive-lyrics] Tempo keywords in title but ratio ${ratio.toFixed(2)} out of band — keeping exact timing`,
    );
  }

  return { ...result, timingMode: 'exact' };
}

/**
 * Run all providers concurrently, select the first hit in priority order, and
 * — if nobody had lyrics but someone confidently identified the song — run a
 * targeted canonical re-query against LRCLIB (solves "YouTube title ≠ catalog
 * title", e.g. video "Roz Roz Aate Ho" vs catalog "Roz Roz").
 */
export async function findLyrics(
  rawTitle: string,
  rawChannel: string,
  durationSec?: number,
): Promise<LyricsResult | null> {
  const t0 = Date.now();
  console.info(
    `[adaptive-lyrics] Provider chain (concurrent) for rawTitle="${rawTitle}" channel="${rawChannel}" ` +
      `duration=${durationSec ?? 'unknown'}s: ` +
      PROVIDERS.map((p) => p.name).join(' + '),
  );

  const settled = await Promise.allSettled(PROVIDERS.map((p) => p.search(rawTitle, rawChannel, durationSec)));

  const outcomes: ProviderOutcome[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    console.error(`[adaptive-lyrics] Provider "${PROVIDERS[i].name}" threw: ${String(s.reason)}`);
    return { lyrics: null };
  });

  // Priority-order selection.
  for (let i = 0; i < PROVIDERS.length; i++) {
    if (outcomes[i].lyrics) {
      console.info(`[adaptive-lyrics] Lyrics found by provider "${PROVIDERS[i].name}" [chain total ${Date.now() - t0}ms]`);
      return applyTimingMode(outcomes[i].lyrics!, rawTitle, durationSec);
    }
  }

  // Canonical resolution: a provider identified the song but had no lyrics.
  const canonical = outcomes.map((o) => o.canonical).find(Boolean);
  if (canonical) {
    console.info(
      `[adaptive-lyrics] Canonical resolution: "${canonical.source}" identified ` +
        `"${canonical.trackName}" / "${canonical.artistName}" (confidence ${canonical.confidence.toFixed(2)}) ` +
        `— re-querying lrclib with the canonical name`,
    );
    const result = await searchLrclibByCanonical(canonical);
    if (result) {
      console.info(`[adaptive-lyrics] Lyrics found via canonical resolution [chain total ${Date.now() - t0}ms]`);
      return applyTimingMode(result, rawTitle, durationSec);
    }
  }

  console.info(`[adaptive-lyrics] All providers exhausted — no lyrics available. [chain total ${Date.now() - t0}ms]`);
  return null;
}
