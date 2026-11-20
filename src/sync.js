/*
 * Sincronización de una nota con fusión de cambios (Yjs).
 *
 * - Cada nota es un documento Yjs: el título (Y.Text 'title') y el contenido (fragmento 'default').
 * - Copia local en IndexedDB (y-indexeddb): se puede editar sin conexión.
 * - En Firestore, cada tanda de cambios es un documento en notes/{id}/updates con los bytes de Yjs.
 *   Yjs fusiona los cambios sin importar el orden en que lleguen ni desde qué dispositivo.
 * - Al conectarse, se sube lo que el servidor no tenga (por si algo quedó sin subir).
 * - Cuando hay muchos documentos de cambios, se compactan en uno solo.
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { collection, onSnapshot, addDoc, writeBatch, doc, Bytes, serverTimestamp } from 'firebase/firestore';

const REMOTE = Symbol('remote');
// Errores pasajeros (red, servidor ocupado): se reintenta solo
export const TRANSIENT = ['unavailable', 'deadline-exceeded', 'internal', 'resource-exhausted', 'aborted', 'cancelled', 'unknown'];

/* ---------- Notas con cambios de este dispositivo que todavía no llegaron al servidor ---------- */
const pendKey = (uid) => `notas-pendientes-${uid}`;
export function pendingList(uid) {
  try { return JSON.parse(localStorage.getItem(pendKey(uid))) || []; } catch { return []; }
}
function setPending(uid, id, on) {
  if (!uid) return;
  const set = new Set(pendingList(uid));
  if (on === set.has(id)) return;
  if (on) set.add(id); else set.delete(id);
  localStorage.setItem(pendKey(uid), JSON.stringify([...set]));
  window.dispatchEvent(new CustomEvent('pendingchange'));
}
export const lastVerified = (id) => Number(localStorage.getItem(`notas-verif-${id}`) || 0);
const COMPACT_AFTER = 40;           // documentos de cambios antes de compactar
const MAX_DOC_BYTES = 900 * 1024;   // Firestore admite hasta 1 MiB por documento

