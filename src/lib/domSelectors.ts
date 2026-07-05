/**
 * Centralized DOM selectors for reading YouTube video metadata off the watch page.
 *
 * LESSON LEARNED (v0.1 bug): YouTube reuses `id="title"` and `#channel-name` all
 * over the page — notifications popup, Mix playlist panel, recommendations. An
 * unscoped `document.querySelector('#title ...')` can match the notifications
 * dropdown and feed garbage into the lyrics search. Every selector here is
 * therefore scoped inside the watch-page container (`ytd-watch-flexy` /
 * `ytd-watch-metadata`), never queried against the whole document.
 *
 * This file is the ONLY place that should know about YouTube markup specifics.
 */

interface SelectorSpec {
  selector: string;
  label: string;
}

/** The watch-page container. Everything else is queried relative to this. */
const WATCH_ROOT_SELECTORS = ['ytd-watch-flexy', 'ytd-watch-metadata'];

// Video title, newest layout first — all relative to the watch root.
export const TITLE_SELECTORS: SelectorSpec[] = [
  { selector: 'ytd-watch-metadata #title h1 yt-formatted-string', label: 'watch-metadata h1 (current layout)' },
  { selector: 'ytd-watch-metadata h1 yt-formatted-string', label: 'watch-metadata h1 (loose variant)' },
  { selector: '#above-the-fold #title h1', label: 'above-the-fold title' },
  { selector: 'h1.title.ytd-video-primary-info-renderer', label: 'pre-2023 legacy title renderer' },
];

// Channel / artist name — all relative to the watch root.
export const CHANNEL_SELECTORS: SelectorSpec[] = [
  { selector: 'ytd-video-owner-renderer ytd-channel-name a', label: 'video-owner channel link (current layout)' },
  { selector: '#owner ytd-channel-name a', label: 'owner channel link (alt layout)' },
  { selector: '#upload-info.ytd-video-owner-renderer a', label: 'legacy upload-info link' },
];

function getWatchRoot(): Element | null {
  for (const sel of WATCH_ROOT_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function queryFirstMatch(root: Element, specs: SelectorSpec[]): { text: string; label: string } | null {
  for (const spec of specs) {
    const text = root.querySelector(spec.selector)?.textContent?.trim();
    if (text) return { text, label: spec.label };
  }
  return null;
}

export interface VideoMetadataDom {
  rawTitle: string;
  channel: string;
  titleSource: string;
  channelSource: string;
}

/**
 * Reads title + channel from the watch-page DOM only. Falls back to
 * `document.title` (with the " - YouTube" suffix AND any "(3)" unread-count
 * prefix stripped) when the scoped selectors all miss.
 *
 * Pure — no logging here; callers own retry/warn policy since a miss right
 * after a SPA navigation is normal.
 */
export function extractVideoMetadata(): VideoMetadataDom | null {
  const root = getWatchRoot();
  const titleMatch = root ? queryFirstMatch(root, TITLE_SELECTORS) : null;
  const channelMatch = root ? queryFirstMatch(root, CHANNEL_SELECTORS) : null;

  let rawTitle = titleMatch?.text;
  let titleSource = titleMatch?.label ?? '';

  if (!rawTitle) {
    const docTitle = document.title
      .replace(/^\(\d+\+?\)\s*/, '') // "(9+) " unread-notification prefix
      .replace(/ - YouTube$/, '')
      .trim();
    if (docTitle && docTitle.toLowerCase() !== 'youtube') {
      rawTitle = docTitle;
      titleSource = 'document.title fallback';
    }
  }

  if (!rawTitle) return null;

  return {
    rawTitle,
    channel: channelMatch?.text ?? '',
    titleSource,
    channelSource: channelMatch?.label ?? 'none',
  };
}
