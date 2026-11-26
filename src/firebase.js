// Firebase: inicio de sesión (Google o correo y contraseña propia de ANote) y Firestore con
// caché persistente (funciona sin conexión).
import { initializeApp } from 'firebase/app';
import {
  getAuth, initializeAuth, indexedDBLocalPersistence, GoogleAuthProvider, EmailAuthProvider,
  signInWithPopup, signInWithCredential, signOut, onAuthStateChanged, reauthenticateWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
  updateProfile, linkWithCredential, linkWithPopup, unlink, reauthenticateWithCredential, reload,
  verifyBeforeUpdateEmail, updatePassword,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  terminate, clearIndexedDbPersistence, doc, getDoc, getDocFromServer, setDoc, deleteDoc,
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
    auth.languageCode = 'es'; // correos de verificación y de recuperación en castellano
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return { app, auth, db };
}

export function watchAuth(cb) {
  return onAuthStateChanged(fb().auth, cb);
}

// Credencial de Google obtenida con el inicio de sesión nativo de Android (solo en el APK).
async function nativeGoogleCredential() {
  const { FirebaseAuthentication } = await nativeAuthModule();
  let res;
  try {
    // Método nuevo de Android (Credential Manager)
    res = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: true });
  } catch (e1) {
    // Si la persona canceló, no insistir.
    if (/cancel/i.test(String(e1?.message || '')) && !/no credential/i.test(String(e1?.message || ''))) throw e1;
    // Cualquier otro rechazo (p. ej. "No credentials available"): método clásico con selector de cuentas.
    console.warn('Credential Manager falló, se prueba el método clásico', e1);
    try {
      res = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
    } catch (e2) {
      e2.message = `${e2?.message || e2} (antes, método nuevo: ${e1?.message || e1})`;
      throw e2;
    }
  }
  const idToken = res?.credential?.idToken;
  if (!idToken) throw Object.assign(new Error('Google no devolvió el token'), { code: 'auth/no-id-token' });
  return GoogleAuthProvider.credential(idToken);
}

function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export async function signInGoogle() {
  if (native) return signInWithCredential(fb().auth, await nativeGoogleCredential());
  return signInWithPopup(fb().auth, googleProvider());
}

/* ---------- Correo y contraseña propia de ANote ---------- */
// Al tocar el link del correo, la página de Firebase ofrece "Continuar" y vuelve a ANote.
const ACTION_SETTINGS = { url: 'https://luchorcompartidos.github.io/notas/' };

// Si el dominio de regreso no está autorizado en Firebase, se manda el correo sin el botón "Continuar".
async function withAction(fn) {
  try { return await fn(ACTION_SETTINGS); } catch (e) {
    if (/unauthorized-continue-uri|invalid-continue-uri|missing-continue-uri/.test(e?.code || '')) return fn(undefined);
    throw e;
  }
}

const norm = (e) => String(e || '').trim().toLowerCase();

export function providerIds(user) { return (user?.providerData || []).map((p) => p.providerId); }
export function hasGoogle(user) { return providerIds(user).includes('google.com'); }
export function hasPassword(user) { return providerIds(user).includes('password'); }
// Correo con el que se entra con contraseña (puede ser distinto del Gmail mientras se pasa de uno a otro).
export function passwordEmail(user) { return norm((user?.providerData || []).find((p) => p.providerId === 'password')?.email); }
// El correo de la contraseña está verificado (el de la cuenta es ese y Firebase lo marca como verificado).
export function passwordVerified(user) {
  const pe = passwordEmail(user);
  return !!pe && norm(user?.email) === pe && !!user?.emailVerified;
}

export function signInEmail(email, password) {
  return signInWithEmailAndPassword(fb().auth, norm(email), password);
}

export async function signUpEmail(name, email, password) {
  const cred = await createUserWithEmailAndPassword(fb().auth, norm(email), password);
  try { await updateProfile(cred.user, { displayName: name }); } catch (e) { console.warn('Nombre visible', e); }
  try { await sendVerification(cred.user); } catch (e) { console.warn('Correo de verificación', e); }
  return cred;
}

