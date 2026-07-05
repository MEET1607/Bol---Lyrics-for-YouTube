import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoMeta } from './hooks/useVideoMeta';
import { useLyricsSync } from './hooks/useLyricsSync';
import { useSettings } from './hooks/useSettings';
import { LyricsPanel, type PanelStatus } from './components/LyricsPanel';
import { CollapsedTab } from './components/CollapsedTab';
import { dlog } from '../lib/debug';
import type { FetchLyricsResponse, LyricsResult } from '../lib/types';

const DOCK_STYLE_ID = 'adaptive-lyrics-dock-style';

// Coalesce synthetic resize events (YouTube reflow nudges) to one per frame —
// dispatching per mousemove during a resize drag thrashes YouTube's layout.
let resizeNudgePending = false;
function nudgeYouTubeLayout() {
  if (resizeNudgePending) return;
  resizeNudgePending = true;
  requestAnimationFrame(() => {
    resizeNudgePending = false;
    window.dispatchEvent(new Event('resize'));
  });
}

/**
 * Panel lifecycle state machine — the ONE source of truth for visibility.
 *
 *   closed → opening → open → closing → closed
 *
 * Rules (UX spec):
 * - Toggle requests are honored only in `closed` or `open`; clicks during an
 *   animation are logged and ignored (no double-mounts, no races).
 * - The panel DOM is mounted permanently; open/close is purely translateX +
 *   visibility + pointer-events. Nothing is ever remounted.
 * - Opening is user-initiated only (toolbar button, thin tab, Alt+L). No
 *   auto-open, no auto-close on page events. Video changes only swap content.
 */
export type PanelState = 'closed' | 'opening' | 'open' | 'closing';

export const PANEL_ANIM_MS = 280;

// Same curve as the panel slide, so page and panel move as one.
const PANEL_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

function applyDockMargin(width: number, animate: boolean) {
  let styleEl = document.getElementById(DOCK_STYLE_ID) as HTMLStyleElement | null;
  if (width <= 0) {
    if (styleEl) {
      styleEl.remove();
      nudgeYouTubeLayout();
    }
    return;
  }
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = DOCK_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  const reserved = width + 16; // panel + right inset
  // Margin animates in step with the panel slide — except during live resize
  // drags, where animation would make the page lag behind the cursor.
  const transition = animate ? `transition: margin-right ${PANEL_ANIM_MS}ms ${PANEL_EASE}, width ${PANEL_ANIM_MS}ms ${PANEL_EASE};` : '';
  styleEl.textContent = `
    ytd-app { margin-right: ${reserved}px !important; ${transition} }
    #masthead-container { width: calc(100% - ${reserved}px) !important; ${transition} }
  `;
  nudgeYouTubeLayout();
}

