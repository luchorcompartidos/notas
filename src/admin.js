/*
 * Administración de usuarios (v0.4.0).
 * Firebase no deja listar usuarios desde la app (hace falta el SDK de administrador, en un servidor),
 * así que ANote arma su propio listado:
 *   directory/{uid} → ficha que escribe cada usuario al abrir ANote: nombre, correo, cómo entra,
 *                     último inicio de sesión, último uso, dónde (web/android) y versión.
 *   control/{uid}   → pedidos del administrador para ese usuario: `revokedAt` (cerrar la sesión en todos
 *                     sus dispositivos: se cierran las sesiones iniciadas antes de esa hora) y `ask`
 *                     ('suggest' | 'require': pasar a la contraseña propia de ANote).
 *   admins/{uid}    → quién es administrador. Se crea a mano en la consola de Firebase (las reglas no
 *                     dejan escribirlo desde la app).
 * El cierre de sesión lo hace la app al recibir el pedido (no es un bloqueo en el servidor): para
 * bloquear de verdad, inhabilitar la cuenta en la consola (Authentication → Usuarios).
 */
import {
  doc, collection, getDoc, getDocFromServer, getDocs, setDoc, writeBatch, onSnapshot, serverTimestamp, deleteField,
} from 'firebase/firestore';
import { fb, providerIds, hasPassword, hasGoogle, passwordVerified } from './firebase.js';

const db = () => fb().db;
const ADMIN_KEY = (uid) => `notas-admin-${uid}`;
const DIR_KEY = (uid) => `notas-dir-${uid}`;
const DIR_EVERY = 6 * 3600 * 1000; // la ficha se reescribe como mucho cada 6 horas (o si cambió algo)

export const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === 'number' ? t : 0);

// Hora del inicio de sesión de esta sesión (la del token: no cambia al renovarlo).
export async function sessionStart(user) {
  try { return Date.parse((await user.getIdTokenResult()).authTime) || 0; } catch { return 0; }
}

// ¿Es administrador? Se recuerda en el dispositivo para mostrar el menú sin conexión.
export function cachedAdmin(uid) { try { return localStorage.getItem(ADMIN_KEY(uid)) === '1'; } catch { return false; } }
export async function checkAdmin(uid) {
  let d;
  try { d = await getDocFromServer(doc(db(), 'admins', uid)); } catch {
    try { d = await getDoc(doc(db(), 'admins', uid)); } catch { return cachedAdmin(uid); }
  }
  const yes = d.exists();
  try { if (yes) localStorage.setItem(ADMIN_KEY(uid), '1'); else localStorage.removeItem(ADMIN_KEY(uid)); } catch { /* nada */ }
  return yes;
}

// Ficha del directorio: solo se escribe si cambió algo o pasaron 6 horas (para no gastar escrituras).
export async function touchDirectory(user, { name, platform, version, signedIn, force = false }) {
  if (!user) return;
  const data = {
    name: String(name || '').slice(0, 80),
    email: user.email || '',
    providers: providerIds(user).filter((p) => p === 'google.com' || p === 'password'),
    passwordOnly: hasPassword(user) && !hasGoogle(user),
    verified: hasGoogle(user) || passwordVerified(user),
    signedIn: signedIn || 0,
    created: Date.parse(user.metadata?.creationTime || '') || 0,
    platform, version,
  };
  const sig = JSON.stringify(data);
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(DIR_KEY(user.uid)) || 'null'); } catch { /* nada */ }
  if (!force && prev && prev.sig === sig && Date.now() - prev.at < DIR_EVERY) return;
  try {
    await setDoc(doc(db(), 'directory', user.uid), { ...data, lastSeen: serverTimestamp() });
    localStorage.setItem(DIR_KEY(user.uid), JSON.stringify({ sig, at: Date.now() }));
  } catch (e) { console.warn('Directorio de usuarios', e); }
}

// Pedidos del administrador para este usuario. cb(data | null, fromServer)
export function watchControl(uid, cb) {
  return onSnapshot(doc(db(), 'control', uid), { includeMetadataChanges: true },
    (snap) => cb(snap.exists() ? snap.data() : null, !snap.metadata.fromCache),
    (err) => console.warn('Pedidos del administrador', err));
}

// Listado para el administrador: fichas del directorio con sus pedidos.
export async function listUsers() {
  const [dir, ctl] = await Promise.all([getDocs(collection(db(), 'directory')), getDocs(collection(db(), 'control'))]);
  const control = new Map(ctl.docs.map((d) => [d.id, d.data()]));
  const users = dir.docs.map((d) => ({ uid: d.id, ...d.data(), control: control.get(d.id) || null }));
  // Pedidos de usuarios que se quitaron del listado: se muestran igual (para poder quitarlos)
  control.forEach((c, uid) => { if (!users.some((u) => u.uid === uid)) users.push({ uid, name: '', email: '', removed: true, control: c }); });
  return users;
}

// Aplica un pedido a varios usuarios de una vez (lotes de hasta 400).
// what: 'revoke' | 'suggest' | 'require' | 'clearAsk' | 'remove'
export async function applyAdmin(uids, what, by) {
  for (let i = 0; i < uids.length; i += 400) {
    const batch = writeBatch(db());
    uids.slice(i, i + 400).forEach((uid) => {
      if (what === 'remove') { batch.delete(doc(db(), 'directory', uid)); return; }
      const ref = doc(db(), 'control', uid);
      const base = { by, at: serverTimestamp() };
      if (what === 'revoke') batch.set(ref, { ...base, revokedAt: serverTimestamp() }, { merge: true });
      else if (what === 'suggest' || what === 'require') batch.set(ref, { ...base, ask: what }, { merge: true });
      else if (what === 'clearAsk') batch.set(ref, { ...base, ask: deleteField() }, { merge: true });
    });
    await batch.commit();
  }
}
