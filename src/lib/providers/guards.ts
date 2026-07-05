/**
 * Shared match-validation guards for lyrics providers.
 *
 * Three failure modes these defend against (all observed in real testing):
 * 1. Wrong-song exact matches from bare dash fragments ("Tamasha" the movie
 *    matched "Tamasha" by Sajjad Ali).
 * 2. Duration coincidences approving wrong songs ("Tum Hi Ho (Live)" at 390s
 *    matched an unrelated 399s track).
 * 3. Legitimate slowed/live uploads being rejected because their duration
 *    doesn't match the original recording's.
 */

import { diceSimilarity } from '../similarity';
import { getTitleModifiers, type TitleModifiers } from '../normalize';

export interface MatchContext {
  durationSec?: number;
  modifiers: TitleModifiers;
}

export function buildMatchContext(rawTitle: string, durationSec?: number): MatchContext {
  return { durationSec, modifiers: getTitleModifiers(rawTitle) };
}

/**
 * Hybrid duration tolerance: fixed floor for short songs (official videos pad
 * intros), percentage for long ones (a 20s window is too strict at 6+ min).
 */
export function durationTolerance(videoDurationSec: number): number {
  return Math.max(20, 0.08 * videoDurationSec);
}

/**
 * Score adjustment from duration agreement. Returns 0 (no signal) when the
 * video is a tempo-edit or live performance — duration comparison against the
 * original recording is meaningless there.
 */
export function durationScoreModifier(ctx: MatchContext, trackDurationSec: number | undefined): number {
  if (ctx.modifiers.tempoScaled || ctx.modifiers.live) return 0;
  if (!trackDurationSec || !ctx.durationSec) return 0;
  const tol = durationTolerance(ctx.durationSec);
  const diff = Math.abs(trackDurationSec - ctx.durationSec);
  if (diff <= tol) return 0.15;
  if (diff >= 2 * tol) return -0.4;
  return 0;
}

/**
 * Semantic corroboration for risky dash-fragment matches: the unused fragment
 * must resemble the result's artist or appear in its track/album text.
 * Duration cannot do this job alone — coincidences pass any window.
 */
export function fragmentCorroborated(otherFragment: string | undefined, resultText: string): boolean {
  if (!otherFragment) return false;
  const haystack = resultText.toLowerCase();
  const tokens = otherFragment.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length > 0) {
    const matched = tokens.filter((t) => haystack.includes(t)).length;
    if (matched / tokens.length >= 0.5) return true;
  }
  return diceSimilarity(otherFragment, resultText) >= 0.5;
}

/**
 * Full acceptance check for a risky candidate's top result.
 * - Always requires fragment corroboration.
 * - Normal videos additionally require duration within tolerance.
 * - Tempo-edited videos require a plausible stretch ratio instead.
 * - Live videos rely on corroboration alone (duration is meaningless).
 */
export function riskyMatchConfirmed(
  ctx: MatchContext,
  otherFragment: string | undefined,
  resultText: string,
  trackDurationSec: number | undefined,
): { ok: boolean; reason: string } {
  if (!fragmentCorroborated(otherFragment, resultText)) {
    return { ok: false, reason: `no fragment corroboration ("${otherFragment ?? ''}" not reflected in result)` };
  }

  if (ctx.modifiers.live) return { ok: true, reason: 'fragment corroborated (live: duration ignored)' };

  if (!ctx.durationSec || !trackDurationSec) {
    return { ok: false, reason: 'no duration available for corroboration' };
  }

  if (ctx.modifiers.tempoScaled) {
    const ratio = ctx.durationSec / trackDurationSec;
    return ratio >= 0.55 && ratio <= 1.6
      ? { ok: true, reason: `tempo-edit ratio ${ratio.toFixed(2)} plausible` }
      : { ok: false, reason: `tempo-edit ratio ${ratio.toFixed(2)} implausible` };
  }

  const tol = durationTolerance(ctx.durationSec);
  const diff = Math.abs(trackDurationSec - ctx.durationSec);
  return diff <= tol
    ? { ok: true, reason: `duration confirmed (±${diff.toFixed(0)}s)` }
    : { ok: false, reason: `duration mismatch (video ${ctx.durationSec}s vs track ${trackDurationSec}s, tol ${tol.toFixed(0)}s)` };
}
