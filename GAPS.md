# GAPS.md — honest audit of weaknesses

_Written 2026-07-06 after a full read of the codebase. Ordered by severity,
most important first. Each item: what it is, where it lives, why it matters,
and a fix scoped small enough to execute as a single task. Items marked
**(verify first)** are high-confidence code-reading findings that should be
reproduced manually before fixing._

---

## 1. Zero automated tests — the matching pipeline is entirely unverified by CI

**Severity: Critical (process) · Category: missing coverage**

- **What:** There is no test framework, no test files, no CI. `package.json`
  has no `test` script. Every regression documented in code comments (the
  "Bairan" wrong-match, the 5s-timeout kill, the notifications-dropdown title
  bug) was caught by hand.
- **Where:** Whole repo. The highest-value untested code is pure and
  dependency-free: `src/lib/normalize.ts` (title cleaning + query candidates),
  `src/lib/providers/guards.ts` (risky-match corroboration),
  `src/lib/lrc.ts`, `src/lib/similarity.ts`, `src/lib/romanize.ts`, and
  `applyTimingMode` in `src/lib/providers/index.ts`.
- **Why it matters:** Matching quality is the product. Any future edit to a
  `NOISE_PATTERNS` regex or a threshold can silently reintroduce a
  wrong-lyrics regression, and nothing will catch it. The inline comments
  already contain the test cases — they're just not executable.
- **Fix (single task):** Add `vitest` as a devDependency, a `"test": "vitest run"`
  script, and one spec file `src/lib/__tests__/pipeline.test.ts` covering:
  (a) `normalizeMeta`/`buildQueryCandidates` against ~10 real titles taken
  from the comments ("Kesariya (Official Video 4K)", "Matargashti - Tamasha",
  "LOW FADE KARAN AUJLA", slowed+reverb, live variants); (b) `parseLrc` with
  2- and 3-digit fractions and multi-timestamp lines; (c)
  `riskyMatchConfirmed` accept/reject cases from the guards.ts docstrings;
  (d) `romanizeLine` for one line each of Devanagari/Gurmukhi/mixed
  Hinglish/Korean. No network mocking needed for any of this.

## 2. Stale-response race: lyrics for the previous video can overwrite the current one

**Severity: High (correctness bug) · Category: fragile edge case**

- **What:** The fetch effect in `src/content/App.tsx` (~line 134) sends
  `FETCH_LYRICS` per video change, but the `sendMessage` callback never checks
  that the response belongs to the *current* video. Requests can take up to
  ~12s (the provider timeout). Navigate A→B: if B's (cached, fast) response
  lands first and A's slow response lands second, A's lyrics render while B
  plays. `setLyrics`/`setStatus` are called unconditionally.
- **Where:** `src/content/App.tsx`, the `useEffect` keyed on `[song?.videoId]`.
- **Why it matters:** It violates the project's #1 rule ("never show wrong
  lyrics") through pure UI plumbing, and the 12s timeout makes the race window
  wide enough to hit by skipping through a playlist.
- **Fix (single task):** Capture `const requestedId = song.videoId;` before
  `sendMessage`, and in the callback bail out unless the latest song still
  matches — e.g. keep a `useRef` updated with the current videoId and check
  `if (latestVideoId.current !== requestedId) return;` before any `set*` call.
  ~6 lines, one file.

## 3. Alt+L toggle almost certainly does not fire on macOS **(verify first)**

