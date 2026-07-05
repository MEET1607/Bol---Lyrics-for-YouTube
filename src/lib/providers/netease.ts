import type { LyricsResult } from '../types';
import type { CanonicalSong, LyricsProvider, ProviderOutcome } from './types';
import { buildQueryCandidates } from '../normalize';
import { diceSimilarity } from '../similarity';
import { parseLrc } from '../lrc';
import { buildMatchContext, durationScoreModifier, durationTolerance, riskyMatchConfirmed, type MatchContext } from './guards';
import { timedFetchJson } from './http';

/**
 * NetEase Cloud Music (music.163.com) — fallback provider. Surprisingly broad
 * international catalog with community LRC lyrics, often romanized already.
 * Unofficial API, same one used by most open-source lyric tools.
 *
 * Verified live (2026-07): search works without auth or Referer; the lyric
 * endpoint needs `lv=-1` (not `lv=1`, which returns nothing for many songs).
 */

const SEARCH_URL = 'https://music.163.com/api/search/get';
const LYRIC_URL = 'https://music.163.com/api/song/lyric';

const ACCEPT_SCORE = 0.55;
// Bar for a canonical identification (used to drive a cross-provider re-query
// when our own LRC is missing). Deliberately much higher than ACCEPT_SCORE.
const CANONICAL_CONFIDENCE = 0.8;

// NetEase LRC bodies open with credit lines ("作词 : ...", "作曲 : ...") that
// are metadata, not lyrics — strip them.
const CREDIT_LINE_RE = /(作词|作曲|编曲|制作人|混音|母带|Producer|Composer|Lyricist|Arranger)\s*[:：]/i;

interface NeteaseSong {
  id: number;
  name: string;
  duration?: number; // milliseconds
  artists: { name: string }[];
  // Album often carries the movie name for Bollywood tracks ("Tamasha Movie
  // Songs") — essential corroboration evidence for "Track - Movie" titles.
  album?: { name?: string };
}

interface NeteaseSearchResponse {
  result?: { songs?: NeteaseSong[] };
}

async function fetchLrc(songId: number): Promise<string | null> {
  // WARNING: `lv=-1` (and kv/tv) is an UNDOCUMENTED parameter of an unofficial
  // API. The documented-by-the-community `lv=1` returns empty lyrics for many
  // songs; only `-1` reliably returns the full LRC body (verified 2026-07).
  // NetEase could change or remove this at any time WITHOUT any error status —
  // the symptom would be this provider silently returning "no LRC" for
  // everything. If netease stops matching songs it clearly should, test this
  // endpoint manually first.
  const f = await timedFetchJson<{ lrc?: { lyric?: string } }>(`${LYRIC_URL}?id=${songId}&lv=-1&kv=-1&tv=-1`);
  if (f.status !== 'ok') {
    console.warn(`[adaptive-lyrics] [netease] lyric fetch for id ${songId}: ${f.status}${f.error ? ` (${f.error})` : ''}`);
    return null;
  }
  return f.data?.lrc?.lyric || null;
}

/**
 * Fraction of query tokens (len >= 3) present in the candidate text. Dice
 * similarity alone punishes short queries against long official titles
 * ("Matargashti" vs 'Matargashti (From "Tamasha")' scores only ~0.54), so
 * containment rescues exact-word matches. Capped below 1.0 so a real
 * full-string match still outranks it.
 */
function tokenContainment(candidateText: string, query: string): number {
  const haystack = candidateText.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return 0;
  const matched = tokens.filter((t) => haystack.includes(t)).length;
  return (matched / tokens.length) * 0.85;
}

/**
 * A canonical identification must be stronger than a mere accept:
 * - dice-only similarity >= 0.5 (token containment inflates single-word
 *   queries — "Bairan" trivially "contains" in any song named Bairan, which
 *   is NOT evidence it's the right Bairan);
 * - duration agreement with the actual video (unless tempo-edit/live).
 */
function canonicalEligible(ctx: MatchContext, score: number, diceOnly: number, trackSec?: number): boolean {
  if (score < CANONICAL_CONFIDENCE || diceOnly < 0.5) return false;
  if (!ctx.modifiers.tempoScaled && !ctx.modifiers.live && ctx.durationSec && trackSec) {
    return Math.abs(trackSec - ctx.durationSec) <= durationTolerance(ctx.durationSec);
  }
  return true;
}

