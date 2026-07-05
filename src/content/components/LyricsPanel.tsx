import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { LyricsResult, SongMetadata } from '../../lib/types';
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, type DisplayMode } from '../../lib/settings';
import { romanizeLine } from '../../lib/romanize';
import { SyncedLyricsView, StaticLyricsView } from './LyricsView';

export type PanelStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';

interface Props {
  /** Lifecycle state machine value — drives the slide animation. */
  panelState: 'closed' | 'opening' | 'open' | 'closing';
  /** Called when the slide transition finishes (advances the state machine). */
  onAnimationEnd: () => void;
  status: PanelStatus;
  song: SongMetadata | null;
  lyrics: LyricsResult | null;
  activeIndex: number;
  width: number;
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  onCollapse: () => void;
}

const ANIM_MS = 280;

const MODE_OPTIONS: { mode: DisplayMode; label: string; title: string }[] = [
  { mode: 'original', label: 'अ', title: 'Original script' },
  { mode: 'romanized', label: 'A', title: 'Romanized' },
  { mode: 'both', label: 'अ+A', title: 'Original + Romanized' },
];

const PROVIDER_LABELS: Record<string, string> = { lrclib: 'LRCLIB', netease: 'NetEase' };

function syncStatusText(status: PanelStatus, lyrics: LyricsResult | null): { dot: string; text: string } {
  if (status === 'loading') return { dot: 'rgba(255,255,255,0.6)', text: 'Loading' };
  if (status !== 'ready' || !lyrics) return { dot: 'rgba(255,255,255,0.25)', text: 'No lyrics' };
  if (lyrics.timingMode === 'untimed') return { dot: '#f5c05a', text: 'Live' };
  if (!lyrics.syncedLyrics?.length) return { dot: 'rgba(255,255,255,0.4)', text: 'Static' };
  return { dot: '#1DB954', text: 'Synced' };
}

