// Směny – ukládání nastavení, dostupností, rotace a rozpisů. Jen pro adminy a provozní.
// Samotný návrh rozpisu se počítá v prohlížeči (public/smeny-engine.js); server data jen hlídá a ukládá.
import { getJSON, setJSON, deleteJSON, listKeys } from './store.mjs';
import { newId } from './auth.mjs';
import { HttpError } from './http.mjs';

const POSITION_KEYS = ['zaza-barman', 'zaza-plac', 'zaza-vypomoc', 'zaza-pizzar', 'zaza-zdobic', 'zaza-mycka', 'little-barman', 'little-zdobic', 'little-pizzar'];
const VENUES = ['zaza', 'little'];
const CONTRACTS = ['HPP', 'DPP+', 'DPP'];
const CODES = ['A', 'L', 'P', 'N', 'D', 'Z', ''];
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const MONTH_RE = /^20\d\d-(0[1-9]|1[0-2])$/;
const DATE_RE = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PID_RE = /^(usr|sme)_[A-Za-z0-9_-]{4,30}$/;

const bad = (msg) => { throw new HttpError(400, msg); };
const days = (list) => (Array.isArray(list) ? [...new Set(list.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : bad('Neplatné dny.'));
const limit = (v, label) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000) bad(`${label}: zadej číslo.`);
  return Math.round(n * 10) / 10;
};
const monthParam = (url) => {
  const m = url.searchParams.get('month') ?? '';
  if (!MONTH_RE.test(m)) bad('Neplatný měsíc.');
  return m;
};

function cleanConfig(b) {
  const out = { venues: {}, positions: [], rotation: {} };
  for (const v of VENUES) {
    out.venues[v] = { open: days(b?.venues?.[v]?.open ?? []) };
    const r = b?.rotation?.[v] ?? {};
    out.rotation[v] = { enabled: Boolean(r.enabled), L: days(r.L ?? []), S: days(r.S ?? []) };
    if (out.rotation[v].L.some((d) => out.rotation[v].S.includes(d))) bad('Den nemůže být zároveň v L i v S týdnu.');
  }
  for (const p of Array.isArray(b?.positions) ? b.positions : []) {
    if (!POSITION_KEYS.includes(p.key)) bad('Neznámá pozice.');
    const count = Number(p.count);
    if (!Number.isInteger(count) || count < 0 || count > 6) bad('Počet lidí na pozici: 0–6.');
    for (const r of [p.wd, p.we]) if (!Array.isArray(r) || r.length !== 2 || !r.every((t) => TIME_RE.test(t))) bad('Čas směny zadej jako 15:00.');
    const item = { key: p.key, count, wd: p.wd, we: p.we };
    if (p.months !== undefined) {
      if (!Array.isArray(p.months)) bad('Neplatné měsíce.');
      item.months = [...new Set(p.months.map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, c) => a - c);
    }
    out.positions.push(item);
  }
  return out;
}

function cleanStaff(b, base) {
  const positions = {};
  for (const [k, v] of Object.entries(b.positions ?? {})) {
    if (!POSITION_KEYS.includes(k)) bad('Neznámá pozice.');
    const n = Number(v);
    if ([1, 2, 3].includes(n)) positions[k] = n;
  }
  const nick = String(b.nick ?? '').trim();
  if (nick.length > 40) bad('Přezdívka je příliš dlouhá.');
  const out = {
    ...base,
    nick,
    contract: CONTRACTS.includes(b.contract) ? b.contract : 'DPP',
    agreed: [1, 2, 3].includes(Number(b.agreed)) ? Number(b.agreed) : 2,
    lead: Boolean(b.lead),
    isNew: Boolean(b.isNew),
    positions,
    rot: { zaza: Boolean(b.rot?.zaza), little: Boolean(b.rot?.little) },
    minShifts: limit(b.minShifts, 'Minimum směn'),
    maxShifts: limit(b.maxShifts, 'Maximum směn'),
    minHours: limit(b.minHours, 'Minimum hodin'),
    maxHours: limit(b.maxHours, 'Maximum hodin'),
    maxWeekend: limit(b.maxWeekend, 'Víkendové dny'),
    maxRun: limit(b.maxRun, 'Směny po sobě'),
    planActive: b.planActive !== false,
  };
  if (out.minShifts !== null && out.maxShifts !== null && out.minShifts > out.maxShifts) bad('Minimum směn je větší než maximum.');
  if (out.minHours !== null && out.maxHours !== null && out.minHours > out.maxHours) bad('Minimum hodin je větší než maximum.');
  return out;
}

