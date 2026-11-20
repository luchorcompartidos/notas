// Almacenamiento local en IndexedDB (Parte 1: sin backend, todo queda en este dispositivo).
const DB_NAME = 'notas-poc';
const STORE = 'notes';
let dbPromise;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  dbPromise ||= openDb();
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export const store = {
  all: () => run('readonly', (s) => s.getAll()),
  put: (note) => run('readwrite', (s) => s.put(note)),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
};

// Pide al navegador que no borre estos datos si le falta espacio.
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* sin soporte */ }
}

export function newId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

/* Almacén clave-valor de este dispositivo (caché de imágenes, historial sin cuenta) */
let kvPromise;
function openKv() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('notas-kv', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kvRun(mode, fn) {
  kvPromise ||= openKv();
  const db = await kvPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
export const kv = {
  get: (k) => kvRun('readonly', (s) => s.get(k)).catch(() => undefined),
  set: (k, v) => kvRun('readwrite', (s) => s.put(v, k)).catch(() => {}),
  del: (k) => kvRun('readwrite', (s) => s.delete(k)).catch(() => {}),
};
