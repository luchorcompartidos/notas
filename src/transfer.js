/*
 * Exportar (PDF, Word .docx, texto .txt, Markdown .md, copia de seguridad .json)
 * e importar (.json de Notas, .md, .txt, .docx, .pdf, .html).
 * Las librerías pesadas (docx, jsPDF, mammoth, pdf.js) se cargan solo al usarlas.
 */
import { isNative } from './native.js';

/* ---------- Contenido de la nota como JSON de ProseMirror ---------- */
const inline = (n) => (n.type === 'text' ? n.text || '' : n.type === 'hardBreak' ? '\n' : (n.content || []).map(inline).join(''));

export async function resolveImages(json, getImage) {
  const walk = async (n) => {
    if (n.type === 'image' && n.attrs?.src?.startsWith('img:')) n.attrs.src = (await getImage(n.attrs.src)) || '';
    for (const c of n.content || []) await walk(c);
  };
  await walk(json);
  return json;
}

/* ---------- Texto plano ---------- */
function blocksToText(nodes, depth = 0) {
  const out = [];
  let num = 0;
  for (const n of nodes || []) {
    const pad = '  '.repeat(depth);
    if (n.type === 'paragraph' || n.type === 'heading') out.push(pad + inline(n));
    else if (n.type === 'blockquote') out.push(...blocksToText(n.content, depth).map((l) => `> ${l}`));
    else if (n.type === 'horizontalRule') out.push('—————');
    else if (n.type === 'image') out.push(`${pad}[imagen]`);
    else if (['bulletList', 'orderedList', 'taskList'].includes(n.type)) {
      num = 0;
      for (const item of n.content || []) {
        num++;
        const mark = n.type === 'bulletList' ? '•' : n.type === 'orderedList' ? `${num}.` : (item.attrs?.checked ? '[x]' : '[ ]');
        const [first, ...rest] = item.content || [];
        out.push(`${pad}${mark} ${first ? inline(first) : ''}`);
        out.push(...blocksToText(rest, depth + 1));
      }
    }
  }
  return out;
}

export function toText(note) {
  const body = blocksToText(note.json?.content).join('\n');
  return note.title ? `${note.title}\n\n${body}` : body;
}

