# Chrome Extension Specification (Manifest V3)

## Stack
- Manifest V3
- React (UI)
- TypeScript
- Tailwind CSS
- Framer Motion

---

## Components

### 1. Background Service Worker
- Manages caching
- Handles API calls
- Stores lyrics database

---

### 2. Content Script
Injected into YouTube:
- Reads DOM
- Detects video changes
- Sends metadata to service worker

---

### 3. Sidebar UI (React App)
- Displays lyrics
- Handles animations
- Sync highlighting

---

## Permissions

- activeTab
- storage
- scripting
- host_permissions: youtube.com

---

## API Layer

### LRCLIB
GET:
```
https://lrclib.net/api/get?artist=...&track=...
```

---

## State Model

```ts
type AppState = {
  song: SongMetadata
  lyrics: Lyrics
  syncOffset: number
  provider: "lrclib" | "fallback"
}
```
