// The Info drawer (Balance, Site, About).
import { showClosestSite } from './site.js';
import { $ } from '../core/util.js';
import { renderBalance } from './balance.js';

function showTab(t) {
  document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== 'pane-' + t; });
  if (t === 'balance') renderBalance();
  if (t === 'site') showClosestSite();
}
export function openInfo(t) { $('info').hidden = false; document.body.classList.add('info-open'); if (t) showTab(t); else renderBalance(); $('infoClose').focus(); }
function closeInfo() { $('info').hidden = true; document.body.classList.remove('info-open'); $('openInfo').focus(); }
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.t)));
$('openInfo').addEventListener('click', () => $('info').hidden ? openInfo() : closeInfo());
$('infoClose').addEventListener('click', closeInfo);
$('info').addEventListener('click', e => { if (e.target === $('info')) closeInfo(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('info').hidden) closeInfo(); });