export function App() {
  const song = useVideoMeta();
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [settings, updateSettings] = useSettings();
  // Live width during a drag (persisted only on commit to avoid storage spam).
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [onWatchPage, setOnWatchPage] = useState(location.pathname.startsWith('/watch'));

  const width = liveWidth ?? settings.panelWidth;

  const animStart = useRef(0);

  useEffect(() => {
    dlog('[adaptive-lyrics][panel] App mounted');
    return () => dlog('[adaptive-lyrics][panel] App unmounted');
  }, []);

  // --- State machine transitions ------------------------------------------

  // Stable identity (no dependencies): every caller — toolbar message, thin
  // tab, Alt+L — goes through this single function, and the functional update
  // reads the REAL current state, never a stale closure.
  const toggle = useCallback(() => {
    setPanelState((prev) => {
      if (prev === 'opening' || prev === 'closing') {
        dlog(`[adaptive-lyrics][panel] toggle IGNORED (state=${prev}, animation in progress)`);
        return prev;
      }
      const next: PanelState = prev === 'open' ? 'closing' : 'opening';
      animStart.current = performance.now();
      dlog(`[adaptive-lyrics][panel] toggle: ${prev} → ${next} (animation start)`);
      return next;
    });
  }, []);

  const finishAnimation = useCallback(() => {
    setPanelState((prev) => {
      if (prev === 'opening' || prev === 'closing') {
        const elapsed = Math.round(performance.now() - animStart.current);
        const settled: PanelState = prev === 'opening' ? 'open' : 'closed';
        dlog(`[adaptive-lyrics][panel] animation end → ${settled} (${elapsed}ms)`);
        return settled;
      }
      return prev;
    });
  }, []);

  // Fallback: if transitionend never fires (backgrounded tab, display:none
  // ancestors), settle the state anyway so the machine can never get stuck.
  useEffect(() => {
    if (panelState !== 'opening' && panelState !== 'closing') return;
    const timer = window.setTimeout(() => {
      dlog('[adaptive-lyrics][panel] animation fallback timer fired');
      finishAnimation();
    }, PANEL_ANIM_MS + 150);
    return () => window.clearTimeout(timer);
  }, [panelState, finishAnimation]);

  // --- Lyrics fetching (independent of panel visibility) -------------------
  // Runs on every video change so content is ready (or loading) the moment the
  // user opens the panel. Never touches panelState: video changes must not
  // open or close the panel.
  useEffect(() => {
    if (!song) return;

    if (!chrome.runtime?.id) {
      console.warn('[adaptive-lyrics] Extension context invalidated — refresh this tab to reconnect.');
      setStatus('error');
      return;
    }

    // Video switch (spec §4): do NOT blank the panel. Previous lyrics stay
    // rendered (dimmed by the panel) and crossfade to the new song's lyrics
    // when they arrive — the skeleton only shows when there's nothing yet.
    setStatus('loading');
    const tRequest = Date.now();

    try {
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_LYRICS',
          videoId: song.videoId,
          rawTitle: song.rawTitle,
          channel: song.channel,
          durationSec: song.durationSec,
        },
        (response: FetchLyricsResponse | undefined) => {
          if (chrome.runtime.lastError || !response) {
            console.warn(
              `[adaptive-lyrics] Lyrics request failed for "${song.rawTitle}": ` +
                (chrome.runtime.lastError?.message ?? 'no response from background script'),
            );
            setStatus('error');
            return;
          }
          if (!response.ok) {
            console.warn(`[adaptive-lyrics] Lyrics lookup errored for "${song.rawTitle}": ${response.error}`);
            setStatus('error');
            return;
          }
          if (!response.result) {
            setLyrics(null);
            setStatus('not-found');
            return;
          }
          dlog(`[adaptive-lyrics] Lyrics request round-trip: ${Date.now() - tRequest}ms`);
          setLyrics(response.result);
          setStatus('ready');
        },
      );
    } catch (err) {
      console.warn(`[adaptive-lyrics] sendMessage failed: ${(err as Error).message}`);
      setStatus('error');
    }
  }, [song?.videoId]);

  // --- User-initiated toggle sources ---------------------------------------

  // Toolbar button (background relays TOGGLE_PANEL). Registered ONCE — toggle
  // has stable identity, so there is no stale-closure double-toggle.
  useEffect(() => {
    if (!chrome.runtime?.id) return;
    function onMessage(message: { type?: string }) {
      if (message?.type === 'TOGGLE_PANEL') {
        dlog('[adaptive-lyrics][panel] toggle requested via toolbar button');
        toggle();
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        /* context invalidated — nothing to clean up */
      }
    };
  }, [toggle]);

  // Alt+L. (Plain "L" is YouTube's own seek-forward shortcut.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        dlog('[adaptive-lyrics][panel] toggle requested via Alt+L');
        toggle();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // --- Environment tracking -------------------------------------------------
  useEffect(() => {
    const onNavigate = () => setOnWatchPage(location.pathname.startsWith('/watch'));
    const onFullscreen = () => setFullscreen(!!document.fullscreenElement);
    window.addEventListener('yt-navigate-finish', onNavigate);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('yt-navigate-finish', onNavigate);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  // Reserve page space while the panel is (or is becoming) visible.
  const panelVisible = panelState === 'opening' || panelState === 'open';
  useEffect(() => {
    applyDockMargin(panelVisible && onWatchPage && !fullscreen ? width : 0, liveWidth === null);
    return () => applyDockMargin(0, false);
  }, [panelVisible, onWatchPage, fullscreen, width, liveWidth]);

  const activeIndex = useLyricsSync(lyrics?.timingMode === 'untimed' ? undefined : lyrics?.syncedLyrics);

  // Off watch pages and in fullscreen nothing is shown — but panelState is
  // preserved, so returning to a video restores exactly what the user had.
  if (!onWatchPage || fullscreen) return null;

  return (
    <>
      {panelState === 'closed' && <CollapsedTab onExpand={toggle} />}
      <LyricsPanel
        panelState={panelState}
        onAnimationEnd={finishAnimation}
        status={status}
        song={song}
        lyrics={lyrics}
        activeIndex={activeIndex}
        width={width}
        displayMode={settings.displayMode}
        onDisplayModeChange={(displayMode) => updateSettings({ displayMode })}
        onWidthChange={setLiveWidth}
        onWidthCommit={(w) => {
          setLiveWidth(null);
          updateSettings({ panelWidth: w });
        }}
        onCollapse={toggle}
      />
    </>
  );
}
