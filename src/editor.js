import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';

export function createEditor(element, { onUpdate, onState }) {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] }, codeBlock: false, code: false }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder: 'Escribí tu nota…' }),
    ],
    editorProps: {
      attributes: { spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on' },
      // Deja margen abajo para que el cursor no quede tapado por la barra de formato.
      scrollMargin: { top: 24, bottom: 120, left: 0, right: 0 },
      scrollThreshold: { top: 24, bottom: 120, left: 0, right: 0 },
    },
    onUpdate: ({ editor }) => onUpdate(editor),
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
  return { preview: text.trim().slice(0, 500), checks: { done, total }, thumb };
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