/* ---------- Markdown ---------- */
function mdInline(n) {
  if (n.type === 'hardBreak') return '  \n';
  if (n.type !== 'text') return (n.content || []).map(mdInline).join('');
  let t = (n.text || '').replace(/([*_~`[\]\\])/g, '\\$1');
  const marks = (n.marks || []).map((m) => m.type);
  if (marks.includes('bold')) t = `**${t}**`;
  if (marks.includes('italic')) t = `*${t}*`;
  if (marks.includes('strike')) t = `~~${t}~~`;
  if (marks.includes('underline')) t = `<u>${t}</u>`;
  const link = (n.marks || []).find((m) => m.type === 'link');
  if (link) t = `[${t}](${link.attrs.href})`;
  return t;
}

function blocksToMd(nodes, depth = 0) {
  const out = [];
  for (const n of nodes || []) {
    const pad = '  '.repeat(depth);
    if (n.type === 'paragraph') out.push(pad + (n.content || []).map(mdInline).join(''), '');
    else if (n.type === 'heading') out.push(`${'#'.repeat((n.attrs?.level || 1) + 1)} ${(n.content || []).map(mdInline).join('')}`, '');
    else if (n.type === 'blockquote') out.push(...blocksToMd(n.content, depth).map((l) => (l ? `> ${l}` : '>')));
    else if (n.type === 'horizontalRule') out.push('---', '');
    else if (n.type === 'image') out.push(`${pad}![imagen](${n.attrs?.src || ''})`, '');
    else if (['bulletList', 'orderedList', 'taskList'].includes(n.type)) {
      let num = 0;
      for (const item of n.content || []) {
        num++;
        const mark = n.type === 'bulletList' ? '-' : n.type === 'orderedList' ? `${num}.` : (item.attrs?.checked ? '- [x]' : '- [ ]');
        const [first, ...rest] = item.content || [];
        out.push(`${pad}${mark} ${first ? (first.content || []).map(mdInline).join('') : ''}`);
        out.push(...blocksToMd(rest, depth + 1).filter((l) => l !== ''));
      }
      out.push('');
    }
  }
  return out;
}

export function toMarkdown(note) {
  const body = blocksToMd(note.json?.content).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return note.title ? `# ${note.title}\n\n${body}\n` : `${body}\n`;
}

/* ---------- Imágenes a PNG/JPEG (Word y PDF no aceptan WebP) ---------- */
async function rasterize(src, type = 'image/png', maxW = 1200) {
  const img = new window.Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL(type, 0.85), w: c.width, h: c.height };
}
const b64ToBytes = (url) => Uint8Array.from(atob(url.split(',')[1]), (ch) => ch.charCodeAt(0));

/* ---------- Word (.docx) ---------- */
export async function toDocx(notes) {
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, ExternalHyperlink, LevelFormat, AlignmentType } = d;
  let listInstance = 0;
  const runs = (nodes) => (nodes || []).flatMap((n) => {
    if (n.type === 'hardBreak') return [new TextRun({ text: '', break: 1 })];
    if (n.type !== 'text') return runs(n.content);
    const marks = (n.marks || []).map((m) => m.type);
    const opts = { text: n.text, bold: marks.includes('bold'), italics: marks.includes('italic'), strike: marks.includes('strike'), underline: marks.includes('underline') ? {} : undefined };
    const link = (n.marks || []).find((m) => m.type === 'link');
    return link ? [new ExternalHyperlink({ link: link.attrs.href, children: [new TextRun({ ...opts, style: 'Hyperlink' })] })] : [new TextRun(opts)];
  });
  const blocks = async (nodes, depth = 0) => {
    const out = [];
    for (const n of nodes || []) {
      if (n.type === 'paragraph') out.push(new Paragraph({ children: runs(n.content), indent: depth ? { left: depth * 360 } : undefined }));
      else if (n.type === 'heading') out.push(new Paragraph({ heading: n.attrs?.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: runs(n.content) }));
      else if (n.type === 'blockquote') out.push(...(await blocks(n.content, depth + 1)));
      else if (n.type === 'horizontalRule') out.push(new Paragraph({ border: { bottom: { style: 'single', size: 6, color: 'BBBBBB', space: 4 } }, children: [] }));
      else if (n.type === 'image' && n.attrs?.src) {
        try {
          const r = await rasterize(n.attrs.src, 'image/png', 1200);
          const w = Math.min(560, r.w);
          out.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: b64ToBytes(r.url), transformation: { width: w, height: Math.round((r.h * w) / r.w) } })] }));
        } catch { /* imagen ilegible */ }
      } else if (['bulletList', 'orderedList', 'taskList'].includes(n.type)) {
        const instance = ++listInstance;
        for (const item of n.content || []) {
          const [first, ...rest] = item.content || [];
          const children = runs(first?.content);
          if (n.type === 'bulletList') out.push(new Paragraph({ children, bullet: { level: Math.min(depth, 8) } }));
          else if (n.type === 'orderedList') out.push(new Paragraph({ children, numbering: { reference: 'numeros', level: Math.min(depth, 8), instance } }));
          else out.push(new Paragraph({ children: [new TextRun(item.attrs?.checked ? '☑ ' : '☐ '), ...children], indent: { left: depth * 360 } }));
          out.push(...(await blocks(rest, depth + 1)));
        }
      }
    }
    return out;
  };
  const children = [];
  for (const [i, note] of notes.entries()) {
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, pageBreakBefore: i > 0, children: [new TextRun(note.title || 'Sin título')] }));
    children.push(...(await blocks(note.json?.content)));
  }
  const doc = new Document({
    creator: 'Notas',
    numbering: { config: [{ reference: 'numeros', levels: Array.from({ length: 9 }, (_, l) => ({ level: l, format: LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360 * (l + 1), hanging: 260 } } } })) }] },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

