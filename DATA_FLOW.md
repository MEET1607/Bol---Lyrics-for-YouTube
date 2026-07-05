# Data Flow — Lyrics Sync System

## Step 1: Video Detection

YouTube URL:
```
https://youtube.com/watch?v=XYZ
```

Extract:
- Title
- Artist guess
- Duration

---

## Step 2: Normalize Query

"Kesariya (Official Video 4K)"
→ "Kesariya Arijit Singh"

---

## Step 3: Fetch Lyrics

Try:
1. LRCLIB API
2. fallback provider
3. cache

Return:
- plainLyrics
- syncedLyrics (preferred)

---

## Step 4: Initial Rendering

Display lyrics immediately:
- No waiting for sync engine
- Use LRCLIB timestamps

---

## Step 5: Sync Engine Activation

While song plays:
- Capture playback time
- Optionally analyze audio stream
- Compare expected vs actual lyric occurrence

---

## Step 6: Drift Calculation

Example:
```
Expected: 00:15.0
Actual:   00:17.2

Drift = +2.2 sec
```

Apply correction curve:
- smooth interpolation
- avoid abrupt jumps

---

## Step 7: Continuous Refinement

Every few seconds:
- recompute drift
- update timeline mapping

Result:
→ progressively better sync over time