async function search(rawTitle: string, rawChannel: string, durationSec?: number): Promise<ProviderOutcome> {
  const t0 = Date.now();
  const ctx = buildMatchContext(rawTitle, durationSec);
  // NetEase search is free-text only, so flatten every candidate to a query string.
  const queries = buildQueryCandidates(rawTitle, rawChannel).map((c) => ({
    label: c.label,
    q: c.q ?? [c.track, c.artist].filter(Boolean).join(' '),
    risky: c.risky ?? false,
    otherFragment: c.otherFragment,
  }));

  // PHASE 1 — all searches fired in parallel.
  const inFlight = queries.map((q) =>
    timedFetchJson<NeteaseSearchResponse>(`${SEARCH_URL}?s=${encodeURIComponent(q.q)}&type=1&limit=10`),
  );

  // PHASE 2 — priority-order evaluation (unchanged selection semantics),
  // awaiting each in-flight request as reached so an early winner returns
  // without waiting for slower low-priority requests.
  // LRC fetches stay sequential and on-demand: only for candidates that pass.
  let canonical: CanonicalSong | undefined;

  for (let i = 0; i < queries.length; i++) {
    const { label, q, risky, otherFragment } = queries[i];
    const f = await inFlight[i].catch(() => null);

    if (!f || f.status === 'timeout') {
      console.warn(
        `[adaptive-lyrics] [netease] [${label}] TIMED OUT${f ? ` after ${f.ms}ms` : ''} — NOT a miss, no answer in time`,
      );
      continue;
    }
    if (f.status !== 'ok') {
      console.warn(`[adaptive-lyrics] [netease] [${label}] ${f.status}${f.error ? `: ${f.error}` : ''}`);
      continue;
    }

    const songs = f.data?.result?.songs ?? [];
    const scored = songs
      .map((song) => {
        const combined = `${song.name} ${song.artists.map((a) => a.name).join(' ')} ${song.album?.name ?? ''}`;
        const diceOnly = Math.max(diceSimilarity(combined, q), diceSimilarity(song.name, q));
        let score = Math.max(diceOnly, tokenContainment(combined, q));
        const trackSec = song.duration ? song.duration / 1000 : undefined;
        score += durationScoreModifier(ctx, trackSec);
        return { song, score, diceOnly };
      })
      .sort((a, b) => b.score - a.score);

    console.info(
      `[adaptive-lyrics] [netease] [${label}] (${f.ms}ms) q="${q}" → ${songs.length} results` +
        (scored.length
          ? `; top: "${scored[0].song.name}" / "${scored[0].song.artists[0]?.name}" (score ${scored[0].score.toFixed(2)})`
          : ' (genuine 0 results)'),
    );

    if (scored.length === 0 || scored[0].score < ACCEPT_SCORE) continue;

    const top = scored[0];
    const trackSec = top.song.duration ? top.song.duration / 1000 : undefined;

    // Risky (bare-fragment) queries need fragment + duration corroboration — same rule as lrclib.
    if (risky) {
      const resultText = `${top.song.name} ${top.song.artists.map((a) => a.name).join(' ')} ${top.song.album?.name ?? ''}`;
      const check = riskyMatchConfirmed(ctx, otherFragment, resultText, trackSec);
      if (!check.ok) {
        console.info(`[adaptive-lyrics] [netease] [${label}] top result "${top.song.name}" discarded: ${check.reason}`);
        continue;
      }
    }

    const lrc = await fetchLrc(top.song.id);
    if (!lrc) {
      console.info(`[adaptive-lyrics] [netease] "${top.song.name}" (id ${top.song.id}) has no LRC — trying next strategy`);
      if (!canonical && canonicalEligible(ctx, top.score, top.diceOnly, trackSec)) {
        canonical = {
          trackName: top.song.name,
          artistName: top.song.artists.map((a) => a.name).join(', '),
          durationSec: trackSec,
          confidence: top.score,
          source: 'netease',
        };
        console.info(
          `[adaptive-lyrics] [netease] Canonical identification captured despite missing LRC: ` +
            `"${canonical.trackName}" / "${canonical.artistName}" (confidence ${top.score.toFixed(2)})`,
        );
      }
      continue;
    }

    const synced = parseLrc(lrc).filter((line) => !CREDIT_LINE_RE.test(line.text));
    if (synced.length < 4) {
      console.info(`[adaptive-lyrics] [netease] "${top.song.name}" LRC too short after filtering — skipping`);
      if (!canonical && canonicalEligible(ctx, top.score, top.diceOnly, trackSec)) {
        canonical = {
          trackName: top.song.name,
          artistName: top.song.artists.map((a) => a.name).join(', '),
          durationSec: trackSec,
          confidence: top.score,
          source: 'netease',
        };
        console.info(
          `[adaptive-lyrics] [netease] Canonical identification captured despite unusable LRC: ` +
            `"${canonical.trackName}" / "${canonical.artistName}" (confidence ${top.score.toFixed(2)})`,
        );
      }
      continue;
    }

    console.info(
      `[adaptive-lyrics] [netease] Accepted via [${label}]: "${top.song.name}" / ` +
        `"${top.song.artists.map((a) => a.name).join(', ')}" (score ${top.score.toFixed(2)}, ${synced.length} synced lines) ` +
        `[provider total ${Date.now() - t0}ms]`,
    );

    return {
      lyrics: {
        provider: 'netease',
        trackName: top.song.name,
        artistName: top.song.artists.map((a) => a.name).join(', '),
        duration: trackSec,
        syncedLyrics: synced,
      },
    };
  }

  console.info(
    `[adaptive-lyrics] [netease] All strategies exhausted, no usable LRC` +
      `${canonical ? ` (canonical identification available: "${canonical.trackName}")` : ''}. ` +
      `[provider total ${Date.now() - t0}ms]`,
  );
  return { lyrics: null, canonical };
}

export const neteaseProvider: LyricsProvider = { name: 'netease', search };
