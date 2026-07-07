# PROJECT.md — Bol, explained for someone who has never seen it

_Written 2026-07-06 as a deep knowledge-transfer document. If code and this file
disagree, trust the code and fix this file._

## What this is

**Bol** ("बोल" — "lyrics/words" in Hindi) is a Chrome extension (Manifest V3) that
shows line-by-line synced lyrics in a glassmorphic side panel next to any YouTube
music video, the way Spotify or Apple Music do. It exists because YouTube's
captions for Indian music (Hindi, Punjabi, Tamil, Telugu, Bengali, …) are often
mistranscribed or badly timed, while accurate community-synced lyrics already
exist in public databases. Its second headline feature is **automatic
romanization**: non-Latin scripts are transliterated to casual Latin
("Hinglish"-style) so users can sing along without reading the script.

The audience is anyone who listens to music on YouTube, with Indian-language
listeners as the explicit priority. There is no account, no backend, no
analytics — the extension talks only to two public lyrics APIs.

It shipped as **v1.0.0 to the Chrome Web Store** (see `bol-1.0.0.zip`,
`STORE_LISTING.md`, `PRIVACY.md`). The repo is `MEET1607/Bol---Lyrics-for-YouTube`
on GitHub, MIT licensed, single developer (Meet Chauhan).

## Tech stack and why