/* ---------- PDF ---------- */
const pdfSafe = (t) => String(t || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\t/g, '    ');

export async function toPdf(notes) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 18; const W = 210 - M * 2; const H = 297;
  let y = M;
  const ensure = (h) => { if (y + h > H - M) { pdf.addPage(); y = M; } };
  const write = (text, { size = 11, style = 'normal', indent = 0, after = 2, box = null, color = 20 } = {}) => {
    pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(color);
    const lh = size * 0.42;
    const lines = pdf.splitTextToSize(pdfSafe(text) || ' ', W - indent - (box !== null ? 6 : 0));
    lines.forEach((line, i) => {
      ensure(lh + 1);
      if (i === 0 && box !== null) {
        pdf.setDrawColor(90); pdf.setLineWidth(0.3); pdf.rect(M + indent, y - 3.1, 3.4, 3.4);
        if (box) { pdf.line(M + indent + 0.6, y - 1.5, M + indent + 1.5, y - 0.4); pdf.line(M + indent + 1.5, y - 0.4, M + indent + 3, y - 2.6); }
      }
      pdf.text(line, M + indent + (box !== null ? 6 : 0), y);
      y += lh;
    });
    y += after;
  };
  const blocks = async (nodes, depth = 0) => {
    for (const n of nodes || []) {
      const ind = depth * 6;
      const style = (n.content || []).every((t) => (t.marks || []).some((m) => m.type === 'bold')) && n.content?.length ? 'bold' : 'normal';
      if (n.type === 'paragraph') write(inline(n), { indent: ind, style });
      else if (n.type === 'heading') { y += 2; write(inline(n), { size: n.attrs?.level === 1 ? 16 : 13.5, style: 'bold', after: 2.5 }); }
      else if (n.type === 'blockquote') await blocks(n.content, depth + 1);
      else if (n.type === 'horizontalRule') { ensure(4); pdf.setDrawColor(180); pdf.line(M, y, M + W, y); y += 4; }
      else if (n.type === 'image' && n.attrs?.src) {
        try {
          const r = await rasterize(n.attrs.src, 'image/jpeg', 1400);
          let w = Math.min(W - ind, (r.w / 96) * 25.4); let h = (r.h * w) / r.w;
          if (h > H - M * 2) { h = H - M * 2; w = (r.w * h) / r.h; }
          ensure(h + 2); pdf.addImage(r.url, 'JPEG', M + ind, y, w, h); y += h + 3;
        } catch { /* imagen ilegible */ }
      } else if (['bulletList', 'orderedList', 'taskList'].includes(n.type)) {
        let num = 0;
        for (const item of n.content || []) {
          num++;
          const [first, ...rest] = item.content || [];
          const text = first ? inline(first) : '';
          if (n.type === 'taskList') write(text, { indent: ind, box: !!item.attrs?.checked, after: 1, color: item.attrs?.checked ? 120 : 20 });
          else write(`${n.type === 'bulletList' ? '•' : `${num}.`}  ${text}`, { indent: ind, after: 1 });
          await blocks(rest, depth + 1);
        }
        y += 1.5;
      }
    }
  };
  for (const [i, note] of notes.entries()) {
    if (i > 0) { pdf.addPage(); y = M; }
    write(note.title || 'Sin título', { size: 20, style: 'bold', after: 4 });
    await blocks(note.json?.content);
  }
  return pdf.output('blob');
}

/* ---------- Copia de seguridad (.json) ---------- */
export function toBackup(notes, version) {
  return JSON.stringify({ app: 'Notas', format: 1, version, exported: new Date().toISOString(), notes }, null, 2);
}

