/**
 * Metadata normalization — turns messy YouTube titles/channel names into clean
 * artist/track candidates for lyrics lookups.
 *
 * This layer is deliberately over-documented: matching quality lives or dies here,
 * and every pattern below exists because real YouTube uploads use it.
 */

export interface NormalizedMeta {
  /** Title with all decoration noise removed. */
  cleanTitle: string;
  /** Channel with "- Topic", "VEVO", "Records" etc. stripped. */
  cleanChannel: string;
  /** Featured artists pulled out of "feat./ft." clauses (may be empty). */
  featuredArtists: string[];
  /** artist/track split if the title contained "Artist - Track". */
  dashParts: { left: string; right: string } | null;
}

// Bracketed or bare decorations that never belong in a track name.
// Case-insensitive; applied repeatedly until the title stops changing.
const NOISE_PATTERNS: RegExp[] = [
  /[([{]\s*official\s*(music\s*|lyric(al)?\s*)?(video|audio|song|version)?\s*[)\]}]/gi,
  /[([{]\s*(music|lyric(al)?|full)\s*(video|audio|song)\s*[)\]}]/gi,
  /[([{]\s*(lyrics?|audio|visuali[sz]er|video\s*song|full\s*song|full\s*video)\s*[)\]}]/gi,
  /[([{]\s*(hd|hq|4k|8k|1080p|720p|dolby(\s*atmos)?)\s*[)\]}]/gi,
  /[([{]\s*(out\s*now|new\s*(punjabi|hindi|song).*?)\s*[)\]}]/gi,
  // Same decorations appearing WITHOUT brackets, anchored to word boundaries:
  /\bofficial\s*(music\s*|lyric(al)?\s*)?(video|audio)\b/gi,
  /\b(lyric(al)?|music)\s*video\b/gi,
  /\bvideo\s*song\b/gi,
  /\bfull\s*(song|video|audio)\b/gi,
  // Dangling "Full" left over after "Video Song" was stripped from "Full Video Song".
  /\bfull\s*$/gi,
  /\bvisuali[sz]er\b/gi,
  /\b(hd|hq|4k|8k|1080p|720p)\b/gi,
  // Tempo/effect edit markers — stripped so the ORIGINAL recording matches.
  // (The orchestrator separately detects these via getTitleModifiers and
  // rescales timestamps / disables duration gating accordingly.)
  /[([{]?\s*\bslowed\s*[+&xn]?\s*(and\s*)?reverb\b\s*[)\]}]?/gi,
  /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore|8d\s*audio)\b/gi,
  // Bracketed live markers: "(Live at MTV Unplugged)", "[Live]", "(Unplugged)".
  /[([{][^)\]}]*\b(live|unplugged|concert)\b[^)\]}]*[)\]}]/gi,
  // Trailing "| Channel | New Punjabi Song 2026" pipe segments — first pipe onward.
  /\|.*$/,
  // Trailing years / "latest song 2026" tails.
  /\b(latest|new)\s+(punjabi|hindi|hindi\s*song|punjabi\s*song|song)s?\s*(20\d{2})?\s*$/gi,
];

export interface TitleModifiers {
  /** Slowed/sped-up/nightcore edit — same audio, different tempo. Timestamps
   * from the original recording can be linearly rescaled to fit. */
  tempoScaled: boolean;
  /** Live/unplugged performance — different arrangement; timestamps from the
   * studio recording are meaningless. Duration comparison is also meaningless. */
  live: boolean;
}

/** Detect timing-relevant modifiers from the RAW title (before noise stripping). */
export function getTitleModifiers(rawTitle: string): TitleModifiers {
  return {
    tempoScaled: /\b(slowed|sped\s*up|speed\s*up|nightcore)\b|\breverb\b/i.test(rawTitle),
    live:
      /[([{][^)\]}]*\b(live|unplugged|concert)\b[^)\]}]*[)\]}]/i.test(rawTitle) ||
      /\blive\s+(at|in|from)\b|\bunplugged\b/i.test(rawTitle),
  };
}

// "feat. X", "ft. X", "featuring X" — captures the featured-artist clause.
const FEAT_RE = /[([{]?\s*\b(?:feat\.?|ft\.?|featuring)\s+([^)\]}|]+)[)\]}]?/gi;

const CHANNEL_NOISE_RE = /\s*-\s*Topic$|VEVO$|\s*(records|music|official|entertainment|productions|films)\s*$/gi;

function collapseWhitespace(s: string): string {
  return s
    .replace(/[([{]\s*[)\]}]/g, ' ') // leftover empty brackets after noise removal
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—|,]+|[\s\-–—|,]+$/g, '')
    .trim();
}

