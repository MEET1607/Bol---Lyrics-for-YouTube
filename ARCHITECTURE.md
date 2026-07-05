# System Architecture — Adaptive Lyrics Extension

## High-Level Design

```
YouTube Page
    ↓
Content Script (Chrome Extension)
    ↓
Song Detection Engine
    ↓
Lyrics Provider Layer
    ↓
Sync Engine (AI Alignment)
    ↓
UI Renderer (React Sidebar)
```

---

## Modules

### 1. Content Script
- Runs on YouTube
- Extracts:
  - Video title
  - Channel metadata
  - Playback state

---

### 2. Song Detection Engine
Input: raw YouTube title
Output:
- artist
- song name
- confidence score

Uses:
- regex cleaning
- optional AI fallback (future)

---

### 3. Lyrics Provider Layer (PLUGGABLE)

Interface:
```ts
interface LyricsProvider {
  search(song, artist): Promise<LyricsResult>
}
```