export function sendVerification(user = fb().auth.currentUser) {
  return withAction((s) => sendEmailVerification(user, s));
}

export function resetPassword(email) {
  return withAction((s) => sendPasswordResetEmail(fb().auth, norm(email), s));
}

export async function setDisplayName(name) {
  const user = fb().auth.currentUser;
  await updateProfile(user, { displayName: name });
}

// Vuelve a leer la cuenta del servidor y renueva el token (para que las reglas vean el correo verificado).
export async function refreshUser() {
  const user = fb().auth.currentUser;
  if (!user) return null;
  await reload(user);
  await user.getIdToken(true);
  return fb().auth.currentUser;
}

// Pasar una cuenta de Google a contraseña propia, paso 1: se agrega correo y contraseña a la MISMA cuenta
// (mismo uid: conserva notas, compartidas y ajustes) y se manda el correo de verificación.
export async function linkPassword(email, password) {
  const user = fb().auth.currentUser;
  const e = norm(email);
  await linkWithCredential(user, EmailAuthProvider.credential(e, password));
  await reload(user);
  const u = fb().auth.currentUser;
  // Firebase cambia el correo de la cuenta al nuevo; si no lo hiciera, se pide cambiarlo con verificación.
  if (norm(u.email) !== e) await withAction((s) => verifyBeforeUpdateEmail(u, e, s));
  else if (!u.emailVerified) await sendVerification(u);
  return u;
}

// Deshacer el paso 1 (si todavía no se desvinculó Google).
export async function unlinkPassword() {
  const user = fb().auth.currentUser;
  await unlink(user, 'password');
  await refreshUser();
}

async function reauthPassword(password) {
  const user = fb().auth.currentUser;
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(passwordEmail(user) || norm(user.email), password));
  await user.getIdToken(true);
  return user;
}

// Cambiar la contraseña de ANote desde la app: se confirma la actual (reautenticar) y se pone la nueva.
// Firebase renueva la sesión de este dispositivo y cierra las de los otros (al renovar su token, hasta 1 hora).
export async function changePassword(current, next) {
  const user = await reauthPassword(current);
  await updatePassword(user, next);
  await user.getIdToken(true);
  return fb().auth.currentUser;
}

const securityRef = (uid) => doc(fb().db, 'security', uid);

// Paso 2: con el correo ya verificado, se confirma la contraseña, se marca la cuenta como "solo contraseña"
// (las reglas rechazan desde entonces cualquier sesión de Google que quede abierta) y se desvincula Google.
export async function finishPasswordOnly(password) {
  const user = await reauthPassword(password);
  await setDoc(securityRef(user.uid), { passwordOnly: true, at: Date.now() });
  if (hasGoogle(user)) await unlink(user, 'google.com');
  await refreshUser();
  try { localStorage.setItem('notas-password-only', passwordEmail(user)); } catch { /* nada */ }
}

// Volver atrás: se vincula de nuevo una cuenta de Google (primero, para que la ventana de Google salga
// enseguida del toque), se confirma la contraseña y se quita la marca.
export async function relinkGoogle(password) {
  const user = fb().auth.currentUser;
  if (!hasGoogle(user)) {
    if (native) await linkWithCredential(user, await nativeGoogleCredential());
    else await linkWithPopup(user, googleProvider());
  }
  await reauthPassword(password);
  await deleteDoc(securityRef(user.uid));
  await refreshUser();
  try { localStorage.removeItem('notas-password-only'); } catch { /* nada */ }
}

// ¿Esta sesión es de Google en una cuenta que pasó a contraseña propia? (por ejemplo, otro dispositivo
// que tenía la sesión abierta). En ese caso las reglas ya rechazan todo: se cierra la sesión.
export async function googleSessionBlocked() {
  const user = fb().auth.currentUser;
  if (!user) return false;
  try {
    const t = await user.getIdTokenResult();
    if (t.signInProvider !== 'google.com') return false;
    let d;
    try { d = await getDocFromServer(securityRef(user.uid)); } catch { d = await getDoc(securityRef(user.uid)); }
    return !!d.data()?.passwordOnly;
  } catch { return false; }
}

