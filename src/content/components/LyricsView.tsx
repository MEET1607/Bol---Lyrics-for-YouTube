import { AnimatePresence, motion } from 'framer-motion';
import type { SyncedLyricLine } from '../../lib/types';

/**
 * The lyric "stage": a windowed view of ~6 lines centered on the current one,
 * with a strict size/brightness hierarchy (spec §4–§7). This intentionally is
 * NOT a scrollable list — lines flow upward through fixed visual roles as
 * playback progresses, like a music app, not a document.
 */

// How many lines to render around the current one (5–7 visible per spec §5).
const BEFORE = 2;
const AFTER = 3;

interface LineStyle {
  fontSize: string;
  fontWeight: number;
  opacity: number;
  color: string;
}

/** Visual role by signed distance from the current line (spec §4 + §7). */
function styleFor(distance: number): LineStyle {
  if (distance === 0) return { fontSize: '42px', fontWeight: 700, opacity: 1, color: '#ffffff' };
  if (distance === 1) return { fontSize: '28px', fontWeight: 500, opacity: 0.6, color: '#ffffff' };
  if (distance === -1) return { fontSize: '25px', fontWeight: 500, opacity: 0.32, color: '#ffffff' };
  if (distance > 1) return { fontSize: '23px', fontWeight: 500, opacity: 0.35, color: '#ffffff' };
  return { fontSize: '22px', fontWeight: 500, opacity: 0.16, color: '#ffffff' };
}

interface Props {
  lines: SyncedLyricLine[];
  romanized: (string | null)[];
  activeIndex: number;
  displayMode: 'original' | 'romanized' | 'both';
}

function textFor(line: SyncedLyricLine, roman: string | null, mode: Props['displayMode']) {
  const primary = mode === 'romanized' && roman ? roman : line.text;
  const sub = mode === 'both' && roman ? roman : undefined;
  return { primary, sub };
}

export function SyncedLyricsView({ lines, romanized, activeIndex, displayMode }: Props) {
  // Before the first line starts, show the opening lines in "upcoming" style.
  const anchor = Math.max(0, activeIndex);
  const start = Math.max(0, anchor - BEFORE);
  const end = Math.min(lines.length - 1, anchor + AFTER);
  const visible = [];
  for (let i = start; i <= end; i++) visible.push(i);

  return (
    <div className="relative z-10 flex flex-1 flex-col justify-center gap-8 overflow-hidden px-6 py-4">
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((i) => {
          const distance = activeIndex < 0 ? i + 1 : i - activeIndex;
          const s = styleFor(distance);
          const { primary, sub } = textFor(lines[i], romanized[i], displayMode);
          return (
            <motion.div
              key={i}
              layout
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: s.opacity, y: 0, scale: distance === 0 ? 1 : 0.985 }}
              exit={{ opacity: 0, y: -28 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              style={{ transformOrigin: 'left center' }}
            >
              <p
                style={{
                  fontSize: s.fontSize,
                  fontWeight: s.fontWeight,
                  color: s.color,
                  lineHeight: 1.2,
                  letterSpacing: '-0.01em',
                  textShadow: distance === 0 ? '0 0 32px rgba(255,255,255,0.18)' : 'none',
                }}
              >
                {primary}
              </p>
              {sub && (
                <p
                  style={{
                    fontSize: distance === 0 ? '19px' : '14px',
                    fontWeight: 500,
                    color: 'rgba(255,255,255,0.65)',
                    marginTop: '6px',
                    lineHeight: 1.3,
                  }}
                >
                  {sub}
                </p>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Fallback for live/untimed songs: an evenly-lit, manually scrollable list —
 *  still music-app typography, just without the sync spotlight. */
export function StaticLyricsView({
  lines,
  romanized,
  displayMode,
}: {
  lines: { text: string }[];
  romanized: (string | null)[];
  displayMode: Props['displayMode'];
}) {
  return (
    <div className="al-scroll relative z-10 flex-1 space-y-7 overflow-y-auto px-6 py-8">
      {lines.map((line, i) => {
        const roman = romanized[i];
        const primary = displayMode === 'romanized' && roman ? roman : line.text;
        const sub = displayMode === 'both' && roman ? roman : undefined;
        return (
          <div key={i}>
            <p className="text-[22px] font-semibold leading-snug text-white/85">{primary}</p>
            {sub && <p className="mt-1 text-[14px] font-medium text-white/55">{sub}</p>}
          </div>
        );
      })}
    </div>
  );
}
