# Product Requirements Document — Adaptive Lyrics YouTube Extension

## Problem

YouTube captions are inaccurate or missing for Indian, Punjabi, and multilingual music. Users cannot reliably follow lyrics while watching music videos.

Existing lyric apps:
- Genius → accurate but not synced
- YouTube captions → often incorrect timing
- Spotify → only works inside Spotify ecosystem

## Solution

A Chrome extension that:
- Detects the currently playing YouTube song
- Fetches lyrics from LRCLIB and fallback sources
- Displays clean, aesthetic lyrics in a side panel
- Provides real-time adaptive synchronization using AI correction

## Core Value Proposition

"Accurate, beautifully presented, and dynamically synced lyrics for any YouTube song."

## Key Features

### 1. Song Detection
- Extract title + artist from YouTube DOM
- Clean metadata (remove "official video", "4K", etc.)

### 2. Lyrics Retrieval
Priority order:
1. LRCLIB (primary, synced lyrics)
2. Secondary lyrics APIs (future plug-in system)
3. Cached user/community data

### 3. UI/UX
- Spotify-style lyric highlighting
- Smooth scroll animations
- Dark/light themes
- Karaoke mode
- Translation + romanization (future)

### 4. Adaptive Sync Engine
- Uses LRCLIB timestamps as baseline
- Continuously corrects timing drift using audio alignment
- Applies smooth, non-disruptive updates

## Non-Goals (v1)
- No video downloading
- No full YouTube replacement
- No manual lyric editing UI (later phase)

## Success Criteria
- Lyrics appear within 1–2 seconds of video load
- Sync error < 500ms perceived drift
- Works for Hindi, Punjabi, English songs reliably
