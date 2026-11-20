/*
 * Recordatorios (por nota o por casilla).
 * - Android: notificaciones locales programadas en el teléfono, con "Hecho" y "Posponer 10 min".
 *   Cada dispositivo Android programa los recordatorios que recibe al sincronizar.
 * - Web: aviso mientras la página está abierta (notificación del navegador si se permitió).
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative } from './native.js';

export const REPEATS = [
  [null, 'No se repite'], ['day', 'Cada día'], ['week', 'Cada semana'], ['month', 'Cada mes'], ['year', 'Cada año'],
];
const ACTION_TYPE = 'NOTAS_RECORDATORIO';
const SNOOZE_MIN = 10;

// Id numérico estable para la notificación de Android (a partir del id del recordatorio)
export function notifId(rid) {
  let h = 0;
  for (let i = 0; i < rid.length; i++) h = (Math.imul(31, h) + rid.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000 + 1;
}

function addInterval(d, repeat) {
  const x = new Date(d);
  if (repeat === 'day') x.setDate(x.getDate() + 1);
  else if (repeat === 'week') x.setDate(x.getDate() + 7);
  else if (repeat === 'month') x.setMonth(x.getMonth() + 1);
  else if (repeat === 'year') x.setFullYear(x.getFullYear() + 1);
  return x.getTime();
}

// Próxima vez que tiene que sonar (para los que se repiten, la siguiente en el futuro)
export function nextOccurrence(r, from = Date.now()) {
  if (r.snoozedUntil && r.snoozedUntil > from) return r.snoozedUntil;
  if (!r.repeat) return r.at;
  let t = r.at; let guard = 0;
  while (t <= from && guard++ < 5000) t = addInterval(t, r.repeat);
  return t;
}

export const isActive = (r) => !r.done;

export function formatWhen(t, now = Date.now()) {
  const d = new Date(t);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  const hm = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `Hoy ${hm}`;
  if (diff === 1) return `Mañana ${hm}`;
  if (diff === -1) return `Ayer ${hm}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString('es-AR', { weekday: 'short' })} ${hm}`;
  return `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })} ${hm}`;
}

/* ---------- Android ---------- */
let nativeReady = false;
export async function initNativeReminders(onAction) {
  if (!isNative || nativeReady) return;
  nativeReady = true;
  try {
    await LocalNotifications.registerActionTypes({
      types: [{ id: ACTION_TYPE, actions: [{ id: 'done', title: 'Hecho' }, { id: 'snooze', title: `Posponer ${SNOOZE_MIN} min` }] }],
    });
    await LocalNotifications.addListener('localNotificationActionPerformed', (ev) => {
      const extra = ev?.notification?.extra || {};
      onAction(ev.actionId, extra.rid, extra.noteId);
    });
  } catch (e) { console.warn('Recordatorios: no se pudieron preparar las acciones', e); }
}

// Pide permiso de notificaciones (Android 13+) y avisa si faltan las alarmas exactas (Android 12+).
export async function ensureNativePermissions(askExact) {
  if (!isNative) return true;
  try {
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
    if (p.display !== 'granted') return false;
    try {
      const ex = await LocalNotifications.checkExactNotificationSetting();
      if (ex?.exact_alarm && ex.exact_alarm !== 'granted' && await askExact()) {
        await LocalNotifications.changeExactNotificationSetting();
      }
    } catch { /* versiones de Android sin este ajuste */ }
    return true;
  } catch { return false; }
}

// Deja programadas en el teléfono exactamente las notificaciones de los recordatorios activos.
export async function syncNative(reminders, describe) {
  if (!isNative) return;
  try {
    const now = Date.now();
    const wanted = new Map();
    reminders.forEach((r) => {
      const d = describe(r);
      if (!d) return; // nota borrada o en la papelera
      const when = nextOccurrence(r, now);
      if (when <= now) return; // ya sonó (no repetir el aviso)
      wanted.set(notifId(r.id), { r, d, when });
    });
    const pending = (await LocalNotifications.getPending()).notifications || [];
    const pendingIds = new Set(pending.map((p) => p.id));
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('notas-programados') || '{}'); } catch { /* nada */ }

    const cancel = pending.filter((p) => !wanted.has(p.id)).map((p) => ({ id: p.id }));
    const toSchedule = [];
    wanted.forEach(({ r, d, when }, id) => {
      const sig = `${r.repeat || ''}|${r.repeat && !(r.snoozedUntil > now) ? r.at : when}|${d.title}|${d.body}`;
      if (pendingIds.has(id) && stored[id] === sig) return;
      if (pendingIds.has(id)) cancel.push({ id });
      toSchedule.push({
        id, title: d.title, body: d.body, largeBody: d.body,
        schedule: scheduleFor(r, when, now),
        actionTypeId: ACTION_TYPE, smallIcon: 'ic_stat_notas', iconColor: '#6750A4',
        extra: { rid: r.id, noteId: r.noteId },
      });
      stored[id] = sig;
    });
    Object.keys(stored).forEach((k) => { if (!wanted.has(Number(k))) delete stored[k]; });
    if (cancel.length) await LocalNotifications.cancel({ notifications: cancel });
    if (toSchedule.length) await LocalNotifications.schedule({ notifications: toSchedule });
    localStorage.setItem('notas-programados', JSON.stringify(stored));
  } catch (e) { console.warn('Recordatorios: no se pudieron programar', e); }
}

// Los que se repiten quedan programados en Android aunque no se abra la app ("on" = día/hora fijos).
function scheduleFor(r, when, now) {
  if (!r.repeat || (r.snoozedUntil && r.snoozedUntil > now)) return { at: new Date(when), allowWhileIdle: true };
  const d = new Date(r.at);
  const on = { hour: d.getHours(), minute: d.getMinutes() };
  if (r.repeat === 'week') on.weekday = d.getDay() + 1; // 1 = domingo
  if (r.repeat === 'month') on.day = d.getDate();
  if (r.repeat === 'year') { on.month = d.getMonth() + 1; on.day = d.getDate(); }
  return { on, allowWhileIdle: true };
}

/* ---------- Web ---------- */
let webTimers = [];
export function syncWeb(reminders, describe, onFire) {
  if (isNative) return;
  webTimers.forEach(clearTimeout);
  webTimers = [];
  const now = Date.now();
  reminders.forEach((r) => {
    const d = describe(r);
    if (!d) return;
    const when = nextOccurrence(r, now);
    const wait = when - now;
    if (wait <= 0 || wait > 2147483000) return;
    webTimers.push(setTimeout(() => onFire(r, d), wait));
  });
}

export async function askWebNotifications() {
  if (isNative || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

export function showWebNotification(title, body, tag, onClick) {
  if (isNative || !('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, { body, tag, icon: './icon.svg' });
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
    return true;
  } catch { return false; }
}

export { SNOOZE_MIN };

// Aviso inmediato (por ejemplo, alguien pidió acceso a una nota tuya)
export async function notifyNow(title, body, extra = {}) {
  if (isNative) {
    try {
      const p = await LocalNotifications.checkPermissions();
      if (p.display !== 'granted') return;
      await LocalNotifications.schedule({ notifications: [{
        id: Math.floor(Math.random() * 1000000000) + 1000000000, title, body, largeBody: body,
        schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true }, smallIcon: 'ic_stat_notas', iconColor: '#6750A4', extra,
      }] });
    } catch { /* nada */ }
    return;
  }
  showWebNotification(title, body, `aviso-${Date.now()}`);
}
