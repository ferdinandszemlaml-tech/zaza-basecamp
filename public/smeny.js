// Směny – společné věci všech stránek karty Směny (záložky, měsíc, načtení dat, popisky).
const SM = (() => {
  const E = window.SmenyEngine;
  const { esc } = BC;

  const TABS = [
    ['rozpis', '/smeny.html', 'Rozpis'],
    ['lide', '/smeny-lide.html', 'Zaměstnanci'],
    ['rotace', '/smeny-rotace.html', 'Rotace pizzařů'],
    ['dostupnosti', '/smeny-dostupnosti.html', 'Dostupnosti'],
    ['provozy', '/smeny-provozy.html', 'Provozy'],
  ];
  function tabs(active, month) {
    return `<nav class="segmented sm-tabs" aria-label="Směny">${TABS.map(([id, href, label]) => {
      const url = month && id !== 'lide' && id !== 'provozy' ? `${href}?m=${month}` : href;
      return `<a href="${url}" class="${id === active ? 'active' : ''}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`;
    }).join('')}</nav>`;
  }

  const MONTH_RE = /^20\d\d-(0[1-9]|1[0-2])$/;
  function currentMonth() {
    const q = new URLSearchParams(location.search).get('m');
    if (q && MONTH_RE.test(q)) { remember(q); return q; }
    try { const s = localStorage.getItem('smeny-month'); if (s && MONTH_RE.test(s)) return s; } catch { /* nic */ }
    const d = new Date();
    if (d.getDate() > 10) d.setMonth(d.getMonth() + 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function remember(m) { try { localStorage.setItem('smeny-month', m); } catch { /* nic */ } }
  function shiftMonth(m, delta) {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const monthTitle = (m) => { const t = E.monthLabel(m); return t[0].toUpperCase() + t.slice(1); };

  async function load(month) {
    const d = await BC.api(`smeny/data?month=${month}`);
    d.config = E.normalizeConfig(d.config);
    return d;
  }
  const saveConfig = (cfg) => BC.api('smeny/config', { method: 'PUT', body: {
    venues: Object.fromEntries(E.VENUES.map((v) => [v, { open: cfg.venues[v].open }])),
    rotation: cfg.rotation,
    positions: cfg.positions.map((p) => ({ key: p.key, count: p.count, wd: p.wd, we: p.we, ...(p.months ? { months: p.months } : {}) })),
  } });

  const pos = (cfg, key) => cfg.positions.find((p) => p.key === key);
  const posLabel = (cfg, key) => { const p = pos(cfg, key); return p ? `${p.group} · ${p.name}` : key; };
  const GROUPS = ['ZaZa Bar', 'ZaZa Kuchyň', 'Little ZaZa'];
  const groupClass = (g) => ({ 'ZaZa Bar': 'g-bar', 'ZaZa Kuchyň': 'g-kitchen', 'Little ZaZa': 'g-little' }[g] ?? '');
  const shortName = (name) => {
    const w = String(name ?? '').trim().split(/\s+/).filter(Boolean);
    if (w.length < 2) return w[0] ?? '';
    return `${w[0]} ${w[w.length - 1][0]}.`;
  };
  const hasPositions = (s) => Object.keys(s.positions ?? {}).length > 0;
  const contractChip = (c) => `<span class="sm-chip">${esc(c ?? 'DPP')}</span>`;
  const newChip = (s) => (s.isNew ? '<span class="sm-chip new">nový</span>' : '');
  const fmtH = (h) => E.fmtHours(h);
  const timeRange = (r) => `${r[0].replace(/^0/, '')}–${r[1].replace(/^0/, '')}`;

  // Jednoduchý potvrzovací/obsahový dialog. Vrací <dialog>, obsah se doplní zvenku.
  function dialog(html, { wide = false } = {}) {
    document.querySelector('dialog.sm-dialog')?.remove();
    const dlg = document.createElement('dialog');
    dlg.className = `sm-dialog${wide ? ' wide' : ''}`;
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
  }

  // SheetJS (čtení a zápis Excelu) se načítá až když je potřeba.
  let xlsxPromise = null;
  function xlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    xlsxPromise ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { xlsxPromise = null; reject(new Error('Nepodařilo se načíst nástroj pro Excel. Zkontroluj internet.')); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  return { E, tabs, currentMonth, remember, shiftMonth, monthTitle, load, saveConfig, pos, posLabel, GROUPS, groupClass, shortName, hasPositions, contractChip, newChip, fmtH, timeRange, dialog, xlsx };
})();
