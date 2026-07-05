/** User settings, persisted via chrome.storage.sync. */

export type DisplayMode = 'original' | 'romanized' | 'both';
// Future: 'translated' (explicitly NOT the default — see PRD; romanization
// preserves meaning and lets people sing along).

export interface Settings {
  displayMode: DisplayMode;
  /** Panel width in px, user-resizable 300–500. */
  panelWidth: number;
  // NOTE: open/closed state is deliberately NOT persisted here. It is per-tab
  // session state owned by the panel state machine in App.tsx — persisting it
  // through storage.sync caused cross-tab toggling and stale-state races.
}

export const DEFAULT_SETTINGS: Settings = {
  displayMode: 'romanized',
  panelWidth: 360,
};

export const PANEL_MIN_WIDTH = 300;
export const PANEL_MAX_WIDTH = 500;

const STORAGE_KEY = 'adaptive-lyrics-settings';

// chrome.storage disappears when the extension context is invalidated (the
// extension was reloaded while a tab's old content script kept running). All
// accessors below degrade to defaults / no-ops instead of throwing.
function storageAvailable(): boolean {
  return !!chrome.runtime?.id && !!chrome.storage?.sync;
}

export async function loadSettings(): Promise<Settings> {
  if (!storageAvailable()) return DEFAULT_SETTINGS;
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  } catch {
    /* context invalidated mid-session — setting is lost, not fatal */
  }
}

/** Subscribe to settings changes (fires when another tab/popup updates them). */
export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  if (!storageAvailable()) return () => {};
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area === 'sync' && changes[STORAGE_KEY]) {
      callback({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEY].newValue as Partial<Settings>) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      /* context invalidated — nothing to clean up */
    }
  };
}