const loadStaff = () => getJSON('smeny/staff', {});

// ───────── dostupnosti vyplňované v BaseCampu ─────────
const pad = (n) => String(n).padStart(2, '0');
// Dnešní datum v Praze (server běží v UTC).
const pragueToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date());
const shiftMonth = (m, d) => { const [y, mo] = m.split('-').map(Number); const dt = new Date(Date.UTC(y, mo - 1 + d, 1)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`; };
const daysIn = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const loadPeriods = async () => {
  const p = await getJSON('smeny/periods', {});
  return { rule: { openDay: p.rule?.openDay ?? 1, deadlineDay: p.rule?.deadlineDay ?? 16 }, months: p.months ?? {} };
};
// Stav měsíce: pending (ještě se neotevřel) / open (vyplňuje se) / closed (po uzávěrce).
function periodOf(month, periods, today = pragueToday()) {
  const prev = shiftMonth(month, -1);
  const o = periods.months[month] ?? {};
  const opens = o.opensAt ?? `${prev}-${pad(Math.min(periods.rule.openDay, daysIn(prev)))}`;
  const deadline = o.deadline ?? `${prev}-${pad(Math.min(periods.rule.deadlineDay, daysIn(prev)))}`;
  const status = today < opens ? 'pending' : today <= deadline ? 'open' : 'closed';
  return { month, opens, deadline, status, custom: Boolean(o.opensAt || o.deadline), remindedAt: o.remindedAt ?? null };
}
const respKey = (month, uid) => `smeny/resp/${month}/${uid}`;
async function loadResponses(month) {
  const keys = await listKeys(`smeny/resp/${month}/`);
  const out = {};
  await Promise.all(keys.map(async (k) => { const r = await getJSON(k, null); if (r) out[k.split('/').pop()] = r; }));
  return out;
}
// Kdo se plánuje do směn (má nastavené pozice a není vypnutý) – jen ty aplikace upomíná.
const isPlanned = (s) => Boolean(s && Object.keys(s.positions ?? {}).length && s.planActive !== false);

// Odznak a banner pro zaměstnance: otevřené měsíce, které ještě neodevzdal.
export async function availTodo(user) {
  const staff = await loadStaff();
  if (!isPlanned(staff[user.id])) return [];
  const periods = await loadPeriods();
  const today = pragueToday();
  const out = [];
  for (const d of [1, 2]) {
    const month = shiftMonth(today.slice(0, 7), d);
    const p = periodOf(month, periods, today);
    if (p.status !== 'open') continue;
    const r = await getJSON(respKey(month, user.id), null);
    if (!r?.done) out.push({ month, deadline: p.deadline, reminded: Boolean(p.remindedAt) });
  }
  return out;
}

// Seznam lidí pro plánování: aktivní účty z BaseCampu + lidé bez účtu přidaní jen ve Směnách.
// Dřív se „jméno v tabulce“ ukládalo VELKÝMI písmeny – jako přezdívku ho ukazujeme normálně („TERKA“ → „Terka“).
function niceNick(n) {
  const v = String(n ?? '').trim();
  if (v.length < 3 || v !== v.toLocaleUpperCase('cs') || v === v.toLocaleLowerCase('cs')) return v;
  return v.toLocaleLowerCase('cs').replace(/(^|[\s-])(\p{L})/gu, (m, a, c) => a + c.toLocaleUpperCase('cs'));
}

// Jednorázově: přezdívky („jména v tabulce“) uložené dřív ve Směnách se přesunou k účtům v BaseCampu.
export async function migrateNicks(users) {
  if (await getJSON('migrations/nick', null)) return false;
  const saved = await loadStaff();
  let changed = false;
  for (const u of users) {
    const n = niceNick(saved[u.id]?.nick);
    if (n && !u.nick && !users.some((x) => x.nick && x.nick.toLocaleUpperCase('cs') === n.toLocaleUpperCase('cs'))) { u.nick = n; changed = true; }
  }
  await setJSON('migrations/nick', { at: new Date().toISOString() });
  return changed;
}

async function staffList(loadUsers) {
  const [users, saved] = await Promise.all([loadUsers(), loadStaff()]);
  const out = [];
  for (const u of users.filter((x) => x.active)) {
    const s = saved[u.id] ?? {};
    // Přezdívka se u lidí s účtem bere z BaseCampu (starší „jména v tabulce“ přesune migrateNicks).
    out.push({ ...s, id: u.id, name: u.name, nick: u.nick ?? '', account: true, active: s.planActive !== false, configured: Boolean(saved[u.id]) });
  }
  for (const [id, s] of Object.entries(saved)) {
    if (!id.startsWith('sme_')) continue;
    out.push({ ...s, id, nick: niceNick(s.nick), account: false, active: s.planActive !== false, configured: true });
  }
  out.sort((a, b) => (a.nick || a.name).localeCompare(b.nick || b.name, 'cs'));
  return out;
}

const foldNick = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const cleanNick = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
// Přezdívka musí být jednoznačná – podle ní se páruje tabulka dostupností.
async function nickClash(loadUsers, nick, selfId) {
  if (!nick) return;
  const k = foldNick(nick);
  const [users, saved] = await Promise.all([loadUsers(), loadStaff()]);
  const u = users.find((x) => x.id !== selfId && x.active && foldNick(x.nick) === k);
  const p = Object.entries(saved).find(([id, v]) => id !== selfId && id.startsWith('sme_') && foldNick(v.nick) === k);
  if (u || p) bad(`Přezdívku „${nick}“ už má ${u ? u.name : p[1].name}.`);
}

export function smenyRoutes({ json, body, requireShifts, requireUser, loadUsers, saveUsers }) {
  return {
    'GET smeny/data': async (req, { url }) => {
      await requireShifts(req);
      const month = monthParam(url);
      const [config, staff, rotation, excel, plan, responses, periods] = await Promise.all([
        getJSON('smeny/config', null), staffList(loadUsers), getJSON('smeny/rotation', {}),
        getJSON(`smeny/avail/${month}`, null), getJSON(`smeny/plan/${month}`, null), loadResponses(month), loadPeriods(),
      ]);
      // Dostupnosti pro plánování: odpovědi z BaseCampu, kdo neodpověděl, tomu platí případný Excel.
      let availability = null;
      if (excel || Object.keys(responses).length) {
        availability = { ...(excel ?? { rows: [] }), people: { ...(excel?.people ?? {}) }, notes: {}, fromBasecamp: Object.keys(responses).length };
        for (const [uid, r] of Object.entries(responses)) {
          if (!(excel?.override && excel.people?.[uid])) availability.people[uid] = r.days;
          if (r.notes && Object.keys(r.notes).length) availability.notes[uid] = r.notes;
        }
      }
      const planned = staff.filter((s) => s.account && s.active && isPlanned(s));
      const respStats = { planned: planned.length, done: planned.filter((s) => responses[s.id]?.done).length };
      const respDone = Object.entries(responses).filter(([, r]) => r.done).map(([id]) => id);
      return json(200, { month, config, staff, rotation, availability, excel, plan, period: periodOf(month, periods), respStats, respDone, respIds: Object.keys(responses) });
    },

    // ── zaměstnanec: moje dostupnost ──
    'GET avail/me': async (req, { url }) => {
      const u = await requireUser(req);
      const periods = await loadPeriods();
      const today = pragueToday();
      const months = [0, 1, 2].map((d) => periodOf(shiftMonth(today.slice(0, 7), d), periods, today));
      const month = url.searchParams.get('month');
      const sel = months.find((m) => m.month === month) ?? months.find((m) => m.status === 'open') ?? months[1];
      const [mine, prev] = await Promise.all([getJSON(respKey(sel.month, u.id), null), getJSON(respKey(shiftMonth(sel.month, -1), u.id), null)]);
      return json(200, { months, period: sel, response: mine, previous: prev ? { days: prev.days } : null, days: daysIn(sel.month) });
    },

    'PUT avail/me': async (req, { url }) => {
      const u = await requireUser(req);
      const month = monthParam(url);
      const p = periodOf(month, await loadPeriods());
      if (p.status !== 'open') bad(p.status === 'pending' ? 'Tenhle měsíc se ještě nevyplňuje.' : 'Po uzávěrce už změny nejdou. Napiš provozní.');
      const b = await body(req);
      const n = daysIn(month);
      if (!Array.isArray(b.days) || b.days.length !== n || !b.days.every((c) => ['A', 'N', ''].includes(c))) bad('Neplatné dny.');
      const notes = {};
      for (const [d, t] of Object.entries(b.notes ?? {})) {
        const day = Number(d);
        const text = String(t ?? '').trim().slice(0, 200);
        if (Number.isInteger(day) && day >= 1 && day <= n && text) notes[day] = text;
      }
      const old = await getJSON(respKey(month, u.id), null);
      const done = Boolean(b.done) || Boolean(old?.done);
      const r = { days: b.days, notes, done, doneAt: done ? old?.doneAt ?? new Date().toISOString() : null, updatedAt: new Date().toISOString() };
      await setJSON(respKey(month, u.id), r);
      return json(200, { ok: true, response: r });
    },

    // ── všichni: dostupnosti týmu (kvůli výměnám směn) ──
    'GET avail/team': async (req, { url }) => {
      await requireUser(req);
      const month = monthParam(url);
      const [users, staff, responses, excel, plan, config] = await Promise.all([
        loadUsers(), loadStaff(), loadResponses(month), getJSON(`smeny/avail/${month}`, null), getJSON(`smeny/plan/${month}`, null), getJSON('smeny/config', null),
      ]);
      const people = users.filter((x) => x.active && (isPlanned(staff[x.id]) || responses[x.id]))
        .map((x) => ({ id: x.id, name: x.name, nick: x.nick ?? '', days: (excel?.override && excel.people?.[x.id]) || responses[x.id]?.days || excel?.people?.[x.id] || null, notes: responses[x.id]?.notes ?? {}, done: Boolean(responses[x.id]?.done) }))
        .sort((a, b) => (a.nick || a.name).localeCompare(b.nick || b.name, 'cs'));
      // Rozpis ukazujeme jen pro měsíce, které už běží (návrh na další měsíc je rozpracovaný).
      const live = month <= pragueToday().slice(0, 7);
      return json(200, { month, people, plan: live && plan ? { assign: plan.assign, lead: plan.lead ?? {} } : null, config, period: periodOf(month, await loadPeriods()) });
    },

    // ── provozní: termíny a připomínky ──
    'GET smeny/periods': async (req) => {
      await requireShifts(req);
      const periods = await loadPeriods();
      const today = pragueToday();
      const staff = await staffList(loadUsers);
      const planned = staff.filter((s) => s.account && s.active && isPlanned(s));
      const months = await Promise.all([1, 2].map(async (d) => {
        const month = shiftMonth(today.slice(0, 7), d);
        const resp = await loadResponses(month);
        return { ...periodOf(month, periods, today), planned: planned.length, done: planned.filter((s) => resp[s.id]?.done).length,
          missing: planned.filter((s) => !resp[s.id]?.done).map((s) => s.nick || s.name) };
      }));
      return json(200, { rule: periods.rule, months, today });
    },

    'PUT smeny/periods': async (req) => {
      await requireShifts(req);
      const b = await body(req);
      const raw = await getJSON('smeny/periods', {});
      const periods = { rule: raw.rule ?? { openDay: 1, deadlineDay: 16 }, months: raw.months ?? {} };
      if (b.rule) {
        const o = Number(b.rule.openDay); const dl = Number(b.rule.deadlineDay);
        if (![o, dl].every((x) => Number.isInteger(x) && x >= 1 && x <= 28)) bad('Dny zadej jako čísla 1–28.');
        if (o > dl) bad('Otevření musí být před uzávěrkou.');
        periods.rule = { openDay: o, deadlineDay: dl };
      }
      if (b.month !== undefined) {
        if (!MONTH_RE.test(b.month)) bad('Neplatný měsíc.');
        const m = { ...(periods.months[b.month] ?? {}) };
        for (const f of ['opensAt', 'deadline']) {
          if (b[f] === undefined) continue;
          if (b[f] === null) delete m[f];
          else if (!DATE_RE.test(b[f])) bad('Neplatné datum.');
          else m[f] = b[f];
        }
        if (b.action === 'close') m.deadline = new Date(Date.parse(`${pragueToday()}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
        periods.months[b.month] = m;
        if (b.action === 'open') {
          m.opensAt = pragueToday();
          // když by uzávěrka už byla za námi, dá se týden navíc
          if (periodOf(b.month, periods).deadline < pragueToday()) m.deadline = new Date(Date.parse(`${pragueToday()}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
        }
      }
      await setJSON('smeny/periods', periods);
      return json(200, { ok: true });
    },

    'POST smeny/remind': async (req, { url }) => {
      await requireShifts(req);
      const month = monthParam(url);
      const raw = await getJSON('smeny/periods', {});
      raw.months = raw.months ?? {};
      raw.months[month] = { ...(raw.months[month] ?? {}), remindedAt: new Date().toISOString() };
      await setJSON('smeny/periods', raw);
      return json(200, { ok: true });
    },

    'GET smeny/staff': async (req) => {
      await requireShifts(req);
      return json(200, { staff: await staffList(loadUsers) });
    },

    'PUT smeny/config': async (req) => {
      await requireShifts(req);
      const cfg = cleanConfig(await body(req));
      await setJSON('smeny/config', cfg);
      return json(200, { ok: true, config: cfg });
    },

    // Člověk bez účtu v BaseCampu (např. brigádník v kuchyni).
    'POST smeny/staff': async (req) => {
      await requireShifts(req);
      const b = await body(req);
      const name = String(b.name ?? '').trim();
      if (!name) bad('Zadej jméno.');
      if (name.length > 80) bad('Jméno je příliš dlouhé.');
      const nick = cleanNick(b.nick);
      await nickClash(loadUsers, nick, null);
      const all = await loadStaff();
      const id = newId('sme');
      all[id] = cleanStaff({ ...b, nick }, { name });
      await setJSON('smeny/staff', all);
      return json(200, { ok: true, id });
    },

    'PUT smeny/staff/:id': async (req, { id }) => {
      await requireShifts(req);
      const b = await body(req);
      const all = await loadStaff();
      let base = {};
      const nick = cleanNick(b.nick);
      if (nick.length > 30) bad('Přezdívka je příliš dlouhá (max. 30 znaků).');
      await nickClash(loadUsers, nick, id);
      if (id.startsWith('usr_')) {
        const users = await loadUsers();
        const u = users.find((x) => x.id === id && x.active);
        if (!u) throw new HttpError(404, 'Zaměstnanec neexistuje.');
        // Přezdívka patří k účtu v BaseCampu – změna se projeví všude.
        if (b.nick !== undefined && (u.nick ?? '') !== nick) { u.nick = nick; await saveUsers(users); }
      } else {
        if (!all[id]) throw new HttpError(404, 'Člověk neexistuje.');
        const name = String(b.name ?? all[id].name ?? '').trim();
        if (!name || name.length > 80) bad('Zadej jméno (max. 80 znaků).');
        base = { name };
      }
      all[id] = cleanStaff({ ...b, nick: id.startsWith('usr_') ? '' : nick }, base);
      await setJSON('smeny/staff', all);
      return json(200, { ok: true });
    },

    'DELETE smeny/staff/:id': async (req, { id }) => {
      await requireShifts(req);
      const all = await loadStaff();
      if (!all[id]) throw new HttpError(404, 'Člověk neexistuje.');
      if (id.startsWith('usr_')) bad('Lidé s účtem se mažou v Adminu.');
      delete all[id];
      await setJSON('smeny/staff', all);
      return json(200, { ok: true });
    },

    // Rotace L / S: { weeks: { "2026-10-05": { "usr_x": "L", ... } } } – posílají se jen změněné týdny.
    'PUT smeny/rotation': async (req) => {
      await requireShifts(req);
      const b = await body(req);
      const rot = await getJSON('smeny/rotation', {});
      for (const [week, map] of Object.entries(b.weeks ?? {})) {
        if (!DATE_RE.test(week)) bad('Neplatný týden.');
        const clean = {};
        for (const [pid, v] of Object.entries(map ?? {})) {
          if (!PID_RE.test(pid)) bad('Neplatný člověk.');
          if (['L', 'S', '-'].includes(v)) clean[pid] = v;
        }
        rot[week] = { ...(rot[week] ?? {}), ...clean };
      }
      // staré týdny (víc než rok) se mažou
      const cut = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
      for (const w of Object.keys(rot)) if (w < cut) delete rot[w];
      await setJSON('smeny/rotation', rot);
      return json(200, { ok: true, rotation: rot });
    },

    'PUT smeny/availability': async (req, { url }) => {
      await requireShifts(req);
      const month = monthParam(url);
      const b = await body(req);
      const people = {};
      for (const [pid, codes] of Object.entries(b.people ?? {})) {
        if (!PID_RE.test(pid)) bad('Neplatný člověk.');
        if (!Array.isArray(codes) || codes.length > 31 || !codes.every((c) => CODES.includes(c))) bad('Neplatné dostupnosti.');
        people[pid] = codes;
      }
      const rows = Array.isArray(b.rows) ? b.rows.slice(0, 120).map((r) => ({
        nick: String(r.nick ?? '').slice(0, 40), pid: PID_RE.test(r.pid ?? '') ? r.pid : null,
        codes: Array.isArray(r.codes) ? r.codes.slice(0, 31).map((c) => (CODES.includes(c) ? c : '')) : [],
      })) : [];
      // override = Excel má přednost i před tím, co lidé vyplnili v BaseCampu (záloha, když se něco pokazí).
      const data = { people, rows, override: Boolean(b.override), fileName: String(b.fileName ?? '').slice(0, 120), sheet: String(b.sheet ?? '').slice(0, 60), importedAt: new Date().toISOString() };
      await setJSON(`smeny/avail/${month}`, data);
      return json(200, { ok: true, availability: data });
    },

    'DELETE smeny/availability': async (req, { url }) => {
      await requireShifts(req);
      await deleteJSON(`smeny/avail/${monthParam(url)}`);
      return json(200, { ok: true });
    },

    'PUT smeny/plan': async (req, { url }) => {
      const me = await requireShifts(req);
      const month = monthParam(url);
      const b = await body(req);
      const assign = {};
      const entries = Object.entries(b.assign ?? {});
      if (entries.length > 2000) bad('Rozpis je příliš velký.');
      for (const [sid, pid] of entries) {
        const [date, key, idx] = sid.split('|');
        if (!DATE_RE.test(date) || !date.startsWith(month) || !POSITION_KEYS.includes(key) || !/^\d$/.test(idx ?? '')) bad('Neplatné místo v rozpisu.');
        if (pid !== null && !PID_RE.test(pid)) bad('Neplatný člověk v rozpisu.');
        assign[sid] = pid;
      }
      const pick = (obj, test) => Object.fromEntries(Object.entries(obj ?? {}).filter(([k, v]) => k in assign && test(v)));
      const lead = Object.fromEntries(Object.entries(b.lead ?? {}).filter(([d, pid]) => DATE_RE.test(d) && d.startsWith(month) && PID_RE.test(pid)));
      const plan = {
        assign, lead,
        flags: pick(b.flags, (v) => v === 'cover'),
        locked: pick(b.locked, (v) => v === true),
        edits: Math.max(0, Math.min(9999, Number(b.edits) || 0)),
        generatedAt: typeof b.generatedAt === 'string' ? b.generatedAt.slice(0, 30) : null,
        savedAt: new Date().toISOString(), savedBy: me.name,
      };
      await setJSON(`smeny/plan/${month}`, plan);
      return json(200, { ok: true, plan });
    },
  };
}
