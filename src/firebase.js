// Firebase: inicio de sesión con Google y Firestore con caché persistente (funciona sin conexión).
import { initializeApp } from 'firebase/app';
import {
  getAuth, initializeAuth, indexedDBLocalPersistence, GoogleAuthProvider,
  signInWithPopup, signInWithCredential, signOut, onAuthStateChanged,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  terminate, clearIndexedDbPersistence,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

let app; let auth; let db;
const native = Capacitor.isNativePlatform();

// En el APK, Google bloquea iniciar sesión dentro del WebView: se usa el inicio de sesión
// nativo de Android (plugin) y el token resultante se pasa al SDK web de Firebase.
// Importante: un plugin de Capacitor nunca se devuelve dentro de una promesa (se toma como
// "thenable" y la llamada queda colgada). Se devuelve el módulo y se usa el plugin desde ahí.
const nativeAuthModule = () => import('@capacitor-firebase/authentication');

export function fb() {
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = native ? initializeAuth(app, { persistence: indexedDBLocalPersistence }) : getAuth(app);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return { app, auth, db };
}

export function watchAuth(cb) {
  return onAuthStateChanged(fb().auth, cb);
}

export async function signInGoogle() {
  if (native) {
    const { FirebaseAuthentication } = await nativeAuthModule();
    let res;
    const t0 = Date.now();
    try {
      // Método nuevo de Android (Credential Manager)
      res = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: true });
    } catch (e) {
      // Si falló enseguida, sin llegar a mostrar la ventana: probar el método clásico de Google.
      if (Date.now() - t0 > 2500) throw e;
      console.warn('Credential Manager falló, se prueba el método clásico', e);
      res = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
    }
    const idToken = res?.credential?.idToken;
    if (!idToken) throw Object.assign(new Error('Google no devolvió el token'), { code: 'auth/no-id-token' });
    return signInWithCredential(fb().auth, GoogleAuthProvider.credential(idToken));
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(fb().auth, provider);
}

// Cierra sesión y borra la copia local de Firestore de este navegador.
export async function signOutUser() {
  const { auth: a, db: d } = fb();
  await signOut(a);
  if (native) {
    try { const { FirebaseAuthentication } = await nativeAuthModule(); await FirebaseAuthentication.signOut(); } catch { /* nada */ }
  }
  try { await terminate(d); await clearIndexedDbPersistence(d); } catch { /* se limpia al recargar */ }
}

export function authErrorMessage(e) {
  const code = e?.code || '';
  const msg = String(e?.message || '');
  if (native && !code.startsWith('auth/')) {
    if (/cancel/i.test(msg) || /12501/.test(msg)) return 'Se canceló el inicio de sesión con Google.';
    return `No se pudo iniciar sesión con Google: ${msg || 'error desconocido'}`;
  }
  if (code === 'auth/no-id-token') return 'Google no devolvió los datos de la cuenta. Probá de nuevo.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/popup-blocked') return 'El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio.';
  if (code === 'auth/unauthorized-domain') return 'Este dominio no está autorizado en Firebase (Authentication → Dominios autorizados).';
  if (code === 'auth/network-request-failed') return 'Sin conexión: no se pudo iniciar sesión.';
  return `No se pudo iniciar sesión (${code || 'error desconocido'}).`;
}

// Texto completo del error, para diagnosticar.
export function errorDetail(e) {
  const parts = [];
  if (e?.code) parts.push(`Código: ${e.code}`);
  if (e?.message) parts.push(`Mensaje: ${e.message}`);
  if (e?.data) { try { parts.push(`Datos: ${JSON.stringify(e.data)}`); } catch { /* nada */ } }
  return parts.join('\n') || String(e);
}
