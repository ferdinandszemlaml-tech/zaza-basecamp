// ZaZa-BaseCamp – společný kód všech stránek (volání serveru, hlavička, navigace, drobnosti).
const BC = (() => {
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 20V9"/><path d="m7 14 5-5 5 5"/><path d="M5 4h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
  };
  const icon = (name, size = 20, color = 'currentColor') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, { method = 'GET', body, form, allow401 = false } = {}) {
    const headers = { 'x-requested-with': 'basecamp' };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try {
      res = await fetch(`/api/${path}`, { method, headers, body: payload, credentials: 'same-origin' });
    } catch {
      throw new Error('Nepodařilo se spojit se serverem. Zkontroluj internet.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !allow401) {
      location.href = `/?next=${encodeURIComponent(location.pathname + location.search)}`;
      throw new Error(data.error || 'Přihlas se prosím.');
    }
    if (!res.ok) { const e = new Error(data.error || 'Něco se nepovedlo.'); e.status = res.status; throw e; }
    return data;
  }

  let meta = null;
  const sectionName = (id) => meta?.sections.find((s) => s.id === id)?.name ?? id;
  const positionName = (id) => meta?.positions.find((p) => p.id === id)?.name ?? id;
  const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const firstName = (name) => String(name).trim().split(/\s+/)[0];
  const fmtDate = (iso) => { const d = new Date(iso); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`; };
  const fmtShort = (iso) => { const d = new Date(iso); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
  const fileType = (ext) => ({ pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel' }[ext] ?? ext.toUpperCase());
  const mark = (status) => `<span class="mark ${status}" aria-label="${{ ok: 'přečteno', no: 'povinné, nepřečtené', na: 'nepovinné' }[status]}">${{ ok: '✓', no: '✗', na: '–' }[status]}</span>`;
  const telHref = (p) => `tel:${String(p).replace(/[^0-9+]/g, '')}`;
  const posChips = (list) => list.map((p) => `<span class="chip" data-pos="${esc(p)}">${esc(positionName(p))}</span>`).join('');

  function toast(msg, isError = false) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = `toast${isError ? ' err' : ''}`;
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function renderShell(me, active) {
    const admin = me.user.role === 'admin';
    const items = [
      { id: 'uvod', href: '/uvod.html', label: 'Úvod', icon: 'home', badge: me.unread },
      { id: 'sekce', href: '/sekce.html', label: 'Sekce', icon: 'folder' },
      { id: 'tym', href: '/tym.html', label: 'Tým', icon: 'team' },
      { id: 'profil', href: '/profil.html', label: 'Profil', icon: 'user' },
      ...(admin ? [{ id: 'admin', href: '/admin-dokumenty.html', label: 'Admin', icon: 'shield' }] : []),
    ];
    const badge = (n) => (n ? `<span class="badge" aria-label="${n} nepřečtených">${n}</span>` : '');
    const header = document.createElement('header');
    header.className = 'bc-header';
    header.innerHTML = `<a class="bc-logo" href="/uvod.html"><b>ZAZA</b><span>BaseCamp</span></a>
      <nav class="bc-topnav" aria-label="Hlavní menu">${items.map((i) => `<a href="${i.href}" class="${i.id === active ? 'active' : ''}"${i.id === active ? ' aria-current="page"' : ''}>${i.label}${badge(i.badge)}</a>`).join('')}</nav>
      <a class="bc-avatar" href="/profil.html" aria-label="Můj profil">${esc(initials(me.user.name))}</a>`;
    document.body.prepend(header);
    const tabbar = document.createElement('nav');
    tabbar.className = 'bc-tabbar';
    tabbar.setAttribute('aria-label', 'Hlavní menu');
    tabbar.innerHTML = items.map((i) => `<a href="${i.href}" class="${i.id === active ? 'active' : ''}"${i.id === active ? ' aria-current="page"' : ''}>${icon(i.icon, 24)}${i.label}${badge(i.badge)}</a>`).join('');
    document.body.append(tabbar);
  }

  // Každá chráněná stránka: ověří přihlášení, případně admina, vykreslí hlavičku a menu.
  async function init({ active, admin = false } = {}) {
    const me = await api('me');
    meta = me.meta;
    if (admin && me.user.role !== 'admin') { location.href = '/uvod.html'; throw new Error('Jen pro admina'); }
    renderShell(me, active);
    return me;
  }

  // Odkaz na otevření/stažení verze. Evidence se zapíše na serveru při otevření.
  const fileLink = (v, cls = 'btn small') =>
    `<a class="${cls}" href="/api/files/${esc(v.id)}" target="_blank" rel="noopener" data-open="${esc(v.id)}">${v.ext === 'pdf' ? 'Otevřít' : 'Stáhnout'}</a>`;

  // Po otevření dokumentu hned ukáže fajfku a po návratu z PDF obnoví stránku (i počty v menu).
  function trackOpens(root = document) {
    let opened = false;
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-open]');
      if (!a) return;
      opened = true;
      const row = a.closest('[data-row]');
      const m = row?.querySelector('.mark');
      if (m && !m.classList.contains('ok')) { m.className = 'mark ok'; m.textContent = '✓'; m.setAttribute('aria-label', 'přečteno'); }
      row?.classList.remove('new');
    });
    const refresh = () => { if (opened && document.visibilityState === 'visible') location.reload(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
  }

  function fail(ex) {
    const main = document.querySelector('.bc-main');
    if (main) main.innerHTML = `<div class="error" role="alert">${esc(ex.message)}</div>`;
  }

  function adminTabs(active) {
    const tabs = [['dokumenty', '/admin-dokumenty.html', 'Dokumenty'], ['zamestnanci', '/admin-zamestnanci.html', 'Zaměstnanci'], ['prehled', '/admin-prehled.html', 'Přehled']];
    return `<nav class="segmented" aria-label="Admin">${tabs.map(([id, href, label]) => `<a href="${href}" class="${id === active ? 'active' : ''}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
  }

  return {
    api, init, esc, icon, mark, toast, fmtDate, fmtShort, fileType, initials, firstName, fileLink, adminTabs, posChips,
    trackOpens, fail, telHref, sectionName, positionName, get meta() { return meta; },
  };
})();
