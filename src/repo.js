/*
 * Repositorio de notas.
 * CloudRepo (con cuenta): Firestore.
 *   notes/{id}            → resumen compartido: dueño, miembros, título, vista previa, casillas, miniatura
 *   notes/{id}/updates/*  → cambios de Yjs (contenido de la nota)
 *   users/{uid}/meta/{id} → organización personal de cada usuario: color, fijada, archivo, papelera,
 *                           carpetas y etiquetas de la nota
 *   users/{uid}/folders/* → carpetas (con parentId para subcarpetas)
 *   users/{uid}/labels/*  → etiquetas (nombre y color)
 *   users/{uid}/settings/prefs → preferencias (plazo de la papelera, orden)
 *   users/{uid}/reminders/* → recordatorios (por nota o por casilla), de cada usuario
 *   invites/{noteId}_{email} → invitaciones para compartir una nota (rol: edit | view)
 * LocalRepo (sin cuenta): todo en este dispositivo (IndexedDB).
 */
import {
  collection, doc, query, where, onSnapshot, setDoc, updateDoc, getDocs, writeBatch, deleteDoc,
  arrayUnion, arrayRemove, deleteField,
} from 'firebase/firestore';
import { NoteSession } from './sync.js';
import { store, newId } from './store.js';

const emptySummary = () => ({ title: '', preview: '', checks: { done: 0, total: 0 }, thumb: null });
const DEFAULT_SETTINGS = { trashDays: 30 };
const META_DEFAULTS = {
  color: 'default', pinned: false, archived: false, trashed: false, trashedAt: null, folders: [], labels: [],
};
export const orgId = () => newId();

export class CloudRepo {
  constructor(db, uid, profile = {}) {
    this.db = db;
    this.uid = uid;
    this.profile = { name: profile.name || '', email: (profile.email || '').toLowerCase() };
    this.canShare = true;
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
    return [...this.notes.values()].map((n) => ({ ...META_DEFAULTS, ...n, ...(this.meta.get(n.id) || {}) }));
  }

  // Carpetas, etiquetas y preferencias del usuario
  subscribeOrg(cb) {
    this.folders = new Map(); this.labels = new Map(); this.settings = { ...DEFAULT_SETTINGS };
    this.settingsLoaded = false;
    const emit = () => cb({
      folders: [...this.folders.values()], labels: [...this.labels.values()],
      settings: this.settings, settingsLoaded: this.settingsLoaded,
    });
    const u = this.uid;
    this.unsubOrg = [
      onSnapshot(collection(this.db, 'users', u, 'folders'), (s) => {
        this.folders = new Map(s.docs.map((d) => [d.id, { id: d.id, ...d.data() }])); emit();
      }),
      onSnapshot(collection(this.db, 'users', u, 'labels'), (s) => {
        this.labels = new Map(s.docs.map((d) => [d.id, { id: d.id, ...d.data() }])); emit();
      }),
      onSnapshot(doc(this.db, 'users', u, 'settings', 'prefs'), (d) => {
        this.settings = { ...DEFAULT_SETTINGS, ...(d.data() || {}) };
        if (!d.metadata.fromCache || d.exists()) this.settingsLoaded = true;
        emit();
      }),
    ];
  }

  saveFolder({ id, ...data }) { this.track(setDoc(doc(this.db, 'users', this.uid, 'folders', id), data, { merge: true })); }
  deleteFolder(id) { this.track(deleteDoc(doc(this.db, 'users', this.uid, 'folders', id))); }
  saveLabel({ id, ...data }) { this.track(setDoc(doc(this.db, 'users', this.uid, 'labels', id), data, { merge: true })); }
  deleteLabel(id) { this.track(deleteDoc(doc(this.db, 'users', this.uid, 'labels', id))); }
  saveSettings(patch) { this.track(setDoc(doc(this.db, 'users', this.uid, 'settings', 'prefs'), patch, { merge: true })); }
  canPurge(note) { return note.owner === this.uid; }

