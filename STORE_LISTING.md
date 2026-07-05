# Chrome Web Store — paste-ready copy for Bol

## Store listing tab

**Title** (auto-filled from manifest): Bol — Lyrics for YouTube

**Summary** (auto-filled from manifest):
Accurate, beautifully synced lyrics for YouTube music — with romanization for Hindi, Punjabi, Tamil and more.

**Description:**

Bol shows accurate, synced lyrics beside any YouTube music video — like a premium
music app, right on YouTube.

♪ Line-by-line synced lyrics, highlighted as the song plays
♪ Built for Indian music: Hindi, Punjabi, Tamil, Telugu, Bengali and more
♪ Automatic romanization — sing along even if you can't read the script
   (switch between Original / Romanized / Both)
♪ Smart matching that handles messy video titles, slowed + reverb edits,
   sped-up versions, and live performances
♪ A clean, distraction-free panel that never covers the video or the controls
♪ Collapses to a slim tab when you don't need it — your layout, remembered

No account. No tracking. Lyrics come from community databases (LRCLIB and others),
and your preferences stay in your own browser.

Tip: press Alt+L to show or hide the panel anytime.

**Category:** Entertainment
**Language:** English

## Privacy practices tab

**Single purpose description:**
Bol displays synced song lyrics in a side panel while the user watches music
videos on YouTube.

**Permission justifications:**

- `storage` — Saves the user's display preferences (panel width, collapsed
  state, script display mode) and caches lyrics for the current browser session.
- Host permission `https://lrclib.net/*` — Fetches song lyrics and timestamps
  from the LRCLIB public lyrics database.
- Host permission `https://music.163.com/*` — Fallback lyrics source when
  LRCLIB has no entry for a song.
- Content script on `https://www.youtube.com/*` — Reads the current video's
  title, channel, and playback time to identify the song and keep the lyrics
  in sync; renders the lyrics panel on the page.

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in
the extension package; the network is used only to fetch lyrics data as JSON.)

**Data usage disclosures:** check ONLY "Website content" (the video's
title/channel is sent to the lyrics APIs to identify the song). Then certify:
- Data is not sold to third parties
- Data is not used or transferred for purposes unrelated to the item's core functionality
- Data is not used or transferred to determine creditworthiness or for lending

**Privacy policy URL:** host PRIVACY.md publicly (see below) and paste its URL.
