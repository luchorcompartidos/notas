// Firebase: inicio de sesión con Google y Firestore con caché persistente (funciona sin conexión).
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  terminate, clearIndexedDbPersistence,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

let app; let auth; let db;

export function fb() {
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return { app, auth, db };
}

export function watchAuth(cb) {
  return onAuthStateChanged(fb().auth, cb);
}

export function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(fb().auth, provider);
}

// Cierra sesión y borra la copia local de Firestore de este navegador.
export async function signOutUser() {
  const { auth: a, db: d } = fb();
  await signOut(a);
  try { await terminate(d); await clearIndexedDbPersistence(d); } catch { /* se limpia al recargar */ }
}

export function authErrorMessage(e) {
  const code = e?.code || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/popup-blocked') return 'El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio.';
  if (code === 'auth/unauthorized-domain') return 'Este dominio no está autorizado en Firebase (Authentication → Dominios autorizados).';
  if (code === 'auth/network-request-failed') return 'Sin conexión: no se pudo iniciar sesión.';
  return `No se pudo iniciar sesión (${code || 'error desconocido'}).`;
}