/* ---------- Entregar el archivo (descarga en la web, compartir/guardar en Android) ---------- */
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export async function deliverFile(filename, blob) {
  if (isNative) {
    const fs = await import('@capacitor/filesystem');
    const sh = await import('@capacitor/share');
    const res = await fs.Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: fs.Directory.Cache });
    await sh.Share.share({ title: filename, dialogTitle: 'Guardar o enviar', files: [res.uri] });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export const safeName = (t) => (String(t || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim().slice(0, 60) || 'nota');

/* ---------- Importar ---------- */
const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mdInlineToHtml(t) {
  let s = escHtml(t);
  s = s.replace(/!\[[^\]]*\]\(([^)\s]+)\)/g, '<img src="$1">');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/`([^`]+)`/g, '$1');
  s = s.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/g, '<u>$1</u>');
  return s.replace(/\\([*_~`[\]\\])/g, '$1');
}

export function markdownToHtml(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list.tag}>`); list = null; } };
  const open = (kind) => {
    if (list?.kind === kind) return;
    close();
    list = { kind, tag: kind === 'ol' ? 'ol' : 'ul' };
    out.push(kind === 'task' ? '<ul data-type="taskList">' : `<${list.tag}>`);
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { close(); continue; }
    if ((m = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(line))) { open('task'); out.push(`<li data-type="taskItem" data-checked="${m[1] !== ' '}"><p>${mdInlineToHtml(m[2])}</p></li>`); continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) { open('ul'); out.push(`<li><p>${mdInlineToHtml(m[1])}</p></li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { open('ol'); out.push(`<li><p>${mdInlineToHtml(m[1])}</p></li>`); continue; }
    close();
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) out.push(`<h${m[1].length <= 2 ? 1 : 2}>${mdInlineToHtml(m[2])}</h${m[1].length <= 2 ? 1 : 2}>`);
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) out.push('<hr>');
    else if ((m = /^>\s?(.*)$/.exec(line))) out.push(`<blockquote><p>${mdInlineToHtml(m[1])}</p></blockquote>`);
    else out.push(`<p>${mdInlineToHtml(line)}</p>`);
  }
  close();
  return out.join('');
}

const textToHtml = (t) => t.replace(/\r\n?/g, '\n').split('\n').map((l) => `<p>${escHtml(l)}</p>`).join('');
const baseName = (f) => f.name.replace(/\.[^.]+$/, '');

async function pdfToHtml(file) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const paras = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = ''; let lastY = null;
    tc.items.forEach((it) => {
      const yy = it.transform?.[5];
      if (lastY !== null && Math.abs(yy - lastY) > 2) { paras.push(line); line = ''; }
      line += it.str + (it.hasEOL ? '' : '');
      lastY = yy;
      if (it.hasEOL) { paras.push(line); line = ''; lastY = null; }
    });
    if (line) paras.push(line);
  }
  return paras.map((l) => l.trim()).filter(Boolean).map((l) => `<p>${escHtml(l)}</p>`).join('');
}

// Devuelve las notas a crear: { title, html } o { title, json, meta }
export async function readImport(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'json') {
    const j = JSON.parse(await file.text());
    if (j?.app !== 'Notas' || !Array.isArray(j.notes)) throw new Error('No es una copia de seguridad de Notas');
    return j.notes.map((n) => ({ title: n.title || '', json: n.content, meta: n }));
  }
  if (ext === 'md' || ext === 'markdown') {
    const md = await file.text();
    const m = /^#\s+(.+)\n+/.exec(md);
    return [{ title: m ? m[1].trim() : baseName(file), html: markdownToHtml(m ? md.slice(m[0].length) : md) }];
  }
  if (ext === 'txt') return [{ title: baseName(file), html: textToHtml(await file.text()) }];
  if (ext === 'html' || ext === 'htm') {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    return [{ title: doc.title || baseName(file), html: doc.body.innerHTML }];
  }
  if (ext === 'docx') {
    const mod = await import('mammoth/mammoth.browser.min.js');
    const mammoth = mod.default || mod;
    const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return [{ title: baseName(file), html: r.value }];
  }
  if (ext === 'pdf') return [{ title: baseName(file), html: await pdfToHtml(file) }];
  throw new Error(`Formato no compatible: .${ext}`);
}