export class NoteSession {
  constructor(noteId, { db = null, uid = null, onStatus = () => {} } = {}) {
    this.id = noteId;
    this.db = db;
    this.uid = uid;
    this.onStatus = onStatus;
    this.ydoc = new Y.Doc();
    this.titleText = this.ydoc.getText('title');
    this.fragment = this.ydoc.getXmlFragment('default');
    this.queue = [];
    this.pending = 0;
    this.seen = new Set();
    this.error = null;
    this.closed = false;
    this.verified = false;   // ya recibió la versión del servidor en esta apertura
    this.fromCache = true;   // lo último que se ve viene de la copia local (sin conexión con el servidor)
    this.lastServerAt = lastVerified(noteId);
    this.idb = new IndexeddbPersistence(`notas-${uid || 'local'}-${noteId}`, this.ydoc);
    this._onUpdate = (update, origin) => {
      if (!this.db || origin === REMOTE || origin === this.idb) return;
      this.queue.push(update);
      setPending(this.uid, this.id, true); // marcado al instante: si la app se cierra, se sube al volver
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 700);
      this.emit();
    };
    this.ydoc.on('update', this._onUpdate);
  }

  get isEmpty() {
    return this.fragment.length === 0 && this.titleText.length === 0;
  }

  async ready() {
    await this.idb.whenSynced;
    if (!this.db) return;
    this.remoteDoc = new Y.Doc();
    await new Promise((resolve) => {
      this._resolveFirst = resolve;
      setTimeout(resolve, 3000); // sin conexión ni caché: no bloquear la apertura
      this.listen(0);
    });
  }

  listen(attempt) {
    if (this.closed) return;
    const col = collection(this.db, 'notes', this.id, 'updates');
    this.unsub?.();
    this.unsub = onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
      this.error = null;
      attempt = 0;
      this.fromCache = snap.metadata.fromCache;
      if (!snap.metadata.fromCache) {
        this.verified = true;
        this.lastServerAt = Date.now();
        localStorage.setItem(`notas-verif-${this.id}`, String(this.lastServerAt));
      }
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') { this.seen.delete(ch.doc.id); return; }
        if (this.seen.has(ch.doc.id)) return;
        this.seen.add(ch.doc.id);
        const bytes = ch.doc.data().u;
        if (!bytes) return;
        const u = bytes.toUint8Array();
        Y.applyUpdate(this.remoteDoc, u);
        Y.applyUpdate(this.ydoc, u, REMOTE);
      });
      this._resolveFirst?.();
      if (!snap.metadata.fromCache && !this.reconciled) {
        this.reconciled = true;
        this.reconcile();
        this.maybeCompact();
      }
      this.emit();
    }, (err) => {
      // Una nota recién creada puede no existir todavía en el servidor: reintentar.
      this._resolveFirst?.();
      this.fromCache = true;
      if (err?.code === 'permission-denied' && attempt < 6) {
        setTimeout(() => this.listen(attempt + 1), 1500);
        return;
      }
      this.error = err;
      this.emit();
      if (err?.code === 'permission-denied' || err?.code === 'not-found') {
        setPending(this.uid, this.id, false); // sin acceso a la nota: no queda nada por subir
        return;
      }
      // Error pasajero: reintento automático cada vez más espaciado (2 s … 30 s)
      if (TRANSIENT.includes(err?.code)) this.retryTimer = setTimeout(() => this.listen(attempt + 1), Math.min(30000, 2000 * 2 ** attempt));
    });
  }

  // Volver a pedir la versión del servidor ahora (sincronización manual)
  retry() {
    if (!this.db || this.closed) return;
    clearTimeout(this.retryTimer);
    this.error = null;
    this.flush();
    this.listen(0);
    this.emit();
  }

  // Espera a que esté verificada con el servidor y sin cambios pendientes (o hasta el tiempo límite)
  settled(timeout = 15000) {
    const t0 = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const ok = this.verified && !this.pending && !this.queue.length;
        if (ok || this.error?.code === 'permission-denied' || Date.now() - t0 > timeout) resolve(ok);
        else setTimeout(check, 300);
      };
      check();
    });
  }

  // Sube todo lo que tenemos localmente y el servidor todavía no.
  reconcile() {
    const diff = Y.encodeStateAsUpdate(this.ydoc, Y.encodeStateVector(this.remoteDoc));
    if (diff.length > 2) { this.queue.push(diff); this.flush(); } else if (!this.pending && !this.queue.length) setPending(this.uid, this.id, false);
  }

  flush() {
    clearTimeout(this.timer);
    if (!this.db || !this.queue.length) return;
    const merged = Y.mergeUpdates(this.queue);
    this.queue = [];
    this.pending++;
    this.emit();
    addDoc(collection(this.db, 'notes', this.id, 'updates'), {
      u: Bytes.fromUint8Array(merged),
      by: this.uid,
      at: serverTimestamp(),
    }).then(() => {
      this.pending--;
      if (!this.pending && !this.queue.length) setPending(this.uid, this.id, false);
      this.emit();
    }).catch((e) => {
      this.pending--; this.error = e; this.emit();
      // Lo local queda en IndexedDB: se vuelve a subir en la próxima apertura (reconcile).
    });
  }

  async maybeCompact() {
    if (this.seen.size < COMPACT_AFTER || !navigator.onLine) return;
    const state = Y.encodeStateAsUpdate(this.remoteDoc);
    if (state.length > MAX_DOC_BYTES) return; // nota muy pesada (imágenes): se deja sin compactar
    const col = collection(this.db, 'notes', this.id, 'updates');
    const ids = [...this.seen].slice(0, 450);
    const batch = writeBatch(this.db);
    batch.set(doc(col), { u: Bytes.fromUint8Array(state), by: this.uid, at: serverTimestamp(), compact: true });
    ids.forEach((id) => batch.delete(doc(col, id)));
    try { await batch.commit(); } catch (e) { console.warn('No se pudo compactar', e); }
  }

  // Estado completo de la nota (para el historial de versiones)
  snapshot() { return Y.encodeStateAsUpdate(this.ydoc); }

  emit() {
    this.onStatus({
      pending: this.pending + (this.queue.length ? 1 : 0), error: this.error,
      verified: this.verified, fromCache: this.fromCache, lastServerAt: this.lastServerAt,
    });
  }

  destroy() {
    this.flush();
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.unsub?.();
    this.ydoc.off('update', this._onUpdate);
    try { this.idb.destroy(); } catch { /* nada */ }
    setTimeout(() => this.ydoc.destroy(), 0);
  }
}

// Aplica al Y.Text solo la parte que cambió (así dos dispositivos pueden editar el título a la vez).
export function applyTextDiff(ytext, value) {
  const old = ytext.toString();
  if (old === value) return;
  let s = 0;
  while (s < old.length && s < value.length && old[s] === value[s]) s++;
  let e = 0;
  while (e < old.length - s && e < value.length - s && old[old.length - 1 - e] === value[value.length - 1 - e]) e++;
  ytext.doc.transact(() => {
    const del = old.length - s - e;
    if (del > 0) ytext.delete(s, del);
    const ins = value.slice(s, value.length - e);
    if (ins) ytext.insert(s, ins);
  });
}

// Sube los cambios pendientes de una nota sin abrirla en pantalla
export async function flushNote(db, uid, id, timeout = 15000) {
  const s = new NoteSession(id, { db, uid });
  try {
    await s.ready();
    const ok = await s.settled(timeout);
    if (ok) setPending(uid, id, false);
    return ok;
  } finally { s.destroy(); }
}
