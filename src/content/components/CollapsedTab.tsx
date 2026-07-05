interface Props {
  onExpand: () => void;
}

/** Thin vertical "LYRICS" tab docked to the right edge (collapsed state). */
export function CollapsedTab({ onExpand }: Props) {
  return (
    <button
      onClick={onExpand}
      title="Open lyrics panel (Alt+L)"
      className="al-glass al-font al-tab-in fixed right-0 top-1/2 z-[9999] flex -translate-y-1/2 cursor-pointer flex-col items-center gap-3 rounded-l-2xl border border-r-0 border-white/10 px-2.5 py-4 text-white/70 shadow-2xl transition-all duration-200 hover:bg-white/5 hover:pr-3.5 hover:text-white"
    >
      <span className="text-base leading-none">♪</span>
      <span className="flex flex-col items-center gap-1 text-[10px] font-semibold tracking-widest">
        {['L', 'Y', 'R', 'I', 'C', 'S'].map((ch, i) => (
          <span key={i} className="leading-none">
            {ch}
          </span>
        ))}
      </span>
      <span className="text-xs leading-none text-white/50">‹</span>
    </button>
  );
}
