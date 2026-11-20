/*
 * Vista previa de links: título, descripción, imagen y sitio.
 * - APK: se descarga la página directamente desde el teléfono.
 * - Web: el navegador no puede leer otras páginas (CORS), así que se usa el servicio gratuito
 *   microlink.io (recibe la dirección del link). Se puede desactivar desde el menú.
 * Los resultados se guardan 7 días en este dispositivo.
 */
import { isNative, nativeGet } from './native.js';

const CACHE_KEY = 'notas-links';
const TTL = 7 * 86400000;
const inFlight = new Map();

export const previewsEnabled = () => localStorage.getItem('notas-previews') !== 'no';
export const setPreviewsEnabled = (on) => localStorage.setItem('notas-previews', on ? 'si' : 'no');

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}

function writeCache(url, data) {
  const c = readCache();
  c[url] = { t: Date.now(), data };
  const keys = Object.keys(c);
  if (keys.length > 300) keys.sort((a, b) => c[a].t - c[b].t).slice(0, keys.length - 300).forEach((k) => delete c[k]);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* sin espacio */ }
}

export const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function parseHtml(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (...names) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      if (el?.content) return el.content.trim();
    }
    return '';
  };
  const abs = (u) => { try { return u ? new URL(u, url).href : ''; } catch { return ''; } };
  return {
    title: meta('og:title', 'twitter:title') || doc.querySelector('title')?.textContent?.trim() || '',
    description: meta('og:description', 'twitter:description', 'description'),
    image: abs(meta('og:image', 'og:image:url', 'twitter:image')),
    site: meta('og:site_name') || domainOf(url),
  };
}

async function fetchPreview(url) {
  if (isNative) {
    try {
      const html = await nativeGet(url);
      if (html) {
        const p = parseHtml(html, url);
        if (p.title || p.image) return p;
      }
    } catch { /* se prueba el servicio */ }
  }
  const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(String(res.status));
  const j = await res.json();
  if (j.status !== 'success') throw new Error('sin datos');
  const d = j.data || {};
  return { title: d.title || '', description: d.description || '', image: d.image?.url || d.logo?.url || '', site: d.publisher || domainOf(url) };
}

export async function getPreview(url) {
  const hit = readCache()[url];
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  if (inFlight.has(url)) return inFlight.get(url);
  const p = fetchPreview(url)
    .then((data) => { writeCache(url, data); return data; })
    .catch(() => ({ title: '', description: '', image: '', site: domainOf(url), failed: true })) // no se guarda: se reintenta luego
    .finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}
