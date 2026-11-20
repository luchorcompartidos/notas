import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import Link from '@tiptap/extension-link';
import { ySyncPluginKey } from 'y-prosemirror';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const reminderKey = new PluginKey('casillasConRecordatorio');

// Cada casilla lleva un id fijo (para poder ponerle un recordatorio) y se marca si tiene uno.
const TaskItemConId = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
    };
  },
  addProseMirrorPlugins() {
    const getIds = this.options.reminderIds;
    return [
      ...(this.parent?.() || []),
      new Plugin({
        key: new PluginKey('idsDeCasillas'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          let tr = null; const seen = new Set();
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'taskItem') return;
            const id = node.attrs.id;
            if (!id || seen.has(id)) { tr = tr || state.tr; tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: rid() }); } else seen.add(id);
          });
          return tr;
        },
      }),
      new Plugin({
        key: reminderKey,
        props: {
          decorations: (state) => {
            const ids = getIds?.() || new Set();
            if (!ids.size) return null;
            const decos = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'taskItem' && ids.has(node.attrs.id)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'has-reminder' }));
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

// Vuelve a dibujar las marcas de recordatorio de las casillas
export function refreshReminderMarks(editor) {
  if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(reminderKey, true));
}

// Casilla en la que está el cursor (o null)
export function currentTaskItem(editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'taskItem') return { id: node.attrs.id, text: node.textContent.trim(), checked: !!node.attrs.checked };
  }
  return null;
}

// Estado de las casillas de la nota: id → { checked, text }
export function taskItems(editor) {
  const map = new Map();
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'taskItem' && node.attrs.id) map.set(node.attrs.id, { checked: !!node.attrs.checked, text: node.textContent.trim() });
  });
  return map;
}

// Tildar una casilla por su id (desde la notificación "Hecho")
export function checkTaskItem(editor, id) {
  let done = false;
  editor.state.doc.descendants((node, pos) => {
    if (!done && node.type.name === 'taskItem' && node.attrs.id === id) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: true }));
      done = true;
    }
  });
  return done;
}

// El contenido vive en el documento Yjs de la nota (fusión de cambios entre dispositivos).
export function createEditor(element, { ydoc, onUpdate, onState, onCreate, reminderIds }) {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] }, codeBlock: false, code: false, history: false }),
      Underline,
      TaskList,
      TaskItemConId.configure({ nested: true, reminderIds }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: 'Escribí tu nota…' }),
      Link.configure({ autolink: true, linkOnPaste: true, openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
      Collaboration.configure({ document: ydoc, field: 'default' }),
    ],
    editorProps: {
      attributes: { spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on' },
      // Deja margen abajo para que el cursor no quede tapado por la barra de formato.
      scrollMargin: { top: 24, bottom: 120, left: 0, right: 0 },
      scrollThreshold: { top: 24, bottom: 120, left: 0, right: 0 },
    },
    // remote = el cambio llegó de otro dispositivo (no hace falta volver a guardar el resumen)
    onUpdate: ({ editor, transaction }) => onUpdate(editor, !!transaction.getMeta(ySyncPluginKey)?.isChangeOrigin),
    onCreate: ({ editor }) => onCreate?.(editor),
    onTransaction: ({ editor }) => onState(editor),
  });
}

// Comandos de la barra de formato.
export function runCommand(editor, cmd) {
  const c = editor.chain().focus();
  switch (cmd) {
    case 'undo': return c.undo().run();
    case 'redo': return c.redo().run();
    case 'bold': return c.toggleBold().run();
    case 'italic': return c.toggleItalic().run();
    case 'underline': return c.toggleUnderline().run();
    case 'bulletList': return c.toggleBulletList().run();
    case 'orderedList': return c.toggleOrderedList().run();
    case 'taskList': return c.toggleTaskList().run();
    case 'heading': {
      // Ciclo: párrafo → Título 1 → Título 2 → párrafo
      if (editor.isActive('heading', { level: 1 })) return c.setHeading({ level: 2 }).run();
      if (editor.isActive('heading', { level: 2 })) return c.setParagraph().run();
      return c.setHeading({ level: 1 }).run();
    }
    default: return false;
  }
}

export function isActive(editor, cmd) {
  if (cmd === 'heading') return editor.isActive('heading');
  if (['bold', 'italic', 'underline', 'bulletList', 'orderedList', 'taskList'].includes(cmd)) return editor.isActive(cmd);
  return false;
}

// Datos derivados para la lista: vista previa, casillas y miniatura.
export function summarize(json, text) {
  let done = 0; let total = 0; let thumb = null;
  const walk = (node) => {
    if (node.type === 'taskItem') { total++; if (node.attrs?.checked) done++; }
    if (node.type === 'image' && !thumb) thumb = node.attrs?.src || null;
    node.content?.forEach(walk);
  };
  walk(json);
  return { preview: text.trim().slice(0, 500), text: text.trim().slice(0, 20000), checks: { done, total }, thumb };
}

// Reduce la foto (máx. 1280 px, WebP) para que pese poco: pensado para guardarla luego en Firestore.
export async function compressImage(file, max = 1280, quality = 0.8) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  let url = canvas.toDataURL('image/webp', quality);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality);
  const kb = Math.round((url.length * 3) / 4 / 1024);
  return { url, kb };
}

// Miniatura chica para la lista (la imagen completa queda dentro de la nota).
const thumbCache = new Map();
export async function makeThumb(src, max = 320, quality = 0.6) {
  if (!src) return null;
  const key = `${src.length}:${src.slice(-64)}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  try {
    const img = new window.Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', quality);
    thumbCache.set(key, url);
    return url;
  } catch { return null; }
}

// Reduce una imagen que llega como data URL (por ejemplo, desde "Compartir con…")
export async function compressDataUrl(dataUrl, max = 1280, quality = 0.8) {
  const img = new window.Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/webp', quality);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', quality);
  return url;
}

// Links de la nota (marcados como link o escritos como texto)
export function noteLinks(editor, limit = 5) {
  const found = [];
  const add = (u) => { if (u && /^https?:\/\//i.test(u) && !found.includes(u) && found.length < limit) found.push(u); };
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    node.marks.forEach((m) => { if (m.type.name === 'link') add(m.attrs.href); });
    (node.text.match(/https?:\/\/[^\s<>"']+/gi) || []).forEach((u) => add(u.replace(/[.,;:!?)]+$/, '')));
  });
  return found;
}
