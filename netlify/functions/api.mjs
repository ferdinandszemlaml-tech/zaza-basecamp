// ZaZa-BaseCamp – jediná serverová funkce. Všechny adresy /api/* vedou sem.
import { getJSON, setJSON, deleteJSON, getFile, setFile, deleteFile } from '../lib/store.mjs';
import {
  hashPassword, verifyPassword, sessionCookie, clearCookie, readSession,
  newToken, hashToken, safeEqual, newId,
} from '../lib/auth.mjs';
import { sendMail, passwordMail } from '../lib/mail.mjs';
import { HttpError } from '../lib/http.mjs';
import { smenyRoutes, availTodo } from '../lib/smeny.mjs';
import {
  SECTIONS, POSITIONS, DEFAULT_MANDATORY, FILE_TYPES, MAX_FILE_BYTES,
  WELCOME_TOKEN_HOURS, RESET_TOKEN_HOURS, ADMIN_RESET_TOKEN_HOURS, MIN_PASSWORD,
} from '../lib/constants.mjs';

export const config = { path: '/api/*' };

const SECTION_IDS = SECTIONS.map((s) => s.id);
const PUBLIC_IDS = SECTIONS.filter((s) => s.public).map((s) => s.id);
const isPublicDoc = (d) => PUBLIC_IDS.includes(d.section);
const POSITION_IDS = POSITIONS.map((p) => p.id);
const HOUR = 3600 * 1000;

// ───────── pomocné funkce ─────────

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const bad = (msg) => { throw new HttpError(400, msg); };

function text(value, { max = 200, required = true, label = 'Pole' } = {}) {
  const v = String(value ?? '').trim();
  if (required && !v) bad(`${label} je povinné.`);
  if (v.length > max) bad(`${label} je příliš dlouhé.`);
  return v;
}
const normUsername = (v) => String(v ?? '').trim().toLowerCase();
function username(v) {
  const u = normUsername(v);
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) bad('Uživatelské jméno: 3–40 znaků, jen malá písmena bez diakritiky, čísla, tečka, pomlčka.');
  return u;
}
function email(v) {
  const e = String(v ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120) bad('Zadej platný e-mail.');
  return e;
}
function password(v) {
  const p = String(v ?? '');
  if (p.length < MIN_PASSWORD) bad(`Heslo musí mít aspoň ${MIN_PASSWORD} znaků.`);
  if (p.length > 200) bad('Heslo je příliš dlouhé.');
  return p;
}
function phone(v) {
  const p = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (!/^\+?[0-9 ()-]+$/.test(p) || digits.length < 9 || digits.length > 15) bad('Zadej platné telefonní číslo, např. +420 777 123 456.');
  return p;
}
function positions(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.some((p) => !POSITION_IDS.includes(p))) bad('Neznámá pozice.');
  return [...new Set(arr)];
}
// Popis / poznámka: libovolný text včetně odstavců, nepovinné.
function longText(v, label) {
  const t = String(v ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > 3000) bad(`${label} je příliš dlouhý (max. 3000 znaků).`);
  return t;
}
function linkUrl(v) {
  const s = String(v ?? '').trim();
  let u;
  try { u = new URL(s); } catch { bad('Zadej celou adresu odkazu, začínající https://'); }
  if (!['https:', 'http:'].includes(u.protocol) || s.length > 2000) bad('Zadej celou adresu odkazu, začínající https://');
  return u.href;
}
const publicLink = (l) => ({ id: l.id, type: l.type ?? 'link', section: l.section, heading: l.heading, title: l.title, url: l.url ?? '', description: l.description ?? '', order: l.order ?? null, mandatoryFor: l.mandatoryFor ?? [] });
// Pořadí v rámci sekce a nadpisu: nová položka jde na konec.
async function nextOrder(section, heading) {
  const all = [...(await loadDocs()), ...(await loadLinks())].filter((x) => x.section === section && x.heading === heading);
  return all.reduce((m, x) => Math.max(m, x.order ?? -1), -1) + 1;
}
// Položky bez pořadí (nahrané před zavedením řazení) jdou první, abecedně.
const byOrder = (a, b) => ((a.order ?? -1) - (b.order ?? -1)) || a.title.localeCompare(b.title, 'cs');
function versionLabel(v) {
  const s = String(v ?? '').trim();
  if (!/^[0-9A-Za-z.\-]{1,15}$/.test(s)) bad('Číslo verze zadej např. jako 1.0 nebo 2.1.');
  return s;
}
async function body(req) {
  try { return await req.json(); } catch { bad('Neplatná data.'); }
}

const publicUser = (u) => ({
  id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone ?? '', role: u.role,
  positions: u.positions, active: u.active, createdAt: u.createdAt, hasPassword: Boolean(u.passwordHash),
});

const loadUsers = () => getJSON('users', []);
const saveUsers = (v) => setJSON('users', v);
const loadDocs = () => getJSON('documents', []);
const saveDocs = (v) => setJSON('documents', v);
const loadLinks = () => getJSON('links', []);
const saveLinks = (v) => setJSON('links', v);
const loadReads = (uid) => getJSON(`reads/${uid}`, []);
const saveReads = (uid, v) => setJSON(`reads/${uid}`, v);

