import { findLyrics } from '../lib/providers';
import type { FetchLyricsRequest, FetchLyricsResponse } from '../lib/types';

// Per-video cache in chrome.storage.session: survives service-worker restarts,
// cleared when the browser closes. ONLY positive results are cached — a null
// can mean "providers timed out this time", and caching it locks a findable
// song into "Lyrics unavailable" for the whole session (this amplified the
// 5s-timeout regression). Cached nulls from older builds are ignored below.
// The rawTitle is stored alongside so a stale entry from a reused videoId
// (never happens in practice) or a mid-session metadata fix doesn't stick.
interface CacheEntry {
  rawTitle: string;
  result: Awaited<ReturnType<typeof findLyrics>>;
}

function cacheKey(videoId: string): string {
  return `lyrics:${videoId}`;
}

chrome.runtime.onMessage.addListener((message: FetchLyricsRequest, _sender, sendResponse) => {
  if (message?.type !== 'FETCH_LYRICS') return false;

  (async () => {
    try {
      const key = cacheKey(message.videoId);
      const stored = await chrome.storage.session.get(key);
      const cached = stored[key] as CacheEntry | undefined;

      if (cached && cached.result && cached.rawTitle === message.rawTitle) {
        console.info(
          `[adaptive-lyrics] Cache HIT for videoId=${message.videoId} (provider ${cached.result.provider})`,
        );
        sendResponse({ ok: true, result: cached.result } satisfies FetchLyricsResponse);
        return;
      }

      console.info(`[adaptive-lyrics] Cache MISS for videoId=${message.videoId} — running provider chain`);
      // findLyrics runs the full normalize -> multi-strategy pipeline and logs
      // every attempted query + response to this service worker's console
      // (inspect via chrome://extensions -> "service worker").
      const result = await findLyrics(message.rawTitle, message.channel, message.durationSec);
      if (result) {
        await chrome.storage.session.set({
          [key]: { rawTitle: message.rawTitle, result } satisfies CacheEntry,
        });
      }
      sendResponse({ ok: true, result } satisfies FetchLyricsResponse);
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message } satisfies FetchLyricsResponse);
    }
  })();

  return true; // keep the message channel open for the async response
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  console.info(`[adaptive-lyrics][panel] toolbar click → TOGGLE_PANEL to tab ${tab.id}`);
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, () => {
    // Swallow "no receiving end" on tabs without our content script (e.g. a
    // non-YouTube tab) — expected, not an error worth surfacing.
    if (chrome.runtime.lastError) {
      console.info(`[adaptive-lyrics][panel] no panel in tab ${tab.id}: ${chrome.runtime.lastError.message}`);
    }
  });
});