// Contraseña fuerte: 10 caracteres o más, con letras y números, distinta del correo.
export function passwordProblem(password, email = '') {
  const p = String(password || '');
  if (p.length < 10) return 'La contraseña tiene que tener 10 caracteres o más.';
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(p) || !/\d/.test(p)) return 'La contraseña tiene que tener letras y números.';
  if (email && p.toLowerCase().includes(norm(email).split('@')[0])) return 'La contraseña no puede contener tu correo.';
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(p)) return 'La contraseña es muy fácil de adivinar.';
  return null;
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
  if (code === 'permission-denied') return 'El servidor rechazó el cambio. ¿Están publicadas en Firebase las reglas nuevas (Firestore Database → Reglas)?';
  if (native && !code.startsWith('auth/')) {
    if (/cancel/i.test(msg) || /12501/.test(msg)) return 'Se canceló el inicio de sesión con Google.';
    return `No se pudo iniciar sesión con Google: ${msg || 'error desconocido'}`;
  }
  if (code === 'auth/no-id-token') return 'Google no devolvió los datos de la cuenta. Probá de nuevo.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
  if (code === 'auth/popup-blocked') return 'El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio.';
  if (code === 'auth/unauthorized-domain') return 'Este dominio no está autorizado en Firebase (Authentication → Dominios autorizados).';
  if (code === 'auth/network-request-failed') return 'Sin conexión: no se pudo iniciar sesión.';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) {
    return 'Correo o contraseña incorrectos. Si tu cuenta es de Google, usá «Continuar con Google».';
  }
  if (code === 'auth/invalid-email') return 'El correo no es válido.';
  if (code === 'auth/missing-password') return 'Falta la contraseña.';
  if (code === 'auth/email-already-in-use') return 'Ya hay una cuenta de ANote con ese correo. Si es tuya, entrá con ella (con Google o con contraseña) o usá «Olvidé mi contraseña».';
  if (code === 'auth/weak-password') return 'La contraseña es muy débil.';
  if (code === 'auth/too-many-requests') return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
  if (code === 'auth/operation-not-allowed') return 'El inicio con correo no está habilitado en Firebase (Authentication → Método de acceso).';
  if (code === 'auth/user-disabled') return 'Esta cuenta está desactivada.';
  if (code === 'auth/requires-recent-login') return 'Por seguridad, cerrá sesión, volvé a entrar y repetí el cambio.';
  if (code === 'auth/credential-already-in-use') return 'Esa cuenta de Google ya se usa en otra cuenta de ANote.';
  if (code === 'auth/account-exists-with-different-credential') return 'Ese correo ya tiene una cuenta de ANote con contraseña: entrá con «Entrar con correo».';
  if (code === 'auth/provider-already-linked') return 'Esa forma de entrar ya está vinculada a tu cuenta.';
  if (code === 'auth/no-such-provider') return 'Esa forma de entrar ya no estaba vinculada.';
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

// Confirmar identidad (respaldo para abrir notas bloqueadas en la web sin huella): con Google, o con la
// contraseña propia si la cuenta es de contraseña. askPassword() devuelve la contraseña o null.
// confirmGoogle() pregunta antes de abrir Google (devuelve true para seguir).
export async function reauthUser({ askPassword, confirmGoogle }) {
  const user = fb().auth.currentUser;
  if (!user) return false;
  try {
    const t = await user.getIdTokenResult();
    if (t.signInProvider === 'password' || !hasGoogle(user)) {
      const p = await askPassword();
      if (!p) return false;
      await reauthPassword(p);
      return true;
    }
    if (confirmGoogle && !(await confirmGoogle())) return false;
    if (native) await reauthenticateWithCredential(user, await nativeGoogleCredential());
    else await reauthenticateWithPopup(user, new GoogleAuthProvider());
    return true;
  } catch { return false; }
}
