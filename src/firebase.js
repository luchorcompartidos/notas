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
const nativeAuth = () => import('@capacitor-firebase/authentication').then((m) => m.FirebaseAuthentication);

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
    const FirebaseAuthentication = await nativeAuth();
    const res = await FirebaseAuthentication.signInWithGoogle();
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
  if (native) { try { await (await nativeAuth()).signOut(); } catch { /* nada */ } }
  try { await terminate(d); await clearIndexedDbPersistence(d); } catch { /* se limpia al recargar */ }
}

export function authErrorMessage(e) {
  const code = e?.code || '';
  const msg = String(e?.message || '');
  if (/cancel/i.test(msg) || /12501/.test(msg)) return null; // la persona cerró la ventana de Google
  if (native && !code.startsWith('auth/')) return `No se pudo iniciar sesión con Google: ${msg || 'error desconocido'}`;
  if (code === 'auth/no-id-token') return 'Google no devolvió los datos de la cuenta. Probá de nuevo.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/popup-blocked') return 'El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio.';
  if (code === 'auth/unauthorized-domain') return 'Este dominio no está autorizado en Firebase (Authentication → Dominios autorizados).';
  if (code === 'auth/network-request-failed') return 'Sin conexión: no se pudo iniciar sesión.';
  return `No se pudo iniciar sesión (${code || 'error desconocido'}).`;
}
