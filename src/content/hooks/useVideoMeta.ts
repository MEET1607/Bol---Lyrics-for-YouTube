import { useEffect, useRef, useState } from 'react';
import { extractVideoMetadata } from '../../lib/domSelectors';
import { dlog } from '../../lib/debug';
import type { SongMetadata } from '../../lib/types';

const POLL_INTERVAL_MS = 800;
const WARN_AFTER_ATTEMPTS = 5;

/**
 * Authoritative metadata source: YouTube's own oEmbed endpoint. Same-origin
 * fetch from the content script, returns the EXACT video title + channel name
 * regardless of DOM layout — immune to the id="title" collision bug that DOM
 * scraping is prone to. DOM selectors remain as the fallback path.
 */
async function fetchOembedMeta(videoId: string): Promise<{ rawTitle: string; channel: string } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string };
    if (!data.title) return null;
    return { rawTitle: data.title, channel: data.author_name ?? '' };
  } catch {
    return null;
  }
}

export function useVideoMeta(): SongMetadata | null {
  const [meta, setMeta] = useState<SongMetadata | null>(null);
  const resolvedVideoId = useRef<string | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    let cancelled = false;

    function readVideoDuration(): number | undefined {
      const d = document.querySelector('video')?.duration;
      return d && Number.isFinite(d) ? Math.round(d) : undefined;
    }

    async function resolve(videoId: string) {
      const t0 = Date.now();
      // Primary: oEmbed (exact, layout-proof).
      const oembed = await fetchOembedMeta(videoId);
      if (cancelled || resolvedVideoId.current === videoId) return;

      if (oembed) {
        const durationSec = readVideoDuration();
        dlog(
          `[adaptive-lyrics] Metadata via oEmbed (${Date.now() - t0}ms): rawTitle="${oembed.rawTitle}" ` +
            `channel="${oembed.channel}" duration=${durationSec ?? 'unknown'}s`,
        );
        resolvedVideoId.current = videoId;
        setMeta({ videoId, rawTitle: oembed.rawTitle, channel: oembed.channel, durationSec });
        return;
      }

      // Fallback: scoped DOM selectors (retried by the poll loop below).
      const dom = extractVideoMetadata();
      attempts.current += 1;

      if (!dom) {
        if (attempts.current === WARN_AFTER_ATTEMPTS) {
          console.warn(
            `[adaptive-lyrics] oEmbed failed AND no DOM match after ${attempts.current} attempts ` +
              `(videoId=${videoId}). Check TITLE_SELECTORS in src/lib/domSelectors.ts. Retrying.`,
          );
        }
        return;
      }

      dlog(
        `[adaptive-lyrics] Metadata via DOM fallback: rawTitle="${dom.rawTitle}" ` +
          `[${dom.titleSource}], channel="${dom.channel}" [${dom.channelSource}]`,
      );
      resolvedVideoId.current = videoId;
      setMeta({ videoId, rawTitle: dom.rawTitle, channel: dom.channel, durationSec: readVideoDuration() });
    }

    function detect() {
      const videoId = new URL(location.href).searchParams.get('v');
      if (!videoId || videoId === resolvedVideoId.current) return;
      void resolve(videoId);
    }

    function onNavigate() {
      // New video: reset state so the pipeline re-runs from scratch.
      attempts.current = 0;
      detect();
    }

    detect();
    const interval = setInterval(detect, POLL_INTERVAL_MS);
    window.addEventListener('yt-navigate-finish', onNavigate);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('yt-navigate-finish', onNavigate);
    };
  }, []);

  return meta;
}