const isMandatory = (doc, user) => !isPublicDoc(doc) && (doc.mandatoryFor ?? []).some((p) => user.positions.includes(p));
const latest = (doc) => doc.versions[0];
const isLink = (l) => (l.type ?? 'link') === 'link';
// Vše, u čeho se eviduje otevření: nejnovější verze dokumentů a odkazy (texty ne).
function trackables(docs, links) {
  return [
    ...docs.filter((d) => !isPublicDoc(d)).map((d) => ({
      id: d.id, kind: 'doc', title: d.title, section: d.section, heading: d.heading, order: d.order, mandatoryFor: d.mandatoryFor ?? [],
      readKey: latest(d).id, version: latest(d).version, uploadedAt: latest(d).uploadedAt,
    })),
    ...links.filter((l) => !isPublicDoc(l) && isLink(l)).map((l) => ({
      id: l.id, kind: 'link', title: l.title, section: l.section, heading: l.heading, order: l.order, mandatoryFor: l.mandatoryFor ?? [],
      readKey: l.id, version: 'odkaz', uploadedAt: l.createdAt,
    })),
  ];
}

async function currentUser(req) {
  const s = readSession(req.headers.get('cookie'));
  if (!s) return null;
  const users = await loadUsers();
  const u = users.find((x) => x.id === s.u);
  if (!u || !u.active || u.pwv !== s.v) return null;
  return u;
}
async function requireUser(req) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'Přihlas se prosím.');
  return u;
}
const ROLES = ['employee', 'provozni', 'admin'];
const roleOf = (v) => (ROLES.includes(v) ? v : 'employee');
// Provozní: jako zaměstnanec, navíc karta Směny. Admin může všechno.
async function requireShifts(req) {
  const u = await requireUser(req);
  if (u.role !== 'admin' && u.role !== 'provozni') throw new HttpError(403, 'Tohle může jen admin nebo provozní.');
  return u;
}
async function requireAdmin(req) {
  const u = await requireUser(req);
  if (u.role !== 'admin') throw new HttpError(403, 'Tohle může jen admin.');
  return u;
}

// Omezení počtu pokusů (přihlášení, zapomenuté heslo).
async function limited(key, limit, windowMs) {
  const rl = await getJSON('ratelimit', {});
  const e = rl[key];
  return Boolean(e && Date.now() - e.first < windowMs && e.count >= limit);
}
async function countHit(key, windowMs) {
  const rl = await getJSON('ratelimit', {});
  const now = Date.now();
  for (const [k, v] of Object.entries(rl)) if (now - v.first > 24 * HOUR) delete rl[k];
  const e = rl[key];
  rl[key] = e && now - e.first < windowMs ? { first: e.first, count: e.count + 1 } : { first: now, count: 1 };
  await setJSON('ratelimit', rl);
}
async function clearHits(key) {
  const rl = await getJSON('ratelimit', {});
  if (rl[key]) { delete rl[key]; await setJSON('ratelimit', rl); }
}

// Jednorázový odkaz na nastavení hesla + e-mail.
async function issuePasswordLink(req, user, kind, hours) {
  const tokens = (await getJSON('tokens', [])).filter((t) => t.expiresAt > Date.now() && t.userId !== user.id);
  const { raw, hash } = newToken();
  tokens.push({ hash, userId: user.id, expiresAt: Date.now() + hours * HOUR });
  await setJSON('tokens', tokens);
  const link = `${new URL(req.url).origin}/nastaveni-hesla.html?token=${raw}`;
  const { subject, html } = passwordMail({ name: user.name, link, kind });
  const sent = await sendMail({ to: user.email, name: user.name, subject, html });
  return { sent, link };
}

// Stav čtení pro jednoho uživatele: které verze otevřel a kdy.
function readMap(reads) {
  const m = new Map();
  for (const r of reads) if (!m.has(r.versionId)) m.set(r.versionId, r.at);
  return m;
}
function userStats(items, user, reads) {
  const m = readMap(reads);
  let read = 0; let missing = 0; let optional = 0;
  const missingDocs = [];
  for (const d of items) {
    if (m.has(d.readKey)) read++;
    else if (isMandatory(d, user)) { missing++; missingDocs.push({ docId: d.id, kind: d.kind, title: d.title, section: d.section, version: d.version }); }
    else optional++;
  }
  return { read, missing, optional, missingDocs };
}

// Soubory verze. Starší verze mají jediný soubor uložený přímo ve verzi (klíč = id verze).
const filesOf = (v) => v.files ?? [{ id: v.id, fileName: v.fileName, ext: v.ext, mime: v.mime, size: v.size }];
const publicFile = (f) => ({ id: f.id, name: f.fileName, ext: f.ext, size: f.size });
function findFile(docs, fileId) {
  for (const d of docs) for (const v of d.versions) {
    const f = filesOf(v).find((x) => x.id === fileId);
    if (f) return { doc: d, v, f };
  }
  return null;
}
const fileEntry = (id, f) => ({ id, fileName: f.fileName, ext: f.ext, mime: f.mime, size: f.size });