export function normalizeMeta(rawTitle: string, rawChannel: string): NormalizedMeta {
  let title = rawTitle;

  // Pull featured artists out before stripping noise (the clause is useful data).
  const featuredArtists: string[] = [];
  title = title.replace(FEAT_RE, (_m, names: string) => {
    featuredArtists.push(...names.split(/\s*[,&x]\s*|\s+and\s+/i).map((n) => n.trim()).filter(Boolean));
    return ' ';
  });

  // Strip noise until stable (some titles nest decorations).
  let prev = '';
  while (prev !== title) {
    prev = title;
    for (const pattern of NOISE_PATTERNS) title = title.replace(pattern, ' ');
  }
  title = collapseWhitespace(title);

  const cleanChannel = collapseWhitespace(rawChannel.replace(CHANNEL_NOISE_RE, ' '));

  // "Artist - Track" split (also – and —). Only the FIRST dash matters.
  const dashMatch = title.split(/\s+[-–—]\s+/);
  const dashParts =
    dashMatch.length >= 2 ? { left: dashMatch[0].trim(), right: dashMatch.slice(1).join(' ').trim() } : null;

  // If the channel name is embedded in the title ("LOW FADE KARAN AUJLA" on channel
  // "Karan Aujla"), remove it so the track guess isn't polluted by the artist name.
  let cleanTitle = title;
  if (cleanChannel.length >= 3) {
    const embedded = new RegExp(
      `\\b${cleanChannel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'gi',
    );
    const without = collapseWhitespace(cleanTitle.replace(embedded, ' '));
    if (without.length >= 2) cleanTitle = without;
  }

  return { cleanTitle, cleanChannel, featuredArtists, dashParts };
}

/** One lyrics-lookup attempt. Either artist+track fields or a free-text query. */
export interface QueryCandidate {
  label: string;
  artist?: string;
  track?: string;
  /** Free-text query for LRCLIB's `q=` search mode. */
  q?: string;
  /**
   * Risky = the query is a bare fragment (e.g. one side of a dash split) that
   * can exact-match a WRONG song — "Tamasha" the movie name matches "Tamasha"
   * by Sajjad Ali, an unrelated track. Providers must only accept results from
   * risky candidates with corroboration (fragment + duration; see guards.ts).
   */
  risky?: boolean;
  /**
   * For risky dash-fragment queries: the OTHER side of the dash. A legitimate
   * match usually references it somewhere (movie name in the track title,
   * artist name, album) — used to reject coincidental exact-title matches.
   */
  otherFragment?: string;
}

/**
 * Ordered lookup strategies, most-precise first. The search engine walks this
 * list and stops at the first confident hit.
 */
export function buildQueryCandidates(rawTitle: string, rawChannel: string): QueryCandidate[] {
  const meta = normalizeMeta(rawTitle, rawChannel);
  const { cleanTitle, cleanChannel, dashParts, featuredArtists } = meta;
  const candidates: QueryCandidate[] = [];

  if (dashParts) {
    // "Artist - Track" is the dominant convention…
    candidates.push({ label: 'dash-split artist+track', artist: dashParts.left, track: dashParts.right });
    // …but Indian channels often invert it ("Track - Artist").
    candidates.push({ label: 'dash-split reversed', artist: dashParts.right, track: dashParts.left });
    // The non-track side is often a movie/album name, not an artist
    // ("Matargashti - Tamasha") — so also try each side as a bare track query.
    // Marked risky: a bare fragment can exact-match an unrelated song.
    candidates.push({ label: 'dash-left as track', track: dashParts.left, risky: true, otherFragment: dashParts.right });
    candidates.push({ label: 'dash-right as track', track: dashParts.right, risky: true, otherFragment: dashParts.left });
  }

  if (cleanChannel) {
    candidates.push({ label: 'channel-as-artist + clean title', artist: cleanChannel, track: cleanTitle });
  }

  if (featuredArtists.length > 0) {
    candidates.push({ label: 'featured-artist + clean title', artist: featuredArtists[0], track: cleanTitle });
  }

  candidates.push({ label: 'track-only (no artist filter)', track: cleanTitle });
  candidates.push({ label: 'free-text: clean title', q: cleanTitle });

  if (cleanChannel) {
    candidates.push({ label: 'free-text: clean title + channel', q: `${cleanTitle} ${cleanChannel}` });
  }

  // Dedupe identical queries produced by different strategies.
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.artist ?? ''}|${c.track ?? ''}|${c.q ?? ''}`.toLowerCase();
    if (seen.has(key) || key === '||') return false;
    seen.add(key);
    return true;
  });
}