**Severity: High (advertised feature broken on the dev's own platform) · Category: bug**

- **What:** The keyboard handler checks `e.key.toLowerCase() === 'l'`
  (`src/content/App.tsx` ~line 213). On macOS, Option+L produces the composed
  character `¬` in `e.key` (Chrome reports the composed char for Option+letter),
  so the check never matches. `e.code === 'KeyL'` is layout- and
  composition-independent.
- **Where:** `src/content/App.tsx`, the Alt+L `useEffect`.
- **Why it matters:** Alt+L is advertised in the README, store listing, tooltip,
  and CHANGELOG. On macOS (this project's dev machine!) the panel would only
  toggle via toolbar/tab clicks.
- **Fix (single task):** Reproduce on macOS Chrome first (open a watch page,
  press Option+L). If confirmed, change the condition to
  `e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyL'`, and also ignore
  events whose target is an input/textarea/contenteditable (so Option+L typed
  in the YouTube search box doesn't toggle the panel). One file, ~5 lines.

## 4. Content bundle is 1.8MB, unminified, parsed on every YouTube page load

**Severity: High (performance) · Category: tech debt**

- **What:** `esbuild.config.mjs` never sets `minify: true`, so production
  builds — including the shipped `bol-1.0.0.zip` — carry a 1,790KB
  `content.js` (React + Framer Motion + sanscript + wanakana, with whitespace
  and comments). The content script matches `https://www.youtube.com/*`, so
  this parses on home, search, shorts — every YouTube page, panel open or not.
- **Where:** `esbuild.config.mjs`; manifest `content_scripts.matches` in
  `public/manifest.json`.
- **Why it matters:** Wasted parse/memory cost for all users on all YouTube
  pages; also store-review optics. (Matching all pages is *deliberate* — the
  SPA needs the script pre-loaded — but shipping it unminified is not.)
- **Fix (single task):** In `esbuild.config.mjs` add `minify: !watch` and
  `sourcemap: watch ? 'inline' : false` (or keep external maps but exclude
  them from the zip). Rebuild, verify panel still works, re-zip. Expect
  roughly 3–4× size reduction. Do not attempt lazy-loading in the same task.

## 5. NetEase can accept a wrong song for single-word titles (containment loophole)

**Severity: Medium-high (product quality) · Category: fragile edge case**

- **What:** `tokenContainment()` in `src/lib/providers/netease.ts` returns 0.85
  when *all* query tokens appear in the candidate text. For a one-word clean
  title (common: "Kesariya", "Bairan"), any song whose combined name/artist/
  album *contains* that word scores 0.85 ≥ ACCEPT_SCORE 0.55 and is accepted,
  unless duration actively contradicts (−0.4 only when the diff ≥ 2× tolerance,
  and 0 when either duration is unknown). LRCLIB solved this exact failure
  ("Bairan" → "Dheere Bol Bairan Payaliya") by raising its floor; NetEase's
  acceptance path can still fall into it. The `canonicalEligible()` check
  already guards against this (`diceOnly >= 0.5`) — but only for canonical
  identifications, not for direct acceptance.
- **Where:** `src/lib/providers/netease.ts` — the `scored[0].score < ACCEPT_SCORE`
  check (~line 146).
- **Why it matters:** NetEase runs exactly when LRCLIB misses — i.e. on the
  hard cases where a confident-looking wrong answer is most likely. "Wrong
  lyrics are worse than no lyrics" is the product's stated core rule.
- **Fix (single task):** At the acceptance point, require corroboration for
  containment-carried scores the same way canonical does: reject when
  `top.diceOnly < 0.5 && !(duration exists and agrees within tolerance)` —
  i.e. containment alone may only accept when duration positively confirms.
  Keep the existing behavior when `diceOnly >= 0.5`. One conditional + a log
  line, one file. Add the "Bairan" case to the test file from gap #1.

## 6. Video duration is captured once and may be missing forever for that video

**Severity: Medium · Category: fragile edge case**

- **What:** `useVideoMeta` reads `document.querySelector('video')?.duration` at
  the moment oEmbed resolves (`src/content/hooks/useVideoMeta.ts` ~line 49).
  Right after a SPA navigation the element often hasn't loaded metadata yet
  (`duration` = NaN), so `durationSec` becomes `undefined` and is never
  re-read (`resolvedVideoId` guard stops further attempts).
- **Where:** `src/content/hooks/useVideoMeta.ts` (`readVideoDuration`,
  `resolve`).
- **Why it matters:** Without duration, `durationScoreModifier` returns 0 and
  every risky candidate is rejected with "no duration available" — the
  matcher's strongest corroboration signal silently disappears, degrading
  exactly the tricky matches. Slowed/sped-up rescaling also can't run.
- **Fix (single task):** After resolving metadata without a duration, keep
  polling only for the duration (e.g. in the existing 800ms `detect` loop:
  if `meta` is set for this videoId but `durationSec` is undefined, re-read
  and `setMeta({...meta, durationSec})` once available, still guarded by
  videoId). One file; make sure the update keeps the same object identity for
  `videoId` so the fetch effect (keyed on videoId) doesn't refire — it won't,
  since the effect key is `song?.videoId`. **Note:** the background must then
  not have already cached a result for this video; simplest is to accept that
  the *next* session gets the better match, or skip cache when the original
  request lacked duration. Keep the scope to the hook + one cache-condition
  tweak in `background.ts`.

## 7. Four design docs describe an unbuilt product (docs actively mislead)

**Severity: Medium · Category: half-finished work / inconsistency**

- **What:** `PRD.md`, `ARCHITECTURE.md`, `DATA_FLOW.md`, `EXTENSION_SPEC.md`
  are pre-implementation artifacts: they specify an "Adaptive Sync Engine"
  with AI drift correction (steps 5–7 of DATA_FLOW — none of it exists; sync
  is a binary search over provider timestamps), karaoke mode, themes, a
  different `LyricsProvider` interface, and permissions (`activeTab`,
  `scripting`) the manifest doesn't request.
- **Where:** the four files at repo root.
- **Why it matters:** A new contributor (or model) reading "the architecture
  doc" will design against a fictional system — e.g. try to plug into the
  nonexistent sync engine or copy the wrong interface signature.
- **Fix (single task):** Add a one-line banner at the top of each of the four
  files: `> ⚠️ Historical design doc (pre-1.0). Describes planned features —
  not the shipped implementation. See PROJECT.md for reality.` Do not rewrite
  them; they document intent.

## 8. No typecheck or lint wired into any workflow

**Severity: Medium · Category: tech debt**

- **What:** esbuild strips types without checking them; nothing runs `tsc`.
  There is no ESLint config at all, yet `src/content/components/LyricsPanel.tsx`
  line 79 carries an `// eslint-disable-line react-hooks/exhaustive-deps`
  comment — a vestige referencing a linter that isn't installed.
- **Where:** `package.json` scripts; missing eslint config; LyricsPanel.tsx.
- **Why it matters:** Type errors ship silently — `npm run build` succeeds on
  code `tsc` rejects. (Typecheck passes today; verified 2026-07-06.)
- **Fix (single task):** Add `"typecheck": "tsc --noEmit"` to scripts and
  prepend it to `build` (`npm run typecheck && …`). Optionally delete the
  stale eslint-disable comment. Installing/configuring ESLint itself can be a
  separate later task.

## 9. Identity split: package.json vs manifest disagree on name and version

**Severity: Medium-low · Category: inconsistency**

- **What:** `package.json` = `adaptive-lyrics-extension@0.1.0`;
  `public/manifest.json` = `Bol — Lyrics for YouTube` v`1.0.0`;
  `CHANGELOG.md` tracks 1.0.0. Internal identifiers (log prefix
  `[adaptive-lyrics]`, host id `adaptive-lyrics-host`, storage key
  `adaptive-lyrics-settings`) use the old codename.
- **Where:** `package.json` (name, version); identifiers across `src/`.
- **Why it matters:** Release confusion — bumping the manifest but not
  package.json (or vice versa) is guaranteed eventually. The *storage keys and
  host id must NOT be renamed* (renaming loses user settings and breaks
  orphan-host cleanup), which makes naive "consistency cleanup" dangerous.
- **Fix (single task):** Set package.json `name` to `bol-lyrics-for-youtube`
  and `version` to `1.0.0`, and add a comment-equivalent note in CLAUDE.md
  (done) that manifest version is the source of truth and storage keys are
  frozen. Touch nothing in `src/`.

## 10. Watch-page/fullscreen tracking depends solely on `yt-navigate-finish`

**Severity: Medium-low · Category: fragile edge case**

- **What:** `App.tsx` updates `onWatchPage` only from the YouTube-internal
  `yt-navigate-finish` event. Metadata detection has an 800ms URL poll as a
  backstop, but page-type tracking does not. If YouTube renames/removes the
  event, navigating watch→home leaves the panel (and the injected page margin)
  visible on the home page with stale lyrics.
- **Where:** `src/content/App.tsx` (environment-tracking effect);
  `src/content/content.tsx` also listens to the same event for late mounting.
- **Why it matters:** Silent breakage controlled entirely by YouTube; the
  failure looks like "panel stuck on home page", which users will blame on
  the extension.
- **Fix (single task):** In the existing 800ms poll inside `useVideoMeta` — or
  a tiny new interval in the environment effect — also compare
  `location.pathname` and call `setOnWatchPage` on change. ~5 lines.

## 11. Featured-artist splitter breaks on names containing the letter "x"

**Severity: Low · Category: fragile edge case**

- **What:** `FEAT_RE` handling splits the captured clause with
  `names.split(/\s*[,&x]\s*|\s+and\s+/i)` (`src/lib/normalize.ts` ~line 88).
  The bare `x` class member splits *inside* names: "feat. XXXTentacion" →
  `["Tentacion"]` (leading fragments emptied), "feat. Xander" → `["ander"]`.
  The intent was the "A x B" collab separator.
- **Where:** `src/lib/normalize.ts`.
- **Why it matters:** Produces a polluted `featured-artist + clean title`
  query candidate. Other candidates usually rescue the match, so impact is a
  weaker strategy, not a wrong match.
- **Fix (single task):** Change the separator to require standalone x:
  `/\s*,\s*|\s*&\s*|\s+x\s+|\s+and\s+/i`. Add one test case in the gap-#1 file.

## 12. Panel animation duration is duplicated in two files

**Severity: Low · Category: inconsistency**

- **What:** `PANEL_ANIM_MS = 280` in `src/content/App.tsx` (drives the
  fallback settle timer and dock-margin transition) and a separate
  `ANIM_MS = 280` in `src/content/components/LyricsPanel.tsx` (drives the
  actual transform transition). They must stay equal or the state machine's
  fallback timer and the real animation drift apart.
- **Fix (single task):** Export `PANEL_ANIM_MS` from `App.tsx` is already
  done — import it in `LyricsPanel.tsx`, delete the local `ANIM_MS`.

## 13. Plain-lyrics romanization recomputed on every render

**Severity: Low (performance) · Category: tech debt**

- **What:** The synced-lyrics path memoizes `romanizeLine` results
  (`useMemo([lyrics])`), but the plain-lyrics fallback branch calls
  `lyrics.plainLyrics.split('\n')…map(romanizeLine)` inline in JSX
  (`src/content/components/LyricsPanel.tsx` ~line 274). During a resize drag
  the panel re-renders per frame, re-romanizing every line each time
  (regex construction per line per script).
- **Fix (single task):** Lift both `split` results into the existing `useMemo`
  (or a second one keyed on `[lyrics]`). One file, ~8 lines.

## 14. oEmbed fetch has no timeout and stacks concurrent requests

**Severity: Low · Category: fragile edge case**

- **What:** `fetchOembedMeta` uses bare `fetch` with no AbortController; the
  800ms poll calls `resolve()` again while a previous oEmbed call is still in
  flight (the `resolvedVideoId` guard only dedupes after a resolution), so a
  slow oEmbed can pile up several identical requests. Harmless in practice
  (first resolution wins; later ones bail on the guard), but wasteful and
  unbounded.
- **Where:** `src/content/hooks/useVideoMeta.ts`.
- **Fix (single task):** Reuse `timedFetchJson` from `src/lib/providers/http.ts`
  with a ~4s timeout, and add an `inFlight` ref so `detect()` skips while a
  resolution attempt for the same videoId is pending.

## 15. No LRCLIB rate-limit/backoff handling

**Severity: Low · Category: missing robustness**

- **What:** Each video fires ~8 LRCLIB queries at once (plus canonical
  re-queries); HTTP 429/5xx is logged (`http-error`) and treated as a miss.
  No retry, no backoff, no request coalescing. A rate-limited user gets
  "Lyrics unavailable" with no distinct messaging, and (correctly) no cache
  entry — so it retries on every navigation.
- **Where:** `src/lib/providers/http.ts` / `lrclib.ts`.
- **Fix (single task):** In `timedFetchJson`, retry once after 1–2s on 429/503
  only. Keep it minimal; do not add a queueing layer.

## 16. Node toolchain is implicit (not on PATH, no engines pin)

**Severity: Low (DX) · Category: tech debt**

- **What:** Node v24.18.0 is manually installed at `~/.local/node/bin` and not
  on this machine's default PATH; `package.json` has no `engines` field and
  there's no `.nvmrc`. A fresh session's `npm run build` fails with
  "command not found" until PATH is exported.
- **Fix (single task):** Add `"engines": { "node": ">=20" }` to package.json
  and a `.nvmrc` with `24`. (PATH note is documented in CLAUDE.md.)

## 17. Release packaging is manual and can drift from source

**Severity: Low · Category: half-finished work

- **What:** `bol-1.0.0.zip` sits in the repo root (gitignored) with no script
  that produces it — it was zipped by hand from `dist/` (correctly excluding
  sourcemaps). Nothing guarantees a future zip matches a fresh build or
  excludes the `.map` files again.
- **Fix (single task):** Add
  `"package": "npm run build && cd dist && zip -r ../bol-$npm_package_version.zip . -x '*.map'"`
  to package.json scripts. (After gap #9's version sync, the filename becomes
  meaningful.)

## 18. LRC `[offset:…]` tags are silently ignored

**Severity: Info · Category: known limitation**

- **What:** `parseLrc` (`src/lib/lrc.ts`) only reads `[mm:ss.xx]` line stamps;
  an `[offset:+500]` header (global shift, part of the LRC convention) is
  skipped as a metadata line, so such files sync ~half a second off.
  Rare in LRCLIB data.
- **Fix (single task):** Parse an optional offset header and add it to every
  timestamp. ~10 lines + one test.

---

## Security review

Overall posture is **good**: no secrets, no remote code, no analytics, no
`dangerouslySetInnerHTML` (all third-party strings render as React text
nodes, so lyric/title payloads can't inject markup), messaging is
same-extension only, host permissions are tightly scoped
(`lrclib.net`, `music.163.com`), and the privacy policy matches what the code
actually transmits (title/channel/duration only). Remaining notes:

- **S1 (Low): Unofficial NetEase endpoint.** `music.163.com/api/*` is
  reverse-engineered; it can change semantics or start requiring auth
  without any error signal. Availability risk, not confidentiality —
  responses are parsed as JSON and rendered as text. Mitigation: the
  documented manual test in `netease.ts`; nothing to fix in code.
- **S2 (Low): Third-party content is trusted for *correctness*.** A poisoned
  LRCLIB/NetEase entry can show wrong/offensive text as lyrics. No integrity
  checking is possible for community data; the scoring guards are the only
  defense. Accepted risk — document only.
- **S3 (Info): `web_accessible_resources` exposes `content.css`** to
  youtube.com pages — required for the shadow-root `<link>`; scoped to
  youtube.com matches. Fine as-is.
- **S4 (Info): No `minimum_chrome_version` in the manifest** while esbuild
  targets `chrome110` syntax — a very old Chrome could load the extension and
  fail at parse time. Fix bundled with gap #4 or separately: add
  `"minimum_chrome_version": "110"` to `public/manifest.json`.

## What was checked and found NOT to be a problem (don't re-flag these)

- The `while (prev !== title)` noise-strip loop terminates (replacements are
  strictly shrinking); YouTube titles are length-capped, so regex backtracking
  is bounded.
- `runRe.test()` + `.replace()` on the same `/g` regex in `romanize.ts` is
  safe (fresh regex per call; `Symbol.replace` resets `lastIndex`).
- Session cache stores post-`applyTimingMode` results keyed by videoId —
  scaled timestamps are correct on cache hits (same video ⇒ same ratio).
- Background `onMessage` without sender validation is fine — MV3 `onMessage`
  only receives from this extension's own contexts.
- `lyrics:` cache entries from older builds containing `null` are ignored by
  the `cached.result &&` check — intentional, documented.
- The two-phase (parallel fire, priority evaluate) provider search preserves
  sequential selection semantics — the structure looks redundant but is a
  deliberate latency optimization.
