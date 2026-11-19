/*
 * Repositorio de notas.
 * CloudRepo (con cuenta): Firestore.
 *   notes/{id}            → resumen compartido: dueño, miembros, título, vista previa, casillas, miniatura
 *   notes/{id}/updates/*  → cambios de Yjs (contenido de la nota)
 *   users/{uid}/meta/{id} → organización personal de cada usuario: color, fijada, papelera
 * LocalRepo (sin cuenta): todo en este dispositivo (IndexedDB).
 */
import {
  collection, doc, query, where, onSnapshot, setDoc, updateDoc, getDocs, writeBatch,
} from 'firebase/firestore';
import { NoteSession } from './sync.js';
import { store, newId } from './store.js';

const emptySummary = () => ({ title: '', preview: '', checks: { done: 0, total: 0 }, thumb: null });

export class CloudRepo {
  constructor(db, uid) {
    this.db = db;
    this.uid = uid;
    this.notes = new Map();
    this.meta = new Map();
    this.pending = 0;
    this.serverLoaded = false;
    this.error = null;
    this.onChange = () => {};
  }

  subscribe(cb) {
    const emit = () => cb(this.list());
    const q = query(collection(this.db, 'notes'), where('memberIds', 'array-contains', this.uid));
    this.unsubNotes = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      this.notes = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      if (!snap.metadata.fromCache) this.serverLoaded = true;
      this.error = null;
      emit(); this.onChange();
    }, (err) => { this.error = err; this.onChange(); });
    this.unsubMeta = onSnapshot(collection(this.db, 'users', this.uid, 'meta'), (snap) => {
      this.meta = new Map(snap.docs.map((d) => [d.id, d.data()]));
      emit();
    }, (err) => { this.error = err; this.onChange(); });
  }

  list() {
    return [...this.notes.values()].map((n) => ({
      color: 'default', pinned: false, trashed: false, ...n, ...(this.meta.get(n.id) || {}),
    }));
  }

  track(promise) {
    this.pending++; this.onChange();
    return promise.catch((e) => { this.error = e; console.warn(e); })
      .finally(() => { this.pending--; this.onChange(); });
  }

  create(extra = {}) {
    const ref = doc(collection(this.db, 'notes'));
    const now = Date.now();
    this.track(setDoc(ref, {
      owner: this.uid, memberIds: [this.uid], ...emptySummary(), created: now, updated: now, ...extra,
    }));
    return ref.id;
  }

  saveSummary(id, summary) {
    this.track(updateDoc(doc(this.db, 'notes', id), summary));
  }

  setMeta(id, patch) {
    this.track(setDoc(doc(this.db, 'users', this.uid, 'meta', id), patch, { merge: true }));
  }

  async removeCompletely(id) {
    try {
      const col = collection(this.db, 'notes', id, 'updates');
      const snap = await getDocs(col);
      const batch = writeBatch(this.db);
      snap.docs.slice(0, 450).forEach((d) => batch.delete(d.ref));
      batch.delete(doc(this.db, 'users', this.uid, 'meta', id));
      batch.delete(doc(this.db, 'notes', id));
      await this.track(batch.commit());
    } catch (e) { console.warn('No se pudo borrar la nota vacía', e); }
  }

  session(id, onStatus) {
    return new NoteSession(id, { db: this.db, uid: this.uid, onStatus });
  }
}

export class LocalRepo {
  constructor() {
    this.items = new Map();
    this.pending = 0;
    this.serverLoaded = false;
    this.error = null;
    this.onChange = () => {};
  }

  async subscribe(cb) {
    this.cb = cb;
    const all = await store.all();
    all.forEach((n) => {
      // Notas de la Parte 1: su contenido pasa a Yjs la primera vez que se abren.
      if (n.content && !n.legacy) { n.legacy = n.content; delete n.content; }
      this.items.set(n.id, { color: 'default', pinned: false, trashed: false, ...n });
    });
    this.serverLoaded = true;
    cb(this.list());
  }

  list() { return [...this.items.values()]; }

  persist(id) {
    const n = this.items.get(id);
    if (n) store.put(n);
    this.cb?.(this.list());
  }

  create(extra = {}) {
    const id = newId();
    const now = Date.now();
    this.items.set(id, {
      id, ...emptySummary(), created: now, updated: now, color: 'default', pinned: false, trashed: false, ...extra,
    });
    this.persist(id);
    return id;
  }

  saveSummary(id, summary) {
    const n = this.items.get(id);
    if (!n) return;
    Object.assign(n, summary);
    this.persist(id);
  }

  setMeta(id, patch) { this.saveSummary(id, patch); }

  async removeCompletely(id) {
    this.items.delete(id);
    await store.remove(id);
    try { indexedDB.deleteDatabase(`notas-local-${id}`); } catch { /* nada */ }
    this.cb?.(this.list());
  }

  session(id, onStatus) {
    return new NoteSession(id, { onStatus });
  }
}