function fileResponse(v, file) {
  const disposition = v.ext === 'pdf' ? 'inline' : 'attachment';
  return new Response(file.data, {
    headers: {
      'content-type': v.mime,
      'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(v.fileName)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function readFormFile(form) {
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size) bad('Vyber soubor.');
  if (file.size > MAX_FILE_BYTES) bad('Soubor je větší než 5 MB.');
  const ext = String(file.name).split('.').pop().toLowerCase();
  if (!FILE_TYPES[ext]) bad('Nahrát jde jen PDF, Word nebo Excel.');
  const fileName = String(file.name).replace(/[\\/\r\n"]/g, '_').slice(0, 120);
  return { data: await file.arrayBuffer(), fileName, ext, size: file.size, mime: FILE_TYPES[ext] };
}
async function formData(req) {
  try { return await req.formData(); } catch { bad('Soubor se nepodařilo přijmout. Není větší než 5 MB?'); }
}

// ───────── směrování ─────────

export default async (req) => {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const method = req.method;
    // Ochrana proti podvrženým formulářům z cizích webů.
    if (method !== 'GET' && req.headers.get('x-requested-with') !== 'basecamp') {
      throw new HttpError(403, 'Neplatný požadavek.');
    }
    const route = `${method} ${parts.map((p, i) => (i > 0 && /^(usr|doc|ver|lnk|fil|sme)_/.test(p) ? ':id' : p)).join('/')}`;
    const id = parts.find((p, i) => i > 0 && /^(usr|doc|ver|lnk|fil|sme)_/.test(p));
    const handler = ROUTES[route];
    if (!handler) throw new HttpError(404, 'Neznámá adresa.');
    return await handler(req, { url, id });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: 'Něco se pokazilo na serveru. Zkus to prosím znovu.' });
  }
};

const ROUTES = {
  // ── první spuštění: založení admina ──
  'GET setup-status': async () => json(200, { needsSetup: (await loadUsers()).length === 0 }),

  'POST setup': async (req) => {
    const users = await loadUsers();
    if (users.length) throw new HttpError(403, 'Systém už je nastavený.');
    const b = await body(req);
    const key = process.env.SETUP_KEY;
    if (!key) throw new HttpError(500, 'Server není nastavený: chybí SETUP_KEY.');
    if (!safeEqual(b.setupKey ?? '', key)) throw new HttpError(403, 'Nesprávný instalační klíč.');
    const user = {
      id: newId('usr'), name: text(b.name, { max: 80, label: 'Jméno' }), username: username(b.username),
      email: email(b.email), role: 'admin', positions: [], active: true,
      passwordHash: hashPassword(password(b.password)), pwv: 1, createdAt: new Date().toISOString(),
    };
    await saveUsers([user]);
    return json(200, { ok: true }, { 'set-cookie': sessionCookie(user) });
  },

  // ── přihlášení ──
  'POST login': async (req) => {
    const b = await body(req);
    const name = normUsername(b.username);
    const rlKey = `login:${name}`;
    if (await limited(rlKey, 5, 15 * 60 * 1000)) throw new HttpError(429, 'Příliš mnoho pokusů. Zkus to znovu za 15 minut.');
    const users = await loadUsers();
    const u = users.find((x) => x.username === name && x.active);
    if (!verifyPassword(String(b.password ?? ''), u?.passwordHash)) {
      await countHit(rlKey, 15 * 60 * 1000);
      throw new HttpError(401, 'Nesprávné uživatelské jméno nebo heslo.');
    }
    await clearHits(rlKey);
    return json(200, { ok: true }, { 'set-cookie': sessionCookie(u) });
  },

  'POST logout': async () => json(200, { ok: true }, { 'set-cookie': clearCookie() }),

  'GET me': async (req) => {
    const u = await requireUser(req);
    const [docs, links, reads, avail] = await Promise.all([loadDocs(), loadLinks(), loadReads(u.id), availTodo(u)]);
    const stats = userStats(trackables(docs, links), u, reads);
    return json(200, {
      user: publicUser(u),
      unread: stats.missing,
      availTodo: avail,
      meta: { sections: SECTIONS, positions: POSITIONS, defaultMandatory: DEFAULT_MANDATORY, maxFileBytes: MAX_FILE_BYTES },
    });
  },

  // Zaměstnanec si sám upravuje telefon.
  'PATCH me': async (req) => {
    const me = await requireUser(req);
    const b = await body(req);
    const users = await loadUsers();
    const u = users.find((x) => x.id === me.id);
    if (b.phone !== undefined) u.phone = phone(b.phone);
    await saveUsers(users);
    return json(200, { ok: true, user: publicUser(u) });
  },

  // Kontakty na celý tým – vidí všichni přihlášení.
  'GET team': async (req) => {
    await requireUser(req);
    const users = (await loadUsers()).filter((u) => u.active);
    users.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    return json(200, {
      team: users.map((u) => ({ id: u.id, name: u.name, positions: u.positions, phone: u.phone ?? '', role: u.role })),
    });
  },

  // ── hesla ──
  'POST password/forgot': async (req) => {
    const b = await body(req);
    const name = normUsername(b.username);
    const rlKey = `forgot:${name}`;
    if (name && !(await limited(rlKey, 3, HOUR))) {
      await countHit(rlKey, HOUR);
      const u = (await loadUsers()).find((x) => x.username === name && x.active);
      if (u) await issuePasswordLink(req, u, 'reset', RESET_TOKEN_HOURS);
    }
    // Vždy stejná odpověď, aby nešlo zjišťovat, které účty existují.
    return json(200, { ok: true });
  },

  'POST password/set': async (req) => {
    const b = await body(req);
    const pw = password(b.password);
    const tokens = await getJSON('tokens', []);
    const t = tokens.find((x) => x.hash === hashToken(b.token ?? '') && x.expiresAt > Date.now());
    if (!t) throw new HttpError(400, 'Odkaz už neplatí. Požádej o nový přes „Zapomenuté heslo“.');
    const users = await loadUsers();
    const u = users.find((x) => x.id === t.userId && x.active);
    if (!u) throw new HttpError(400, 'Účet není aktivní.');
    u.passwordHash = hashPassword(pw);
    u.pwv += 1;
    await saveUsers(users);
    await setJSON('tokens', tokens.filter((x) => x.userId !== u.id && x.expiresAt > Date.now()));
    return json(200, { ok: true }, { 'set-cookie': sessionCookie(u) });
  },

  'POST password/change': async (req) => {
    const me = await requireUser(req);
    const b = await body(req);
    if (!verifyPassword(String(b.current ?? ''), me.passwordHash)) throw new HttpError(400, 'Současné heslo nesedí.');
    const pw = password(b.next);
    const users = await loadUsers();
    const u = users.find((x) => x.id === me.id);
    u.passwordHash = hashPassword(pw);
    u.pwv += 1;
    await saveUsers(users);
    return json(200, { ok: true }, { 'set-cookie': sessionCookie(u) });
  },

  // ── dokumenty pro zaměstnance ──
  'GET documents': async (req) => {
    const u = await requireUser(req);
    const [docs, reads] = await Promise.all([loadDocs(), loadReads(u.id)]);
    const m = readMap(reads);
    return json(200, {
      documents: docs.map((d) => ({
        id: d.id, section: d.section, heading: d.heading, title: d.title, description: d.description ?? '', order: d.order ?? null, mandatoryFor: d.mandatoryFor,
        mandatory: isMandatory(d, u),
        versions: d.versions.map((v) => ({
          id: v.id, version: v.version, note: v.note ?? '', ext: filesOf(v)[0].ext, files: filesOf(v).map(publicFile), uploadedAt: v.uploadedAt, readAt: m.get(v.id) ?? null,
        })),
      })),
    });
  },

  'GET files/:id': async (req, { id }) => {
    const u = await requireUser(req);
    const found = findFile(await loadDocs(), id);
    if (!found) throw new HttpError(404, 'Dokument už neexistuje.');
    const { doc, v, f } = found;
    const file = await getFile(f.id);
    if (!file) throw new HttpError(404, 'Soubor se nenašel.');
    const reads = await loadReads(u.id);
    if (!isPublicDoc(doc) && !reads.some((r) => r.versionId === v.id)) {
      reads.unshift({
        docId: doc.id, versionId: v.id, title: doc.title, section: doc.section, heading: doc.heading,
        version: v.version, mandatory: isMandatory(doc, u), at: new Date().toISOString(),
      });
      await saveReads(u.id, reads);
    }
    return fileResponse(f, file);
  },

  // ── odkazy a texty (odkazy se evidují při otevření přes links/:id/open) ──
  'GET links': async (req) => {
    const u = await requireUser(req);
    const [links, reads] = await Promise.all([loadLinks(), loadReads(u.id)]);
    const m = readMap(reads);
    return json(200, {
      links: links.map((l) => ({ ...publicLink(l), mandatory: isLink(l) && isMandatory(l, u), readAt: isLink(l) ? m.get(l.id) ?? null : null })),
    });
  },

  // Otevření odkazu přes BaseCamp: zapíše seznámení a přesměruje na cílovou adresu.
  'GET links/:id/open': async (req, { id }) => {
    const u = await currentUser(req);
    if (!u) return new Response(null, { status: 302, headers: { location: `/?next=${encodeURIComponent(new URL(req.url).pathname)}` } });
    const l = (await loadLinks()).find((x) => x.id === id && isLink(x));
    if (!l) throw new HttpError(404, 'Odkaz už neexistuje.');
    if (!isPublicDoc(l)) {
      const reads = await loadReads(u.id);
      if (!reads.some((r) => r.versionId === l.id)) {
        reads.unshift({
          docId: l.id, versionId: l.id, kind: 'link', title: l.title, section: l.section, heading: l.heading,
          version: 'odkaz', mandatory: isMandatory(l, u), at: new Date().toISOString(),
        });
        await saveReads(u.id, reads);
      }
    }
    return new Response(null, { status: 302, headers: { location: l.url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  },

  // ── veřejná sekce Nový zaměstnanec (bez přihlášení, bez evidence) ──
  'GET public/documents': async () => {
    const links = (await loadLinks()).filter(isPublicDoc).map(publicLink);
    const docs = (await loadDocs()).filter(isPublicDoc)
      .sort((a, b) => a.heading.localeCompare(b.heading, 'cs') || byOrder(a, b));
    return json(200, {
      section: SECTIONS.find((s) => s.public),
      links,
      documents: docs.map((d) => ({
        id: d.id, heading: d.heading, title: d.title, description: d.description ?? '', order: d.order ?? null,
        versions: d.versions.map((v) => ({ id: v.id, version: v.version, note: v.note ?? '', ext: filesOf(v)[0].ext, files: filesOf(v).map(publicFile), uploadedAt: v.uploadedAt })),
      })),
    });
  },

  'GET public/files/:id': async (req, { id }) => {
    const found = findFile(await loadDocs(), id);
    if (!found || !isPublicDoc(found.doc)) throw new HttpError(404, 'Dokument neexistuje.');
    const file = await getFile(found.f.id);
    if (!file) throw new HttpError(404, 'Soubor se nenašel.');
    return fileResponse(found.f, file);
  },

  'GET my-reads': async (req) => {
    const u = await requireUser(req);
    return json(200, { reads: await loadReads(u.id) });
  },

  // ── admin: dokumenty ──
  'POST admin/documents': async (req) => {
    await requireAdmin(req);
    const form = await formData(req);
    const section = String(form.get('section') ?? '');
    if (!SECTION_IDS.includes(section)) bad('Vyber sekci.');
    const heading = text(form.get('heading'), { max: 60, label: 'Nadpis' });
    const title = text(form.get('title'), { max: 120, label: 'Název dokumentu' });
    const version = versionLabel(form.get('version'));
    const description = longText(form.get('description'), 'Popis');
    const mandatoryFor = PUBLIC_IDS.includes(section) ? [] : positions(form.getAll('mandatoryFor'));
    const f = await readFormFile(form);
    const vid = newId('ver');
    await setFile(vid, f.data, { fileName: f.fileName });
    const doc = {
      id: newId('doc'), section, heading, title, description, mandatoryFor, order: await nextOrder(section, heading), createdAt: new Date().toISOString(),
      versions: [{ id: vid, version, note: longText(form.get('note'), 'Popisek verze'), files: [fileEntry(vid, f)], uploadedAt: new Date().toISOString() }],
    };
    const docs = await loadDocs();
    docs.push(doc);
    await saveDocs(docs);
    return json(200, { ok: true, id: doc.id, versionId: vid });
  },

  'POST admin/documents/:id/versions': async (req, { id }) => {
    await requireAdmin(req);
    const form = await formData(req);
    const version = versionLabel(form.get('version'));
    const note = longText(form.get('note'), 'Poznámka k verzi');
    const docs = await loadDocs();
    const doc = docs.find((d) => d.id === id);
    if (!doc) throw new HttpError(404, 'Dokument neexistuje.');
    if (doc.versions.some((v) => v.version === version)) bad('Tahle verze už existuje.');
    const f = await readFormFile(form);
    const vid = newId('ver');
    await setFile(vid, f.data, { fileName: f.fileName });
    doc.versions.unshift({ id: vid, version, note, files: [fileEntry(vid, f)], uploadedAt: new Date().toISOString() });
    await saveDocs(docs);
    return json(200, { ok: true, versionId: vid });
  },

  'POST admin/links': async (req) => {
    await requireAdmin(req);
    const b = await body(req);
    const section = String(b.section ?? '');
    if (!SECTION_IDS.includes(section)) bad('Vyber sekci.');
    const type = b.type === 'note' ? 'note' : 'link';
    const link = {
      id: newId('lnk'), type, section, heading: text(b.heading, { max: 60, label: 'Nadpis' }),
      title: text(b.title, { max: 120, label: 'Název' }), url: type === 'link' ? linkUrl(b.url) : '',
      description: longText(b.description, type === 'note' ? 'Text' : 'Popis'), createdAt: new Date().toISOString(),
    };
    if (type === 'note' && !link.description) bad('Vyplň text.');
    link.mandatoryFor = type === 'link' && !PUBLIC_IDS.includes(section) ? positions(b.mandatoryFor) : [];
    link.order = await nextOrder(section, link.heading);
    const links = await loadLinks();
    links.push(link);
    await saveLinks(links);
    return json(200, { ok: true, id: link.id });
  },

  // Nové pořadí položek jednoho nadpisu (soubory i odkazy dohromady).
  'POST admin/order': async (req) => {
    await requireAdmin(req);
    const b = await body(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    if (!ids.length || ids.length > 500 || new Set(ids).size !== ids.length) bad('Neplatné pořadí.');
    const [docs, links] = await Promise.all([loadDocs(), loadLinks()]);
    const items = ids.map((id) => docs.find((d) => d.id === id) ?? links.find((l) => l.id === id));
    if (items.some((x) => !x)) bad('Některá položka mezitím zmizela. Obnov stránku.');
    const { section, heading } = items[0];
    if (items.some((x) => x.section !== section || x.heading !== heading)) bad('Přesouvat jde jen v rámci jednoho nadpisu.');
    items.forEach((x, i) => { x.order = i; });
    await Promise.all([saveDocs(docs), saveLinks(links)]);
    return json(200, { ok: true });
  },

  // Přejmenování nadpisu v jedné sekci (u souborů, odkazů i textů). Existující nadpis = sloučení.
  'POST admin/headings/rename': async (req) => {
    await requireAdmin(req);
    const b = await body(req);
    const section = String(b.section ?? '');
    if (!SECTION_IDS.includes(section)) bad('Neznámá sekce.');
    const from = String(b.from ?? '');
    const to = text(b.to, { max: 60, label: 'Nadpis' });
    const [docs, links] = await Promise.all([loadDocs(), loadLinks()]);
    const all = [...docs, ...links].filter((x) => x.section === section);
    const moving = all.filter((x) => x.heading === from).sort(byOrder);
    if (!moving.length) throw new HttpError(404, 'Nadpis neexistuje.');
    if (to !== from) {
      const start = all.filter((x) => x.heading === to).reduce((m, x) => Math.max(m, x.order ?? -1), -1) + 1;
      moving.forEach((x, i) => { x.heading = to; x.order = start + i; });
      await Promise.all([saveDocs(docs), saveLinks(links)]);
    }
    return json(200, { ok: true, merged: all.some((x) => x.heading === to && !moving.includes(x)) });
  },

  'PATCH admin/links/:id': async (req, { id }) => {
    await requireAdmin(req);
    const b = await body(req);
    const links = await loadLinks();
    const l = links.find((x) => x.id === id);
    if (!l) throw new HttpError(404, 'Odkaz neexistuje.');
    if (b.title !== undefined) l.title = text(b.title, { max: 120, label: 'Název' });
    if (b.heading !== undefined) {
      const h = text(b.heading, { max: 60, label: 'Nadpis' });
      if (h !== l.heading) { l.order = await nextOrder(l.section, h); l.heading = h; }
    }
    if (b.url !== undefined && isLink(l)) l.url = linkUrl(b.url);
    if (b.mandatoryFor !== undefined && isLink(l) && !isPublicDoc(l)) l.mandatoryFor = positions(b.mandatoryFor);
    if (b.description !== undefined) {
      l.description = longText(b.description, 'Popis');
      if (l.type === 'note' && !l.description) bad('Vyplň text.');
    }
    await saveLinks(links);
    return json(200, { ok: true });
  },

  'DELETE admin/links/:id': async (req, { id }) => {
    await requireAdmin(req);
    const links = await loadLinks();
    if (!links.some((x) => x.id === id)) throw new HttpError(404, 'Odkaz neexistuje.');
    await saveLinks(links.filter((x) => x.id !== id));
    return json(200, { ok: true });
  },

  'PATCH admin/documents/:id': async (req, { id }) => {
    await requireAdmin(req);
    const b = await body(req);
    const docs = await loadDocs();
    const doc = docs.find((d) => d.id === id);
    if (!doc) throw new HttpError(404, 'Dokument neexistuje.');
    if (b.title !== undefined) doc.title = text(b.title, { max: 120, label: 'Název' });
    if (b.description !== undefined) doc.description = longText(b.description, 'Popis');
    if (b.mandatoryFor !== undefined && !isPublicDoc(doc)) doc.mandatoryFor = positions(b.mandatoryFor);
    if (b.heading !== undefined) {
      const h = text(b.heading, { max: 60, label: 'Nadpis' });
      if (h !== doc.heading) { doc.order = await nextOrder(doc.section, h); doc.heading = h; }
    }
    await saveDocs(docs);
    return json(200, { ok: true });
  },

  // Další soubor ke stávající verzi (každý soubor zvlášť kvůli limitu velikosti požadavku).
  'POST admin/versions/:id/files': async (req, { id }) => {
    await requireAdmin(req);
    const form = await formData(req);
    const docs = await loadDocs();
    const doc = docs.find((d) => d.versions.some((v) => v.id === id));
    if (!doc) throw new HttpError(404, 'Verze neexistuje.');
    const v = doc.versions.find((x) => x.id === id);
    const files = filesOf(v);
    if (files.length >= 20) bad('Jedna verze může mít nejvýš 20 souborů.');
    const f = await readFormFile(form);
    const fid = newId('fil');
    await setFile(fid, f.data, { fileName: f.fileName });
    v.files = [...files, fileEntry(fid, f)];
    await saveDocs(docs);
    return json(200, { ok: true, id: fid });
  },

  // Úprava čísla a popisku verze.
  'PATCH admin/versions/:id': async (req, { id }) => {
    await requireAdmin(req);
    const b = await body(req);
    const docs = await loadDocs();
    const doc = docs.find((d) => d.versions.some((v) => v.id === id));
    if (!doc) throw new HttpError(404, 'Verze neexistuje.');
    const v = doc.versions.find((x) => x.id === id);
    if (b.version !== undefined) {
      const label = versionLabel(b.version);
      if (doc.versions.some((x) => x.id !== id && x.version === label)) bad('Tahle verze už existuje.');
      v.version = label;
    }
    if (b.note !== undefined) v.note = longText(b.note, 'Popisek verze');
    await saveDocs(docs);
    return json(200, { ok: true });
  },

  'DELETE admin/files/:id': async (req, { id }) => {
    await requireAdmin(req);
    const docs = await loadDocs();
    const found = findFile(docs, id);
    if (!found) throw new HttpError(404, 'Soubor neexistuje.');
    const files = filesOf(found.v);
    if (files.length === 1) bad('Je to jediný soubor této verze. Smaž rovnou celou verzi.');
    found.v.files = files.filter((x) => x.id !== id);
    await saveDocs(docs);
    await deleteFile(id);
    return json(200, { ok: true });
  },

  'DELETE admin/versions/:id': async (req, { id }) => {
    await requireAdmin(req);
    const docs = await loadDocs();
    const doc = docs.find((d) => d.versions.some((v) => v.id === id));
    if (!doc) throw new HttpError(404, 'Verze neexistuje.');
    const gone = doc.versions.find((v) => v.id === id);
    doc.versions = doc.versions.filter((v) => v.id !== id);
    await saveDocs(doc.versions.length ? docs : docs.filter((d) => d.id !== doc.id));
    await Promise.all(filesOf(gone).map((f) => deleteFile(f.id)));
    // Záznamy o přečtení zůstávají v profilech zaměstnanců jako doklad.
    return json(200, { ok: true, documentRemoved: doc.versions.length === 0 });
  },

  // ── admin: zaměstnanci ──
  'GET admin/users': async (req) => {
    await requireAdmin(req);
    const [users, docs, links] = await Promise.all([loadUsers(), loadDocs(), loadLinks()]);
    const items = trackables(docs, links);
    const list = await Promise.all(users.map(async (u) => {
      const s = userStats(items, u, await loadReads(u.id));
      return { ...publicUser(u), missing: s.missing };
    }));
    list.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'cs'));
    return json(200, { users: list });
  },

  'POST admin/users': async (req) => {
    await requireAdmin(req);
    const b = await body(req);
    const users = await loadUsers();
    const user = {
      id: newId('usr'), name: text(b.name, { max: 80, label: 'Jméno' }), username: username(b.username),
      email: email(b.email), phone: phone(b.phone), role: roleOf(b.role), positions: positions(b.positions),
      active: true, passwordHash: null, pwv: 1, createdAt: new Date().toISOString(),
    };
    if (users.some((x) => x.username === user.username)) bad('Toto uživatelské jméno už existuje.');
    if (users.some((x) => x.email === user.email)) bad('Tento e-mail už má jiný účet.');
    users.push(user);
    await saveUsers(users);
    const { sent, link } = await issuePasswordLink(req, user, 'welcome', WELCOME_TOKEN_HOURS);
    // Když e-mail neodejde, admin dostane odkaz, aby ho mohl předat sám.
    return json(200, { ok: true, id: user.id, mailSent: sent, link: sent ? undefined : link });
  },

  'GET admin/users/:id': async (req, { id }) => {
    await requireAdmin(req);
    const [users, docs, links] = await Promise.all([loadUsers(), loadDocs(), loadLinks()]);
    const u = users.find((x) => x.id === id);
    if (!u) throw new HttpError(404, 'Zaměstnanec neexistuje.');
    const reads = await loadReads(u.id);
    const s = userStats(trackables(docs, links), u, reads);
    return json(200, { user: publicUser(u), stats: s, reads });
  },

  'PATCH admin/users/:id': async (req, { id }) => {
    const me = await requireAdmin(req);
    const b = await body(req);
    const users = await loadUsers();
    const u = users.find((x) => x.id === id);
    if (!u) throw new HttpError(404, 'Zaměstnanec neexistuje.');
    if (b.name !== undefined) u.name = text(b.name, { max: 80, label: 'Jméno' });
    if (b.email !== undefined) {
      const e = email(b.email);
      if (users.some((x) => x.id !== u.id && x.email === e)) bad('Tento e-mail už má jiný účet.');
      u.email = e;
    }
    if (b.phone !== undefined) u.phone = phone(b.phone);
    if (b.positions !== undefined) u.positions = positions(b.positions);
    if (b.role !== undefined) u.role = roleOf(b.role);
    if (b.active !== undefined && Boolean(b.active) !== u.active) {
      u.active = Boolean(b.active);
      u.pwv += 1; // odhlásí ho ze všech zařízení
    }
    if (!users.some((x) => x.role === 'admin' && x.active)) bad('Musí zůstat aspoň jeden aktivní admin.');
    if (u.id === me.id && (!u.active || u.role !== 'admin')) bad('Sám sobě nemůžeš odebrat admina ani deaktivovat účet.');
    await saveUsers(users);
    return json(200, { ok: true, user: publicUser(u) });
  },

  // Trvalé smazání – jen deaktivovaného účtu. Smaže i jeho historii čtení.
  'DELETE admin/users/:id': async (req, { id }) => {
    const me = await requireAdmin(req);
    const users = await loadUsers();
    const u = users.find((x) => x.id === id);
    if (!u) throw new HttpError(404, 'Zaměstnanec neexistuje.');
    if (u.id === me.id) bad('Sám sebe smazat nemůžeš.');
    if (u.active) bad('Nejdřív účet deaktivuj, pak ho půjde smazat.');
    await saveUsers(users.filter((x) => x.id !== u.id));
    await deleteJSON(`reads/${u.id}`);
    await setJSON('tokens', (await getJSON('tokens', [])).filter((t) => t.userId !== u.id));
    return json(200, { ok: true });
  },

  'POST admin/users/:id/send-reset': async (req, { id }) => {
    await requireAdmin(req);
    const u = (await loadUsers()).find((x) => x.id === id && x.active);
    if (!u) throw new HttpError(404, 'Aktivní zaměstnanec neexistuje.');
    const kind = u.passwordHash ? 'reset' : 'welcome';
    const { sent, link } = await issuePasswordLink(req, u, kind, kind === 'welcome' ? WELCOME_TOKEN_HOURS : ADMIN_RESET_TOKEN_HOURS);
    return json(200, { ok: true, mailSent: sent, link: sent ? undefined : link });
  },

  // ── admin: souhrn napříč sekcemi (kdo co nemá / podle dokumentu) ──
  'GET admin/summary': async (req) => {
    await requireAdmin(req);
    const [users, allDocs, links] = await Promise.all([loadUsers(), loadDocs(), loadLinks()]);
    const items = trackables(allDocs, links);
    const active = users.filter((u) => u.active);
    const readsBy = new Map(await Promise.all(active.map(async (u) => [u.id, readMap(await loadReads(u.id))])));
    const people = active.map((u) => {
      const m = readsBy.get(u.id);
      const mand = items.filter((d) => isMandatory(d, u));
      const missing = mand.filter((d) => !m.has(d.readKey));
      return {
        id: u.id, name: u.name, positions: u.positions, total: mand.length, done: mand.length - missing.length,
        missing: missing.map((d) => ({ id: d.id, kind: d.kind, title: d.title, section: d.section, version: d.version, uploadedAt: d.uploadedAt })),
      };
    });
    const documents = items.filter((d) => d.mandatoryFor.length).map((d) => {
      const who = active.filter((u) => isMandatory(d, u));
      const missing = who.filter((u) => !readsBy.get(u.id).has(d.readKey));
      return {
        id: d.id, kind: d.kind, title: d.title, section: d.section, heading: d.heading, version: d.version, uploadedAt: d.uploadedAt,
        total: who.length, done: who.length - missing.length, missing: missing.map((u) => ({ id: u.id, name: u.name })),
      };
    });
    return json(200, { people, documents });
  },

  // ── admin: přehled seznámení ──
  'GET admin/overview': async (req, { url }) => {
    await requireAdmin(req);
    const section = url.searchParams.get('section') || SECTION_IDS[0];
    if (!SECTION_IDS.includes(section) || PUBLIC_IDS.includes(section)) bad('Neznámá sekce.');
    const [users, allDocs, links] = await Promise.all([loadUsers(), loadDocs(), loadLinks()]);
    const docs = trackables(allDocs, links).filter((d) => d.section === section)
      .sort((a, b) => a.heading.localeCompare(b.heading, 'cs') || byOrder(a, b));
    const active = users.filter((u) => u.active);
    const rows = await Promise.all(active.map(async (u) => {
      const m = readMap(await loadReads(u.id));
      const cells = docs.map((d) => {
        const read = m.has(d.readKey);
        return read ? 'ok' : isMandatory(d, u) ? 'no' : 'na';
      });
      const relevant = docs.some((d) => isMandatory(d, u));
      return { id: u.id, name: u.name, positions: u.positions, cells, missing: cells.filter((c) => c === 'no').length, relevant };
    }));
    const columns = docs.map((d, i) => {
      const mand = rows.filter((r) => active.find((u) => u.id === r.id) && isMandatory(d, active.find((u) => u.id === r.id)));
      return {
        id: d.id, kind: d.kind, title: d.title, heading: d.heading, version: d.version, mandatoryFor: d.mandatoryFor,
        done: mand.filter((r) => r.cells[i] === 'ok').length, total: mand.length,
      };
    });
    rows.sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, 'cs'));
    return json(200, { section, columns, rows, totalUsers: active.length });
  },
};

// ── Směny (admin a provozní) ──
Object.assign(ROUTES, smenyRoutes({ json, body, requireShifts, requireUser, loadUsers }));