| Piece | Why it's here |
|---|---|
| **Manifest V3 extension** | Required for new Chrome Web Store submissions. Background logic runs in a service worker (ephemeral — hence the session-storage cache). |
| **TypeScript (strict)** | Whole codebase; `tsc --noEmit` is the typecheck (esbuild does not typecheck). |
| **esbuild** | Bundles two entry points (`background`, `content`) in ~100ms. Chosen for speed and its `define` mechanism (`__DEV__` flag). No webpack/vite complexity. |
| **React 18** | The panel UI, rendered into a **shadow root** so YouTube's CSS can't leak in and ours can't leak out. |
| **Tailwind CSS 3** | Panel styling, compiled by the standalone Tailwind CLI into `dist/content.css`, loaded as a `<link>` inside the shadow root (not injected via manifest `css` — that wouldn't reach the shadow DOM). |
| **Framer Motion** | Line-to-line lyric animations and the settings popover (`AnimatePresence`, `layout` animations). The heaviest dependency in the bundle. |
| **@indic-transliteration/sanscript** | Indic script → IAST transliteration (7 scripts). The core of romanization. |
| **wanakana** | Japanese kana → romaji. Korean romanization is hand-rolled (~20 lines, syllable decomposition). |
| **sharp** (dev only) | `scripts/make-icons.mjs` generates the four store icons from `icons/logo-bird.png`. |

There is deliberately **no state library, no router, no test framework, no
linter config** (the last two are gaps — see GAPS.md).

## Architecture

Two JavaScript contexts, talking over `chrome.runtime` messages:

```
┌────────────────────────── YouTube tab ──────────────────────────┐
│  content.js  (runs on all of https://www.youtube.com/*)         │
│                                                                 │
│  content.tsx ── mounts ONCE per tab ── shadow root ── <App/>    │
│      │                                                          │
│      ├─ useVideoMeta()   watches ?v= param (800ms poll +        │
│      │     yt-navigate-finish); resolves title/channel via      │
│      │     YouTube oEmbed (primary) or scoped DOM selectors     │
│      │     (fallback, all in lib/domSelectors.ts); reads        │
│      │     <video>.duration                                     │
│      │                                                          │
│      ├─ sends FETCH_LYRICS ──────────────┐                      │
│      │                                   ▼                      │
│      │                    ┌──── background.js (service worker) ─┤
│      │                    │  cache check (chrome.storage.session│
│      │                    │  keyed lyrics:<videoId>)            │
│      │                    │        │ miss                       │
│      │                    │        ▼                            │
│      │                    │  findLyrics() — provider chain      │
│      │                    │   ├─ lrclib (priority 1)            │
│      │                    │   ├─ netease (priority 2, fallback) │
│      │                    │   ├─ both run CONCURRENTLY          │
│      │                    │   ├─ canonical re-query if one      │
│      │                    │   │  provider IDs the song but has  │
│      │                    │   │  no lyrics                      │
│      │                    │   └─ applyTimingMode (exact/scaled/ │
│      │                    │      untimed)                       │
│      │                    └──── response ──► setLyrics          │
│      │                                                          │
│      ├─ useLyricsSync()  rAF loop, binary-searches current line │
│      │     from <video>.currentTime                             │
│      ├─ useSettings()    chrome.storage.sync (displayMode,      │
│      │     panelWidth)                                          │
│      └─ render: <CollapsedTab/> (closed) or <LyricsPanel/>      │
│            └─ <SyncedLyricsView/> 6-line "stage" around the     │
│               active line, romanizeLine() per line (memoized)   │
│                                                                 │
│  applyDockMargin(): injects a <style> into the PAGE head that   │
│  gives ytd-app a margin-right so the panel DOCKS instead of     │
│  overlapping the video                                          │
└─────────────────────────────────────────────────────────────────┘
         │                              │
         ▼ (network, from SW)           ▼ (network, from content script)
  lrclib.net/api/search          youtube.com/oembed (same-origin)
  music.163.com/api/… (unofficial)
```

### File map (src/, ~2,100 lines TS/TSX + 100 CSS)

- `background/background.ts` — message listener, session cache, toolbar-click → `TOGGLE_PANEL` relay.
- `content/content.tsx` — shadow-root mounting, mount-once + orphan-replacement logic.
- `content/App.tsx` — the brain of the UI: panel state machine (`closed→opening→open→closing`), lyrics fetch effect, Alt+L / toolbar toggle wiring, page-margin docking, fullscreen/watch-page tracking.
- `content/components/LyricsPanel.tsx` — panel chrome: header, sync-status pill, settings popover, resize drag, crossfade stage.
- `content/components/LyricsView.tsx` — `SyncedLyricsView` (windowed 6-line stage, size/brightness hierarchy by distance from active line) and `StaticLyricsView` (untimed/plain lyrics).
- `content/components/CollapsedTab.tsx` — thin vertical "LYRICS" tab when closed.
- `content/hooks/` — `useVideoMeta` (detection), `useLyricsSync` (rAF + binary search), `useSettings`.
- `lib/normalize.ts` — **the matching brain**: noise-pattern stripping, `feat.` extraction, dash-split, channel-in-title removal, `buildQueryCandidates()` (the ordered strategy list), `getTitleModifiers()` (slowed/live detection).
- `lib/providers/index.ts` — orchestrator: concurrent provider run, priority selection, canonical resolution, timing-mode post-processing.
- `lib/providers/lrclib.ts` — primary provider + `searchLrclibByCanonical()`.
- `lib/providers/netease.ts` — fallback provider (unofficial API), token-containment scoring, canonical identification capture.
- `lib/providers/guards.ts` — shared validation: duration tolerance/scoring, risky-fragment corroboration.
- `lib/providers/http.ts` — `timedFetchJson` with 12s abort timeout and typed outcomes.
- `lib/similarity.ts` — bigram Dice coefficient (transliteration-tolerant fuzzy match).
- `lib/lrc.ts` — LRC format parser.
- `lib/romanize.ts` — per-script transliteration (7 Indic ranges + Korean RR + kana).
- `lib/domSelectors.ts` — ALL YouTube DOM knowledge lives here, scoped to the watch-page container.
- `lib/settings.ts`, `lib/debug.ts`, `lib/types.ts` — storage, `__DEV__`-gated logging, shared types.

## The lyrics-matching pipeline (the part that matters most)

This is the product. Everything else is presentation.

1. **Detect** — `useVideoMeta` gets `videoId` from the URL, then title+channel
   from YouTube's oEmbed endpoint (exact, layout-proof) with scoped DOM
   selectors as fallback, plus `<video>.duration`.
2. **Normalize** — `normalizeMeta()` strips decoration noise ("(Official
   Video)", "| New Punjabi Song 2026", "4K", slowed/reverb markers…), extracts
   featured artists, splits "Artist - Track", removes the channel name embedded
   in the title.
3. **Candidates** — `buildQueryCandidates()` emits an **ordered** strategy list:
   dash-split both ways, bare dash fragments (marked `risky`), channel-as-artist,
   featured-artist, track-only, free-text. Risky = a bare fragment that can
   exact-match a wrong song.
4. **Search** — both providers fire **all** their strategy queries in parallel
   (phase 1), then evaluate results **in priority order** (phase 2), so an early
   confident hit returns without waiting for slower queries. Selection semantics
   are identical to a sequential walk — this two-phase structure is intentional
   and load-bearing for latency.
5. **Score & guard** — Dice similarity + synced-lyrics bonus + duration
   modifier. Risky candidates additionally need `riskyMatchConfirmed()`:
   fragment corroboration (the other dash side must appear in the result's
   track/artist/album) AND duration agreement. **Wrong lyrics are treated as
   strictly worse than no lyrics** — thresholds (`ACCEPT_SCORE` 0.55,
   `FLOOR_SCORE` 0.5) encode real regressions, documented inline.
6. **Canonical resolution** — if NetEase identified the song (confidence ≥ 0.8
   + duration agreement) but has no usable LRC, its canonical track/artist
   re-queries LRCLIB. Solves "YouTube title ≠ catalog title".
7. **Timing mode** — `applyTimingMode()`: live → `untimed` (static list);
   slowed/sped-up → `scaled` (every timestamp × videoDuration/trackDuration,
   sanity band 0.55–1.6); else `exact`.
8. **Render** — `useLyricsSync` binary-searches the active line each animation
   frame; `SyncedLyricsView` shows a ~6-line stage; `romanizeLine()` output is
   memoized per lyrics object.

## Key design decisions (and the reasoning, where evident)

- **Never show wrong lyrics.** The single most important product rule. It's why
  risky candidates exist, why `FLOOR_SCORE` was raised from 0.3 → 0.5 (the
  "Bairan" regression, documented in `lrclib.ts`), why duration corroboration
  exists, and why the canonical path re-verifies instead of trusting the other
  provider.
- **Mount once, never remount.** The React app mounts one time per tab
  (`content.tsx`); SPA navigation, fullscreen, open/close are all handled inside
  React as state. An earlier version remounted per navigation and flickered.
  The panel DOM is permanently mounted; visibility is pure
  `translateX`/`visibility`/`pointer-events` driven by an explicit state machine
  in `App.tsx` (`closed→opening→open→closing`, with a fallback timer so a missed
  `transitionend` can't wedge it).
- **Opening is user-initiated only.** No auto-open on song detection. Video
  changes swap content but never touch panel visibility. Open/closed state is
  deliberately NOT persisted (per-tab session state; persisting it caused
  cross-tab toggle races — see comment in `lib/settings.ts`).
- **Docking, not overlaying.** The panel reserves page space by injecting a
  `<style>` (`ytd-app { margin-right: … !important }`) with the same 280ms
  easing as the panel slide, so page and panel move as one. This is the
  most YouTube-markup-dependent trick in the codebase after `domSelectors.ts`.
- **oEmbed over DOM scraping.** v0.1 scraped `#title` and once picked up the
  notifications dropdown (YouTube reuses element ids). oEmbed returns exact
  metadata regardless of layout; DOM selectors remain as scoped fallback and
  every one of them lives in `domSelectors.ts` — the only file allowed to know
  YouTube markup.
- **Session cache, positive results only.** `chrome.storage.session` survives
  service-worker restarts, dies with the browser. Nulls are never cached: a
  null may mean "providers timed out", and caching it once locked findable
  songs into "Lyrics unavailable" for a whole session (documented regression).
- **12-second request timeout.** Was 5s; measured LRCLIB latency under the
  extension's ~8-parallel-request load is 5–10s (Chrome queues past 6
  connections/host and queue time counts against the timeout). Do not lower
  without re-measuring (`lib/providers/http.ts`).
- **Pluggable providers.** `LyricsProvider` interface + `PROVIDERS` array.
  Adding a provider = one new file + one registry line + a manifest
  `host_permissions` entry.
- **Romanization ≠ translation**, and it's the *default* display mode. Casual
  digraphs (`ś→sh`, `c→ch`), word-final schwa deletion for Hindi/Punjabi/
  Bengali, diacritics stripped. Mixed-script lines only transliterate the
  non-Latin runs, so embedded English words are never mangled.
- **Dev-gated logging with an intentional exception.** `dlog()` (content-side
  lifecycle logs) is compiled out of production via esbuild `define: __DEV__`.
  Provider-pipeline logs in the background worker use bare `console.info` **on
  purpose** — they are the product's only diagnostics ("inspect via
  chrome://extensions → service worker") since there's no telemetry.

## Critical paths — what's load-bearing vs. safe to touch

**Load-bearing (change with care, test manually on real videos):**
- `lib/normalize.ts` — every regex encodes a real-world YouTube title pattern.
  Matching quality lives or dies here.
- `lib/providers/*` — thresholds, guard logic, the two-phase parallel/priority
  structure, the `lv=-1` NetEase parameter (undocumented; `lv=1` returns empty
  for many songs), the 12s timeout.
- `App.tsx` panel state machine + `applyDockMargin` — subtle races were
  already fought and won here; the comments are the spec.
- `content.tsx` mount-once/orphan-replacement logic — orphaned content scripts
  after extension reload are real and handled.
- `lib/domSelectors.ts` — the scoping discipline is the fix for a real bug.
- Storage keys (`adaptive-lyrics-settings`, `lyrics:<videoId>`) and the
  `adaptive-lyrics-host` element id — renaming loses user settings / breaks
  orphan cleanup.

**Safe to change casually:**
- Visual styling in `LyricsPanel.tsx` / `LyricsView.tsx` / `styles.css`
  (typography, colors, animation timings).
- `CollapsedTab.tsx`.
- Log message wording.
- `scripts/make-icons.mjs` (rerun to regenerate `public/icons/`).
- Docs.

## Surprises and non-obvious things

1. **Four of the six markdown docs describe a product that was never built.**
   `PRD.md`, `ARCHITECTURE.md`, `DATA_FLOW.md`, `EXTENSION_SPEC.md` are
   pre-implementation design docs: they promise an "AI adaptive sync engine"
   with drift correction (doesn't exist — sync is plain timestamp lookup),
   karaoke mode, themes, and list permissions (`activeTab`, `scripting`) the
   manifest doesn't request. **README.md and CHANGELOG.md are accurate; the
   other four are historical.**
2. **The internal name is `adaptive-lyrics`, the product name is Bol.**
   package.json says `adaptive-lyrics-extension@0.1.0`; the manifest says
   `Bol 1.0.0`. Log prefixes, DOM ids, and storage keys all use
   `adaptive-lyrics`. This is legacy, not an error — and the storage keys must
   stay.
3. **`dist/content.js` is ~1.8MB and unminified**, and the content script runs
   on *every* youtube.com page (home, search, shorts), not just watch pages —
   necessary because YouTube is a SPA and the script must already be there when
   the user navigates to a video. The shipped zip carries the unminified bundle
   (no `minify: true` in esbuild config). See GAPS.md #4.
4. **Tailwind CSS reaches the shadow DOM via a `<link>` tag** to
   `chrome.runtime.getURL('content.css')` — that's why `content.css` is in
   `web_accessible_resources` and why manifest-injected CSS isn't used.
5. **`yt-navigate-finish`** is a YouTube-internal event the extension relies on
   for SPA navigation awareness (metadata detection also has an 800ms poll as
   backstop; watch-page/fullscreen tracking does not).
6. **NetEase is an unofficial API** that may die silently: the failure mode is
   "provider returns no LRC for everything" with no error. The `lv=-1` lesson
   is documented in `netease.ts`.
7. **Node is not on PATH on this machine** — it lives at `~/.local/node/bin`
   (v24.18.0, manually installed). Every npm/npx command needs
   `export PATH="$HOME/.local/node/bin:$PATH"` first.
8. **There are zero automated tests** — everything above was verified by hand
   against real videos (the code comments name the actual test songs). The
   matching pipeline is pure functions and very testable; it just never
   happened. See GAPS.md #1.
