import { createRoot } from 'react-dom/client';
import { App } from './App';
import { dlog } from '../lib/debug';

const HOST_ID = 'adaptive-lyrics-host';

// The app mounts exactly ONCE per content-script instance and stays mounted
// for the lifetime of the tab. Visibility across SPA navigations, fullscreen,
// and open/close is all handled INSIDE React — never by remounting. (An
// earlier version remounted on every yt-navigate-finish, which destroyed
// panel state and caused flicker on each video change.)
let mounted = false;

function mountApp() {
  // A leftover host means an ORPHANED copy of this script (extension was
  // reloaded while the tab stayed open). Its React root is dead — replace it
  // rather than skipping, or the new script would never render anything.
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('content.css');
  shadow.appendChild(styleLink);

  const mountPoint = document.createElement('div');
  mountPoint.id = 'adaptive-lyrics-root';
  shadow.appendChild(mountPoint);

  createRoot(mountPoint).render(<App />);
}

function init() {
  // chrome.runtime.id disappears when the extension context is invalidated
  // (extension reloaded/updated while this tab was open). This copy of the
  // script can no longer talk to the background worker — do nothing; the
  // freshly injected script owns the page now.
  if (!chrome.runtime?.id) return;
  if (mounted) return;
  mountApp();
  mounted = true;
  dlog('[adaptive-lyrics][panel] host mounted (once per tab)');
}

init();
// Covers the case where the first injection happened before the SPA was ready.
window.addEventListener('yt-navigate-finish', init);
