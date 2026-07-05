import { useEffect, useState } from 'react';
import type { SyncedLyricLine } from '../../lib/types';

/** Binary search: index of the last line whose timestamp <= t. */
function findActiveIndex(lines: SyncedLyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let idx = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return idx;
}

export function useLyricsSync(lines?: SyncedLyricLine[]): number {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!lines || lines.length === 0) {
      setActiveIndex(-1);
      return;
    }

    let raf = 0;
    // Cache the video element — querying the DOM 60x/sec is wasted work.
    // Re-query only if YouTube swapped the element out (SPA navigation).
    let video: HTMLVideoElement | null = null;
    const tick = () => {
      if (!video || !video.isConnected) video = document.querySelector('video');
      if (video) {
        const idx = findActiveIndex(lines, video.currentTime);
        setActiveIndex((prev) => (prev !== idx ? idx : prev));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines]);

  return activeIndex;
}