export function LyricsPanel({
  panelState,
  onAnimationEnd,
  status,
  song,
  lyrics,
  activeIndex,
  width,
  displayMode,
  onDisplayModeChange,
  onWidthChange,
  onWidthCommit,
  onCollapse,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    let latest = width;
    const onMove = (e: MouseEvent) => {
      latest = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, window.innerWidth - e.clientX - 8));
      onWidthChange(latest);
    };
    const onUp = () => {
      setDragging(false);
      onWidthCommit(latest);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const romanized = useMemo(
    () => lyrics?.syncedLyrics?.map((line) => romanizeLine(line.text)) ?? [],
    [lyrics],
  );

  const untimed = lyrics?.timingMode === 'untimed';
  const thumbUrl = song ? `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg` : null;
  const title = lyrics?.trackName || song?.rawTitle || 'Detecting song…';
  const artist = lyrics?.artistName || song?.channel || '';
  const sync = syncStatusText(status, lyrics);

  // Video switch: previous song's lyrics stay visible (dimmed) while the next
  // load runs — never a blank flash. The skeleton appears only when there is
  // nothing to show at all.
  const showingStale = status === 'loading' && !!lyrics?.syncedLyrics?.length;
  // Crossfade key: stable while the same lyrics render (incl. stale-dim), new
  // value when new lyrics/state arrive → AnimatePresence fades old out, new in.
  const stageKey =
    status === 'ready' || showingStale ? `lyrics:${lyrics?.trackName}|${lyrics?.artistName}` : status;

  // The panel is ALWAYS mounted; open/close is purely this transform.
  // Slide in from the right, 280ms ease-in-out — no bounce, no opacity games.
  const shown = panelState === 'open' || panelState === 'opening';

  return (
    <div
      className="al-font fixed bottom-2 right-2 top-16 z-[9999] flex select-none flex-col overflow-hidden rounded-2xl border border-white/10 text-white shadow-[0_8px_40px_rgba(0,0,0,0.45)]"
      style={{
        width,
        transform: shown ? 'translateX(0)' : `translateX(${width + 24}px)`,
        // Same curve as the page-margin transition so panel + page move as one.
        transition: `transform ${ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        visibility: panelState === 'closed' ? 'hidden' : 'visible',
        pointerEvents: panelState === 'open' ? 'auto' : 'none',
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === 'transform' && e.target === e.currentTarget) onAnimationEnd();
      }}
    >
      {/* Glass base + blurred album-art ambience */}
      <div className="al-glass absolute inset-0" />
      {thumbUrl && (
        <img
          src={thumbUrl}
          alt=""
          aria-hidden
          className="al-art-bg pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[rgba(20,20,25,0.15)] via-[rgba(20,20,25,0.4)] to-[rgba(20,20,25,0.8)]" />

      {/* Resize handle */}
      <div
        onMouseDown={() => setDragging(true)}
        title="Drag to resize"
        className="absolute bottom-0 left-0 top-0 z-30 w-1.5 cursor-ew-resize transition-colors hover:bg-white/20"
      />

      {/* ---- Header (never clipped, spec §3) ---- */}
      <div className="relative z-20 px-6 pb-4 pt-6">
        <div className="flex items-start gap-4">
          {thumbUrl && (
            <img src={thumbUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-lg" />
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="line-clamp-2 text-[17px] font-bold leading-tight">{title}</p>
            <p className="mt-1 truncate text-[13px] font-medium text-white/60">{artist}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            <button
              onClick={() => setShowSettings((v) => !v)}
              title="Settings"
              className={
                'rounded-full p-2 transition-all duration-200 hover:bg-white/10 active:scale-90 ' +
                (showSettings ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white')
              }
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
            <button
              onClick={onCollapse}
              title="Collapse (Alt+L)"
              className="rounded-full p-2 text-white/45 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-90"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Sync status + provider — quiet, informational */}
        <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-white/50">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: sync.dot }} />
          <span>{sync.text}</span>
          {lyrics && (
            <>
              <span className="text-white/25">·</span>
              <span className="text-white/40">{PROVIDER_LABELS[lyrics.provider] ?? lyrics.provider}</span>
            </>
          )}
        </div>

        {/* Settings popover — soft fade+scale, never pops (spec §6) */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="al-glass absolute right-4 top-[4.5rem] z-30 rounded-xl border border-white/10 p-3 shadow-2xl"
            >
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40">Script</p>
              <div className="flex gap-1 rounded-full bg-white/10 p-1">
                {MODE_OPTIONS.map(({ mode, label, title: t }) => (
                  <button
                    key={mode}
                    title={t}
                    onClick={() => {
                      onDisplayModeChange(mode);
                      setShowSettings(false);
                    }}
                    className={
                      'rounded-full px-3.5 py-1 text-xs transition-all duration-200 ' +
                      (displayMode === mode
                        ? 'bg-white/90 font-bold text-neutral-900'
                        : 'font-semibold text-white/60 hover:text-white')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---- Lyrics stage (crossfades between songs/states, spec §4) ---- */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stageKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: showingStale ? 0.35 : 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeInOut' }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {status === 'loading' && !showingStale && (
            <div className="relative z-10 flex flex-1 flex-col justify-center gap-8 px-6">
              {[85, 60, 75].map((w, i) => (
                <div
                  key={i}
                  className="al-shimmer rounded-lg"
                  style={{ width: `${w}%`, height: i === 1 ? 38 : 24 }}
                />
              ))}
            </div>
          )}

          {(status === 'not-found' || status === 'error') && (
            <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.06] text-[26px]">
                🎵
              </div>
              <p className="text-[17px] font-bold text-white/85">
                {status === 'not-found' ? 'Lyrics unavailable' : 'Something went wrong'}
              </p>
              <p className="max-w-[250px] text-[13px] leading-relaxed text-white/45">
                {status === 'not-found'
                  ? 'We couldn’t find synchronized lyrics for this video. Try another version of the song.'
                  : 'Something interrupted the lyric search. Try refreshing the page.'}
              </p>
            </div>
          )}

          {(status === 'ready' || showingStale) && lyrics?.syncedLyrics?.length ? (
            untimed ? (
              <StaticLyricsView lines={lyrics.syncedLyrics} romanized={romanized} displayMode={displayMode} />
            ) : (
              <SyncedLyricsView
                lines={lyrics.syncedLyrics}
                romanized={romanized}
                activeIndex={activeIndex}
                displayMode={displayMode}
              />
            )
          ) : null}

          {status === 'ready' && !lyrics?.syncedLyrics?.length && lyrics?.plainLyrics && (
            <StaticLyricsView
              lines={lyrics.plainLyrics.split('\n').filter(Boolean).map((text) => ({ text }))}
              romanized={lyrics.plainLyrics.split('\n').filter(Boolean).map((t) => romanizeLine(t))}
              displayMode={displayMode}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