  subscribeReminders(cb) {
    this.unsubRem = onSnapshot(collection(this.db, 'users', this.uid, 'reminders'), (s) => {
      cb(s.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => { this.error = err; this.onChange(); });
  }

  /* ---------- Compartir ---------- */
  me() { return { name: this.profile.name, email: this.profile.email }; }

  subscribeInvites(cb) {
    if (!this.profile.email) { cb([]); return; }
    this.unsubInv = onSnapshot(query(collection(this.db, 'invites'), where('email', '==', this.profile.email)), (s) => {
      cb(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.status === 'pending'));
    }, (err) => console.warn('Invitaciones', err));
  }

  watchNoteInvites(noteId, cb) {
    return onSnapshot(query(collection(this.db, 'invites'), where('noteId', '==', noteId), where('from', '==', this.uid)),
      (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
  }

  async invite(note, email, role) {
    const e = email.trim().toLowerCase();
    const ref = doc(this.db, 'notes', note.id);
    // El dueño queda registrado como miembro con nombre y email (para que lo vean los demás)
    if (!note.members?.[this.uid]) {
      await this.track(updateDoc(ref, { [`members.${this.uid}`]: this.me(), [`roles.${this.uid}`]: 'owner' }));
    }
    await this.track(setDoc(doc(this.db, 'invites', `${note.id}_${e}`), {
      noteId: note.id, email: e, role, from: this.uid, fromName: this.profile.name, fromEmail: this.profile.email,
      noteTitle: note.title || note.preview?.slice(0, 60) || '', status: 'pending', created: Date.now(),
    }));
  }

  cancelInvite(id) { return this.track(deleteDoc(doc(this.db, 'invites', id))); }

  async acceptInvite(inv) {
    await updateDoc(doc(this.db, 'notes', inv.noteId), {
      memberIds: arrayUnion(this.uid), [`roles.${this.uid}`]: inv.role, [`members.${this.uid}`]: this.me(),
    });
    await deleteDoc(doc(this.db, 'invites', inv.id));
  }

  declineInvite(inv) { return this.track(deleteDoc(doc(this.db, 'invites', inv.id))); }

  setRole(noteId, uid, role) { return this.track(updateDoc(doc(this.db, 'notes', noteId), { [`roles.${uid}`]: role })); }

  removeMember(noteId, uid) {
    return this.track(updateDoc(doc(this.db, 'notes', noteId), {
      memberIds: arrayRemove(uid), [`roles.${uid}`]: deleteField(), [`members.${uid}`]: deleteField(),
    }));
  }

  async leaveNote(noteId) {
    await this.removeMember(noteId, this.uid);
    this.track(deleteDoc(doc(this.db, 'users', this.uid, 'meta', noteId)));
  }

  roleOf(note) {
    if (!note) return 'owner';
    if (note.owner === this.uid) return 'owner';
    return note.roles?.[this.uid] || 'edit';
  }

  saveReminder({ id, ...data }) { this.track(setDoc(doc(this.db, 'users', this.uid, 'reminders', id), data, { merge: true })); }
  deleteReminder(id) { this.track(deleteDoc(doc(this.db, 'users', this.uid, 'reminders', id))); }

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
      this.items.set(n.id, { ...META_DEFAULTS, ...n });
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
    this.items.set(id, { id, ...emptySummary(), ...META_DEFAULTS, created: now, updated: now, ...extra });
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

  // Carpetas, etiquetas y preferencias (sin cuenta: en este dispositivo)
  loadOrg() {
    try { return JSON.parse(localStorage.getItem('notas-org')) || {}; } catch { return {}; }
  }

  subscribeOrg(cb) {
    const o = this.loadOrg();
    this.org = { folders: o.folders || {}, labels: o.labels || {}, settings: { ...DEFAULT_SETTINGS, ...(o.settings || {}) } };
    this.orgCb = cb;
    this.emitOrg();
  }

  emitOrg() {
    localStorage.setItem('notas-org', JSON.stringify(this.org));
    this.orgCb?.({
      folders: Object.values(this.org.folders), labels: Object.values(this.org.labels),
      settings: this.org.settings, settingsLoaded: true,
    });
  }

  saveFolder(f) { this.org.folders[f.id] = { ...(this.org.folders[f.id] || {}), ...f }; this.emitOrg(); }
  deleteFolder(id) { delete this.org.folders[id]; this.emitOrg(); }
  saveLabel(l) { this.org.labels[l.id] = { ...(this.org.labels[l.id] || {}), ...l }; this.emitOrg(); }
  deleteLabel(id) { delete this.org.labels[id]; this.emitOrg(); }
  saveSettings(patch) { Object.assign(this.org.settings, patch); this.emitOrg(); }
  canPurge() { return true; }

  get canShare() { return false; }
  roleOf() { return 'owner'; }
  subscribeInvites(cb) { cb([]); }

  loadReminders() {
    try { return JSON.parse(localStorage.getItem('notas-recordatorios')) || {}; } catch { return {}; }
  }

  subscribeReminders(cb) {
    this.rem = this.loadReminders();
    this.remCb = cb;
    cb(Object.values(this.rem));
  }

  emitReminders() {
    localStorage.setItem('notas-recordatorios', JSON.stringify(this.rem));
    this.remCb?.(Object.values(this.rem));
  }

  saveReminder(r) { this.rem[r.id] = { ...(this.rem[r.id] || {}), ...r }; this.emitReminders(); }
  deleteReminder(id) { delete this.rem[id]; this.emitReminders(); }
}
