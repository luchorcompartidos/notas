// Integración con Android. En la web todas estas funciones no hacen nada.
import { Capacitor, registerPlugin, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';

export const isNative = Capacitor.isNativePlatform();
const safe = (p) => { try { p?.catch?.(() => {}); } catch { /* nada */ } };

export function initNative({ onBack }) {
  document.documentElement.classList.toggle('native', isNative);
  setupKeyboardInsets();
  if (!isNative) return;
  App.addListener('backButton', () => onBack());
  safe(StatusBar.setOverlaysWebView({ overlay: false }));
  setTimeout(() => safe(SplashScreen.hide({ fadeOutDuration: 200 })), 50);
}

export function setStatusBar(hexColor, dark) {
  if (!isNative) return;
  safe(StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }));
  safe(StatusBar.setBackgroundColor({ color: hexColor }));
}

export function haptic() {
  if (isNative) safe(Haptics.impact({ style: ImpactStyle.Light }));
}

export function minimizeApp() {
  if (!isNative) return;
  App.minimizeApp().catch(() => App.exitApp());
}

/*
 * Teclado: la barra de formato tiene que quedar justo arriba del teclado.
 * --kb = cuánto tapa el teclado (0 si Android ya achicó la pantalla).
 */
function setupKeyboardInsets() {
  const root = document.documentElement;
  let baseHeight = window.innerHeight;
  let kbOpen = false;
  let lastKb = 0;

  const set = (px) => {
    const v = Math.max(0, Math.round(px));
    root.style.setProperty('--kb', `${v}px`);
    root.classList.toggle('kb-open', kbOpen || v > 0);
    window.dispatchEvent(new CustomEvent('kbchange', { detail: { open: kbOpen || v > 0 } }));
  };

  const viewportOverlap = () => {
    const vv = window.visualViewport;
    return vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  };

  window.addEventListener('resize', () => {
    if (!kbOpen) baseHeight = window.innerHeight;
    if (isNative && kbOpen) set(window.innerHeight < baseHeight - 80 ? 0 : lastKb);
  });

  if (!isNative) {
    // Web en el celular: el teclado achica solo la "vista visible".
    window.visualViewport?.addEventListener('resize', () => {
      const o = viewportOverlap();
      kbOpen = o > 80 || window.innerHeight < baseHeight - 80;
      set(o);
    });
    return;
  }

  const onShow = (info) => {
    kbOpen = true;
    lastKb = info?.keyboardHeight || 0;
    requestAnimationFrame(() => {
      const resized = window.innerHeight < baseHeight - 80;
      set(resized ? 0 : lastKb);
    });
  };
  const onHide = () => { kbOpen = false; set(0); };
  Keyboard.addListener('keyboardWillShow', onShow);
  Keyboard.addListener('keyboardDidShow', onShow);
  Keyboard.addListener('keyboardWillHide', onHide);
  Keyboard.addListener('keyboardDidHide', () => { onHide(); baseHeight = window.innerHeight; });
}

/* ---------- "Compartir con…", widget y accesos directos (plugin propio IntentBridge) ---------- */
const IntentBridge = registerPlugin('IntentBridge');

export function listenIntents(cb) {
  if (!isNative) {
    // Web instalada: accesos directos del manifiesto (?accion=nota|lista|buscar)
    const a = new URLSearchParams(location.search).get('accion');
    if (a) {
      history.replaceState(null, '', location.pathname + location.hash);
      cb({ kind: { nota: 'note', lista: 'list', buscar: 'search' }[a] || 'note' });
    }
    return;
  }
  IntentBridge.addListener('intentReceived', (data) => cb(data)).catch(() => {});
  IntentBridge.getPending().then((r) => { if (r && r.data) cb(r.data); }).catch(() => {});
}

// Descarga una página sin la restricción del navegador (solo en el APK)
export async function nativeGet(url) {
  if (!isNative) return null;
  const res = await CapacitorHttp.get({
    url, responseType: 'text', connectTimeout: 8000, readTimeout: 8000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', Accept: 'text/html' },
  });
  return typeof res.data === 'string' ? res.data : '';
}
