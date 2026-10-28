import './styles.css';
import { App } from './app.ts';
import { useWasmEngine } from './wasm/worker-connection.ts';

const app = new App(document.getElementById('app')!);
app.start();
// Exposed for debugging in the browser console (read-only state mirror)
(window as unknown as { thang: App }).thang = app;

// Saves live in IndexedDB: ask the browser not to evict them under storage
// pressure (granted quietly for installed or often-used sites)
if (useWasmEngine()) void navigator.storage?.persist?.().catch(() => {});

// Offline play once installed (public/sw.js): only the browser build as the
// top-level page; not in itch.io's frame, the dev server or a native shell
const nativeShell = 'Capacitor' in window;
if (import.meta.env.PROD && useWasmEngine() && window.top === window && !nativeShell && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
}
