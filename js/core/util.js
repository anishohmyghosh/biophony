// Small DOM and formatting helpers shared everywhere.

export const CLS = { bird: 'Bird', bat: 'Bat', insect: 'Insect', amphibian: 'Frog', mammal: 'Mammal', whale: 'Underwater' };
export const EMOJI = { bird: '🐦', bat: '🦇', insect: '🦗', amphibian: '🐸', mammal: '🐿', whale: '🐋' };

export const $ = id => document.getElementById(id);
export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
export const fmt = n => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n.toLocaleString();
export function ago(t) {
  const s = Math.max(0, (Date.now() - new Date(t)) / 1000);
  if (s < 60) return Math.round(s) + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
export const normCls = c => (c === 'avian' || !c) ? 'bird' : c;
export const cssVar = c => `var(--${c in CLS ? c : 'bird'})`;
export const COLORS = { bird: '#e3b765', bat: '#b59cf0', insect: '#a7d36a', amphibian: '#5fc7a0', mammal: '#e58c6a', whale: '#6fb3ff' };
export const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
export const kmTxt = d => d < 1 ? '<1 km' : d < 10 ? d.toFixed(1) + ' km' : Math.round(d) + ' km';
