// ZaZa-BaseCamp – plánovač směn. Čisté výpočty bez serveru: sloty, návrh rozpisu, kontrola.
// Běží v prohlížeči (stránky Směny) a dá se spustit i v Node pro testy.
(function (root) {
  const DAY_NAMES = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
  const DAY_LONG = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'];
  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const MONTHS_UP = ['LEDEN', 'ÚNOR', 'BŘEZEN', 'DUBEN', 'KVĚTEN', 'ČERVEN', 'ČERVENEC', 'SRPEN', 'ZÁŘÍ', 'ŘÍJEN', 'LISTOPAD', 'PROSINEC'];
  const CONTRACTS = ['HPP', 'DPP+', 'DPP'];
  const LEAD_KEYS = ['zaza-barman', 'zaza-plac'];

  const DEFAULT_CONFIG = {
    venues: {
      zaza: { name: 'ZaZa', open: [0, 1, 2, 3, 4, 5, 6] },
      little: { name: 'Little ZaZa', open: [1, 2, 3, 4, 5, 6] },
    },
    positions: [
      { key: 'zaza-barman', venue: 'zaza', group: 'ZaZa Bar', name: 'Barman', count: 1, wd: ['15:00', '23:00'], we: ['10:00', '22:00'] },
      { key: 'zaza-plac', venue: 'zaza', group: 'ZaZa Bar', name: 'Plac', count: 2, wd: ['15:00', '23:00'], we: ['10:00', '22:00'] },
      { key: 'zaza-vypomoc', venue: 'zaza', group: 'ZaZa Bar', name: 'Výpomoc', count: 1, wd: ['16:30', '21:00'], we: ['11:30', '21:00'], months: [4, 5, 6, 7, 8, 9, 10] },
      { key: 'zaza-pizzar', venue: 'zaza', group: 'ZaZa Kuchyň', name: 'Pizzař', count: 1, wd: ['11:00', '22:00'], we: ['06:30', '22:00'] },
      { key: 'zaza-zdobic', venue: 'zaza', group: 'ZaZa Kuchyň', name: 'Zdobič', count: 1, wd: ['13:30', '22:00'], we: ['09:00', '22:00'] },
      { key: 'zaza-mycka', venue: 'zaza', group: 'ZaZa Kuchyň', name: 'Myčka', count: 1, wd: ['13:30', '22:00'], we: ['09:30', '22:00'] },
      { key: 'little-barman', venue: 'little', group: 'Little ZaZa', name: 'Barman', count: 1, wd: ['15:00', '22:00'], we: ['10:30', '22:00'] },
      { key: 'little-zdobic', venue: 'little', group: 'Little ZaZa', name: 'Zdobič', count: 1, wd: ['13:00', '22:00'], we: ['10:00', '21:00'] },
      { key: 'little-pizzar', venue: 'little', group: 'Little ZaZa', name: 'Pizzař', count: 1, wd: ['13:30', '22:00'], we: ['10:00', '22:00'] },
    ],
    rotation: {
      zaza: { enabled: true, L: [0, 1, 4, 5, 6], S: [2, 3] },
      little: { enabled: false, L: [0, 1, 4, 5, 6], S: [2, 3] },
    },
  };
  const POSITION_KEYS = DEFAULT_CONFIG.positions.map((p) => p.key);
  const VENUES = ['zaza', 'little'];

  // Doplní uložené nastavení o chybějící části (nové verze aplikace, první spuštění).
  function normalizeConfig(cfg) {
    const c = cfg && typeof cfg === 'object' ? cfg : {};
    const out = { venues: {}, positions: [], rotation: {} };
    for (const v of VENUES) {
      const d = DEFAULT_CONFIG.venues[v];
      const s = c.venues?.[v] ?? {};
      out.venues[v] = { name: d.name, open: Array.isArray(s.open) ? s.open.filter((x) => x >= 0 && x <= 6) : [...d.open] };
      const dr = DEFAULT_CONFIG.rotation[v];
      const sr = c.rotation?.[v] ?? {};
      out.rotation[v] = {
        enabled: typeof sr.enabled === 'boolean' ? sr.enabled : dr.enabled,
        L: Array.isArray(sr.L) ? sr.L : [...dr.L],
        S: Array.isArray(sr.S) ? sr.S : [...dr.S],
      };
    }
    for (const d of DEFAULT_CONFIG.positions) {
      const s = (c.positions ?? []).find((p) => p.key === d.key) ?? {};
      out.positions.push({
        ...d,
        count: Number.isInteger(s.count) ? s.count : d.count,
        wd: validRange(s.wd) ? s.wd : [...d.wd],
        we: validRange(s.we) ? s.we : [...d.we],
        months: d.months ? (Array.isArray(s.months) ? s.months : [...d.months]) : undefined,
      });
    }
    return out;
  }
  const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const validRange = (r) => Array.isArray(r) && r.length === 2 && TIME_RE.test(r[0]) && TIME_RE.test(r[1]);
  const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const rangeHours = (r) => { let d = minutes(r[1]) - minutes(r[0]); if (d <= 0) d += 24 * 60; return d / 60; };

  // Nastavení zaměstnance: doplní výchozí hodnoty.
  function normalizeStaff(s) {
    const n = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.max(0, Math.round(Number(v) * 10) / 10));
    const pos = {};
    for (const k of POSITION_KEYS) { const v = Number(s?.positions?.[k]); if ([1, 2, 3].includes(v)) pos[k] = v; }
    return {
      id: s.id, name: s.name ?? '', nick: s.nick ?? '', contract: CONTRACTS.includes(s.contract) ? s.contract : 'DPP',
      agreed: [1, 2, 3].includes(Number(s.agreed)) ? Number(s.agreed) : 2, lead: Boolean(s.lead), isNew: Boolean(s.isNew),
      positions: pos, rot: { zaza: Boolean(s.rot?.zaza), little: Boolean(s.rot?.little) },
      minShifts: n(s.minShifts), maxShifts: n(s.maxShifts), minHours: n(s.minHours), maxHours: n(s.maxHours),
      maxWeekend: n(s.maxWeekend), maxRun: n(s.maxRun), active: s.active !== false, account: Boolean(s.account),
    };
  }

  // ── kalendář ──
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const toISO = (dt) => iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  const addDays = (s, n) => { const dt = parseISO(s); dt.setUTCDate(dt.getUTCDate() + n); return toISO(dt); };
  const dow = (s) => (parseISO(s).getUTCDay() + 6) % 7; // 0 = pondělí
  const weekStart = (s) => addDays(s, -dow(s));
  const isWeekend = (s) => dow(s) >= 5;
  const daysInMonth = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  const monthDays = (month) => { const [y, m] = month.split('-').map(Number); return Array.from({ length: daysInMonth(month) }, (_, i) => iso(y, m, i + 1)); };
  const fmtDay = (s) => { const dt = parseISO(s); return `${dt.getUTCDate()}. ${dt.getUTCMonth() + 1}.`; };
  const monthLabel = (month) => { const [y, m] = month.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const fmtHours = (h) => `${String(Math.round(h * 10) / 10).replace('.', ',')} h`;
  // Týdny, které zasahují do měsíce (pondělí).
  function monthWeeks(month) {
    const days = monthDays(month);
    const out = [];
    for (let w = weekStart(days[0]); w <= days[days.length - 1]; w = addDays(w, 7)) out.push(w);
    return out;
  }

  // ── sloty ──
  function buildSlots(cfg, month) {
    const m = Number(month.split('-')[1]);
    const slots = [];
    for (const date of monthDays(month)) {
      const d = dow(date);
      const we = d >= 5;
      for (const p of cfg.positions) {
        if (!cfg.venues[p.venue].open.includes(d)) continue;
        if (p.months && !p.months.includes(m)) continue;
        const range = we ? p.we : p.wd;
        for (let i = 0; i < p.count; i++) {
          slots.push({ id: `${date}|${p.key}|${i}`, date, dow: d, weekend: we, key: p.key, venue: p.venue, idx: i, from: range[0], to: range[1], hours: rangeHours(range) });
        }
      }
    }
    return slots;
  }
  const slotKeyOf = (id) => id.split('|')[1];
  const slotDateOf = (id) => id.split('|')[0];

  // ── dostupnost ──
  // A = ANO, L = jen Little, P = jen výpomoc, N = NE, D = dovolená, Z = zavřeno, '' = nevyplněno
  function codeFor(avail, pid, date) {
    const row = avail?.people?.[pid];
    if (!row) return '';
    return row[Number(date.slice(8, 10)) - 1] ?? '';
  }
  // Úroveň vhodnosti člověka na pozici: 1–3 (3 = nouze) nebo null = nejde.
  function tierFor(person, key, code) {
    const prio = person.positions[key];
    if (!prio) return null;
    if (code === 'A') return { tier: prio, flag: prio === 3 ? 'P3' : '' };
    if (code === 'L') return key.startsWith('little-') ? { tier: prio, flag: prio === 3 ? 'P3' : '' } : { tier: 3, flag: 'LITTLE' };
    if (code === 'P') return key === 'zaza-vypomoc' ? { tier: prio, flag: prio === 3 ? 'P3' : '' } : null;
    return null;
  }
  const CODE_LABEL = { A: 'ANO', L: 'jen Little', P: 'jen výpomoc', N: 'NE', D: 'dovolená', Z: 'zavřeno', '': 'nevyplněno' };

  // ── stav rozpisu během výpočtu ──
  function makeState(slots, staff) {
    return {
      slots, byId: new Map(slots.map((s) => [s.id, s])), assign: {}, flags: {},
      days: new Map(staff.map((p) => [p.id, new Set()])),
      hours: Object.fromEntries(staff.map((p) => [p.id, 0])),
      shifts: Object.fromEntries(staff.map((p) => [p.id, 0])),
      weekend: Object.fromEntries(staff.map((p) => [p.id, 0])),
    };
  }
  function place(st, slot, pid, flag) {
    st.assign[slot.id] = pid;
    if (flag) st.flags[slot.id] = flag; else delete st.flags[slot.id];
    if (!pid || !st.days.has(pid)) return;
    st.days.get(pid).add(slot.date);
    st.hours[pid] += slot.hours; st.shifts[pid] += 1; if (slot.weekend) st.weekend[pid] += 1;
  }
  function unplace(st, slot) {
    const pid = st.assign[slot.id];
    delete st.assign[slot.id]; delete st.flags[slot.id];
    if (!pid || !st.days.has(pid)) return;
    st.days.get(pid).delete(slot.date);
    st.hours[pid] -= slot.hours; st.shifts[pid] -= 1; if (slot.weekend) st.weekend[pid] -= 1;
  }
  function runLength(daySet, date) {
    let n = 1;
    for (let d = addDays(date, -1); daySet.has(d); d = addDays(d, -1)) n++;
    for (let d = addDays(date, 1); daySet.has(d); d = addDays(d, 1)) n++;
    return n;
  }
  // Tvrdá pravidla: nikdy se neporuší při automatickém návrhu.
  function fits(st, p, slot, { ignoreLimits = false } = {}) {
    const days = st.days.get(p.id);
    if (!p.active || days.has(slot.date)) return false;
    if (ignoreLimits) return true;
    if (p.maxShifts !== null && st.shifts[p.id] + 1 > p.maxShifts) return false;
    if (p.maxHours !== null && st.hours[p.id] + slot.hours > p.maxHours + 1e-9) return false;
    if (slot.weekend && p.maxWeekend !== null && st.weekend[p.id] + 1 > p.maxWeekend) return false;
    if (p.maxRun !== null && runLength(days, slot.date) > p.maxRun) return false;
    return true;
  }
  const belowMin = (st, p) => (p.minHours !== null && st.hours[p.id] < p.minHours) || (p.minShifts !== null && st.shifts[p.id] < p.minShifts);
  function target(p) {
    if (p.minHours !== null && p.maxHours !== null) return Math.max(1, (p.minHours + p.maxHours) / 2);
    if (p.maxHours !== null) return Math.max(1, p.maxHours * 0.75);
    if (p.minHours !== null) return Math.max(1, p.minHours * 1.1);
    if (p.maxShifts !== null) return Math.max(1, p.maxShifts * 8 * 0.75);
    return 100;
  }
  // Nižší skóre = vhodnější. Férovost: kdo má nejmenší podíl svého cíle, jde první.
  function score(st, p, ctx) {
    let s = st.hours[p.id] / target(p);
    s += CONTRACTS.indexOf(p.contract) * 0.2;
    s += (p.agreed - 1) * 0.1;
    if (belowMin(st, p)) s -= 1;
    if (ctx.leadBonus && p.lead) s -= 0.6;
    if (ctx.isNew && p.isNew) s += 0.05;
    return s;
  }
  function candidatesFor(st, slot, staff, avail, opts = {}) {
    const out = [];
    for (const p of staff) {
      if (opts.skip?.(p, slot)) continue;
      const t = tierFor(p, slot.key, codeFor(avail, p.id, slot.date));
      if (!t) continue;
      if (!fits(st, p, slot, opts)) continue;
      out.push({ p, tier: t.tier, flag: t.flag });
    }
    return out;
  }
  const dayHasLead = (st, date, staffMap) => st.slots.some((s) => s.date === date && LEAD_KEYS.includes(s.key) && staffMap.get(st.assign[s.id])?.lead);

  // ── rotace L / S ──
  function rotationType(cfg, venue, date) {
    const r = cfg.rotation[venue];
    const d = dow(date);
    if (r.L.includes(d)) return 'L';
    if (r.S.includes(d)) return 'S';
    return null;
  }

  // ── návrh rozpisu ──
  function generate({ config, staff: rawStaff, availability, rotation, month, keep }) {
    const cfg = normalizeConfig(config);
    const staff = rawStaff.map(normalizeStaff).filter((p) => p.active);
    const staffMap = new Map(staff.map((p) => [p.id, p]));
    const slots = buildSlots(cfg, month);
    const st = makeState(slots, staff);
    const locked = {};
    // 1) ruční úpravy, které se mají zachovat
    for (const [sid, pid] of Object.entries(keep?.assign ?? {})) {
      const slot = st.byId.get(sid);
      if (!slot || !keep.locked?.[sid]) continue;
      if (pid && staffMap.has(pid) && st.days.get(pid).has(slot.date)) continue;
      place(st, slot, pid && staffMap.has(pid) ? pid : null, keep.flags?.[sid] === 'cover' ? 'cover' : '');
      locked[sid] = true;
    }
    const open = (s) => !(s.id in st.assign);
    // 2) pizzaři podle rotace
    for (const venue of VENUES) {
      if (!cfg.rotation[venue].enabled) continue;
      const key = `${venue}-pizzar`;
      const members = staff.filter((p) => p.rot[venue] && p.positions[key]);
      for (const slot of slots.filter((s) => s.key === key && open(s))) {
        const type = rotationType(cfg, venue, slot.date);
        const week = rotation?.[weekStart(slot.date)] ?? {};
        const ok = (p) => tierFor(p, key, codeFor(availability, p.id, slot.date)) && fits(st, p, slot, { ignoreLimits: true });
        const own = members.filter((p) => type && week[p.id] === type);
        const main = own.find(ok);
        if (main) { place(st, slot, main.id, ''); continue; }
        if (own.length) {
          // Kdo má být podle rotace, nemůže – zaskočí jiný člen rotace, který ten den nemá směnu.
          const cover = members.filter((p) => !own.includes(p) && ok(p) && fits(st, p, slot))
            .sort((a, b) => score(st, a, {}) - score(st, b, {}))[0];
          if (cover) place(st, slot, cover.id, 'cover');
        }
      }
    }
    // 3) ostatní místa: vždy nejdřív to, které má nejméně možností.
    // Členy rotace na pizzaře tady nepoužíváme – plánuje je jen rotace (jinak by šli i ve volný den).
    const skip = (p, slot) => slot.key.endsWith('-pizzar') && cfg.rotation[slot.venue].enabled && p.rot[slot.venue];
    const gaveUp = new Set();
    for (;;) {
      let best = null;
      for (const slot of slots) {
        if (!open(slot) || gaveUp.has(slot.id)) continue;
        const c = candidatesFor(st, slot, staff, availability, { skip });
        const good = c.filter((x) => x.tier < 3).length;
        const key = good * 1000 + c.length;
        if (!best || key < best.key) best = { slot, cands: c, key };
        if (key === 0) break;
      }
      if (!best) break;
      const { slot, cands } = best;
      if (!cands.length) { gaveUp.add(slot.id); continue; }
      const minTier = Math.min(...cands.map((c) => c.tier));
      const leadBonus = LEAD_KEYS.includes(slot.key) && !dayHasLead(st, slot.date, staffMap);
      const pick = cands.filter((c) => c.tier === minTier)
        .map((c) => ({ ...c, s: score(st, c.p, { leadBonus }) }))
        .sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name, 'cs'))[0];
      place(st, slot, pick.p.id, pick.flag);
    }
    // 4) dorovnání minim: kdo je pod minimem, převezme směnu od někoho, kdo má rezervu
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const p of staff.filter((x) => belowMin(st, x))) {
        for (const slot of slots) {
          if (!belowMin(st, p)) break;
          const q = staffMap.get(st.assign[slot.id]);
          if (!q || q.id === p.id || locked[slot.id] || st.flags[slot.id] === 'cover') continue;
          if (cfg.rotation[slot.venue]?.enabled && slot.key.endsWith('-pizzar') && q.rot[slot.venue]) continue;
          if (belowMin(st, q)) continue;
          if (q.minHours !== null && st.hours[q.id] - slot.hours < q.minHours) continue;
          if (q.minShifts !== null && st.shifts[q.id] - 1 < q.minShifts) continue;
          const tq = tierFor(q, slot.key, codeFor(availability, q.id, slot.date));
          const tp = tierFor(p, slot.key, codeFor(availability, p.id, slot.date));
          if (!tp || (tq && tp.tier > tq.tier)) continue;
          const wasLead = q.lead && LEAD_KEYS.includes(slot.key);
          unplace(st, slot);
          if (!fits(st, p, slot) || (wasLead && !p.lead && !dayHasLead(st, slot.date, staffMap))) {
            place(st, slot, q.id, tq?.flag ?? '');
            continue;
          }
          place(st, slot, p.id, tp.flag);
          moved = true;
        }
      }
      if (!moved) break;
    }
    // 4b) vylepšení v rámci jednoho dne: výměny místo nouzových obsazení a doplnění prázdných míst přesunem
    const tierOf = (pid, slot) => { const p = staffMap.get(pid); const t = p && !skip(p, slot) ? tierFor(p, slot.key, codeFor(availability, pid, slot.date)) : null; return t ?? null; };
    const movable = (s) => !locked[s.id] && st.flags[s.id] !== 'cover' && !(cfg.rotation[s.venue]?.enabled && s.key.endsWith('-pizzar'));
    const byDate = new Map();
    for (const s of slots) { if (!byDate.has(s.date)) byDate.set(s.date, []); byDate.get(s.date).push(s); }
    for (const s1 of slots) {
      const x = st.assign[s1.id];
      if (!x || !movable(s1) || tierOf(x, s1)?.tier !== 3) continue;
      const fx = tierOf(x, s1).flag;
      for (const s2 of byDate.get(s1.date)) {
        const y = st.assign[s2.id];
        if (s2 === s1 || !y || !movable(s2)) continue;
        const tx = tierOf(x, s2); const ty = tierOf(y, s1);
        if (!tx || !ty || tx.tier === 3 || ty.tier === 3) continue;
        const fy = st.flags[s2.id] ?? '';
        unplace(st, s1); unplace(st, s2);
        if (fits(st, staffMap.get(x), s2) && fits(st, staffMap.get(y), s1)) { place(st, s2, x, tx.flag); place(st, s1, y, ty.flag); break; }
        place(st, s1, x, fx); place(st, s2, y, fy); // vrátit
      }
    }
    for (const allowEmergency of [false, true]) {
      for (const s1 of slots) {
        if (locked[s1.id] || st.assign[s1.id]) continue;
        for (const s2 of byDate.get(s1.date)) {
          const y = st.assign[s2.id];
          if (s2 === s1 || !y || !movable(s2)) continue;
          const ty = tierOf(y, s1);
          if (!ty || (!allowEmergency && ty.tier === 3)) continue;
          const keepFlag = st.flags[s2.id] ?? '';
          unplace(st, s2);
          if (!fits(st, staffMap.get(y), s1)) { place(st, s2, y, keepFlag); continue; }
          place(st, s1, y, ty.flag);
          const c = candidatesFor(st, s2, staff, availability, { skip }).filter((z) => allowEmergency || z.tier < 3)
            .sort((a, b) => a.tier - b.tier || score(st, a.p, {}) - score(st, b.p, {}));
          if (c.length) { place(st, s2, c[0].p.id, c[0].flag); break; }
          unplace(st, s1); place(st, s2, y, keepFlag);
        }
      }
    }
    // 5) vedoucí směny v ZaZa: když chybí, zkusí výměnu za někoho, kdo vést může
    const lead = {};
    const leadCount = {};
    for (const date of monthDays(month)) {
      const daySlots = slots.filter((s) => s.date === date && LEAD_KEYS.includes(s.key));
      if (!daySlots.length) continue;
      if (!dayHasLead(st, date, staffMap)) {
        outer: for (const slot of daySlots) {
          if (locked[slot.id]) continue;
          const cur = st.assign[slot.id];
          const curTier = cur ? tierFor(staffMap.get(cur), slot.key, codeFor(availability, cur, date))?.tier ?? 3 : 4;
          if (cur) unplace(st, slot);
          const c = candidatesFor(st, slot, staff, availability).filter((x) => x.p.lead && x.tier <= curTier)
            .sort((a, b) => a.tier - b.tier || score(st, a.p, {}) - score(st, b.p, {}));
          if (c.length) { place(st, slot, c[0].p.id, c[0].flag); break outer; }
          if (cur) place(st, slot, cur, tierFor(staffMap.get(cur), slot.key, codeFor(availability, cur, date))?.flag ?? '');
        }
      }
      const leaders = daySlots.map((s) => staffMap.get(st.assign[s.id])).filter((p) => p?.lead);
      const manual = keep?.lead?.[date];
      const chosen = leaders.find((p) => p.id === manual)
        ?? leaders.sort((a, b) => (leadCount[a.id] ?? 0) - (leadCount[b.id] ?? 0) || (a.positions['zaza-barman'] ? 0 : 1) - (b.positions['zaza-barman'] ? 0 : 1))[0];
      if (chosen) { lead[date] = chosen.id; leadCount[chosen.id] = (leadCount[chosen.id] ?? 0) + 1; }
    }
    const assign = {};
    for (const s of slots) assign[s.id] = st.assign[s.id] ?? null;
    const flags = {};
    for (const [k, v] of Object.entries(st.flags)) if (v === 'cover') flags[k] = v;
    return { assign, flags, lead, locked };
  }

  // ── kontrola rozpisu (po návrhu i po každé ruční změně) ──
  function evaluate({ config, staff: rawStaff, availability, month, plan }) {
    const cfg = normalizeConfig(config);
    const staff = rawStaff.map(normalizeStaff);
    const staffMap = new Map(staff.map((p) => [p.id, p]));
    const slots = buildSlots(cfg, month);
    const people = {};
    for (const p of staff) people[p.id] = { shifts: 0, hours: 0, weekend: 0, maxRunSeen: 0, leads: 0, days: new Set(), issues: [] };
    const slotInfo = {};
    const dayInfo = {};
    const assign = plan?.assign ?? {};
    const perDay = {};
    for (const s of slots) {
      const pid = assign[s.id] ?? null;
      const info = { state: pid ? 'ok' : 'empty', notes: [] };
      slotInfo[s.id] = info;
      if (!pid) continue;
      const p = staffMap.get(pid);
      if (!p) { info.state = 'bad'; info.notes.push('Člověk už není v seznamu'); continue; }
      const pp = people[pid];
      const key = `${pid}|${s.date}`;
      perDay[key] = (perDay[key] ?? 0) + 1;
      pp.days.add(s.date); pp.shifts++; pp.hours += s.hours; if (s.weekend) pp.weekend++;
      const code = codeFor(availability, pid, s.date);
      const t = tierFor(p, s.key, code);
      if (!p.positions[s.key]) { info.state = 'bad'; info.notes.push('Tuhle pozici nemá v nastavení'); }
      else if (!t && plan?.locked?.[s.id]) { info.state = 'warn'; info.tag = 'RUČNĚ'; info.notes.push(`Domluveno mimo tabulku (${CODE_LABEL[code]})`); }
      else if (!t) { info.state = 'bad'; info.notes.push(`V dostupnostech: ${CODE_LABEL[code]}`); }
      else if (t.flag === 'P3') { info.state = 'warn'; info.tag = 'P3'; info.notes.push('Pozice jen pro krajní nouzi'); }
      else if (t.flag === 'LITTLE') { info.state = 'warn'; info.tag = 'LITTLE'; info.notes.push('Chce jen do Little'); }
      if (plan?.flags?.[s.id] === 'cover') info.cover = true;
    }
    for (const [key, n] of Object.entries(perDay)) {
      if (n < 2) continue;
      const [pid, date] = key.split('|');
      for (const s of slots) if (s.date === date && assign[s.id] === pid) { slotInfo[s.id].state = 'bad'; slotInfo[s.id].notes.push('Ten den má víc směn'); }
    }
    for (const date of monthDays(month)) {
      const ls = slots.filter((s) => s.date === date && LEAD_KEYS.includes(s.key));
      if (!ls.length) continue;
      const leaders = ls.map((s) => assign[s.id]).filter((pid) => staffMap.get(pid)?.lead);
      const chosen = leaders.includes(plan?.lead?.[date]) ? plan.lead[date] : leaders[0] ?? null;
      dayInfo[date] = { lead: chosen, noLead: !chosen && ls.some((s) => assign[s.id]) };
      if (chosen) people[chosen].leads++;
    }
    const summary = { empty: 0, warn: 0, bad: 0, underMin: 0, over: 0, noLead: 0, slots: slots.length };
    for (const v of Object.values(slotInfo)) { if (v.state === 'empty') summary.empty++; if (v.state === 'warn') summary.warn++; if (v.state === 'bad') summary.bad++; }
    for (const d of Object.values(dayInfo)) if (d.noLead) summary.noLead++;
    for (const p of staff) {
      const r = people[p.id];
      let run = 0; let best = 0; let prev = null;
      for (const d of [...r.days].sort()) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
      r.maxRunSeen = best;
      if (p.maxHours !== null && r.hours > p.maxHours + 1e-9) r.issues.push({ kind: 'over', text: `nad maximem hodin (${p.maxHours} h)` });
      if (p.maxShifts !== null && r.shifts > p.maxShifts) r.issues.push({ kind: 'over', text: `nad maximem směn (${p.maxShifts})` });
      if (p.maxWeekend !== null && r.weekend > p.maxWeekend) r.issues.push({ kind: 'over', text: `moc víkendových dnů (max ${p.maxWeekend})` });
      if (p.maxRun !== null && best > p.maxRun) r.issues.push({ kind: 'over', text: `${best} směn po sobě (max ${p.maxRun})` });
      if (p.active && ((p.minHours !== null && r.hours < p.minHours) || (p.minShifts !== null && r.shifts < p.minShifts))) r.issues.push({ kind: 'under', text: 'pod minimem' });
      if (p.active && p.maxWeekend !== null && r.weekend === p.maxWeekend && p.maxWeekend > 0 && !r.issues.length) r.issues.push({ kind: 'info', text: 'víkendy na maximu' });
      if (r.issues.some((i) => i.kind === 'over')) summary.over++;
      if (r.issues.some((i) => i.kind === 'under')) summary.underMin++;
      r.days = [...r.days];
    }
    return { slots, slotInfo, dayInfo, people, summary, cfg, staff };
  }

  // Kdo připadá v úvahu pro jedno místo (dialog ruční změny).
  function optionsForSlot({ config, staff: rawStaff, availability, month, plan, slotId }) {
    const cfg = normalizeConfig(config);
    const staff = rawStaff.map(normalizeStaff).filter((p) => p.active);
    const slots = buildSlots(cfg, month);
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return null;
    const st = makeState(slots, staff);
    for (const s of slots) { const pid = plan?.assign?.[s.id]; if (pid && st.days.has(pid) && s.id !== slotId) place(st, s, pid, ''); }
    const current = plan?.assign?.[slotId] ?? null;
    const rows = staff.map((p) => {
      const code = codeFor(availability, p.id, slot.date);
      const t = tierFor(p, slot.key, code);
      const busy = st.days.get(p.id).has(slot.date);
      const warn = [];
      if (p.maxHours !== null && st.hours[p.id] + slot.hours > p.maxHours) warn.push(`přes max. ${p.maxHours} h`);
      if (p.maxShifts !== null && st.shifts[p.id] + 1 > p.maxShifts) warn.push(`přes max. ${p.maxShifts} směn`);
      if (slot.weekend && p.maxWeekend !== null && st.weekend[p.id] + 1 > p.maxWeekend) warn.push(`přes max. ${p.maxWeekend} víkendových dnů`);
      if (!busy && p.maxRun !== null) { const run = runLength(st.days.get(p.id), slot.date); if (run > p.maxRun) warn.push(`${run}. směna v řadě (max ${p.maxRun})`); }
      let group = 'no';
      let reason = '';
      if (!p.positions[slot.key]) reason = 'Tuhle pozici nedělá';
      else if (busy) reason = 'Ten den už má směnu';
      else if (!t && code === '') { group = 'ask'; reason = 'Nevyplnil/a – dá se zeptat'; }
      else if (!t) reason = `V dostupnostech: ${CODE_LABEL[code]}`;
      else if (t.tier === 3) group = 'emergency';
      else group = 'can';
      return {
        id: p.id, name: p.name, contract: p.contract, isNew: p.isNew, lead: p.lead, tier: t?.tier ?? p.positions[slot.key] ?? null, flag: t?.flag ?? '',
        group, reason, warn, before: st.hours[p.id], after: st.hours[p.id] + slot.hours, minHours: p.minHours, maxHours: p.maxHours,
        below: belowMin(st, p), current: p.id === current, s: score(st, p, {}) + (warn.length ? 5 : 0),
        note: availability?.notes?.[p.id]?.[Number(slot.date.slice(8, 10))] ?? '',
      };
    }).filter((r) => r.group !== 'no' || r.reason !== 'Tuhle pozici nedělá' || r.current);
    const G = { can: 0, emergency: 1, ask: 2, no: 3 };
    rows.sort((a, b) => G[a.group] - G[b.group] || (a.tier ?? 9) - (b.tier ?? 9) || a.s - b.s || a.name.localeCompare(b.name, 'cs'));
    return { slot, rows };
  }

  // ── tabulka dostupností (Excel) ──
  const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  function codeFromCell(v) {
    const t = fold(v);
    if (!t) return '';
    if (t.startsWith('ANO')) return 'A';
    if (t.startsWith('LITTLE')) return 'L';
    if (t.startsWith('POMOC') || t.startsWith('VYPOMOC')) return 'P';
    if (t.startsWith('DOV')) return 'D';
    if (t.startsWith('ZAV')) return 'Z';
    if (t === 'NE' || t.startsWith('NE ') || t.startsWith('NEMU')) return 'N';
    return '';
  }
  const sheetNameFor = (month) => { const [y, m] = month.split('-').map(Number); return `${MONTHS_UP[m - 1]} ${y}`; };
  // rows: pole řádků (pole buněk) jednoho listu, jak je vrátí čtečka Excelu.
  function parseSheetRows(rows, month) {
    const n = daysInMonth(month);
    const [y, m] = month.split('-').map(Number);
    let dateRow = rows.findIndex((r) => fold(r?.[0]).startsWith('DATUM'));
    const colForDay = {};
    if (dateRow >= 0) {
      rows[dateRow].forEach((v, ci) => {
        if (ci === 0 || v === null || v === undefined || v === '') return;
        let d = null;
        if (v instanceof Date) { if (v.getFullYear() === y && v.getMonth() + 1 === m) d = v.getDate(); }
        else if (typeof v === 'number' && v > 20000 && v < 80000) { const dt = new Date(Date.UTC(1899, 11, 30) + v * 86400000); if (dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m) d = dt.getUTCDate(); }
        else { const mm = String(v).match(/^(\d{1,2})\.\s*(\d{1,2})\./); if (mm && Number(mm[2]) === m) d = Number(mm[1]); }
        if (d && !colForDay[d]) colForDay[d] = ci;
      });
    }
    if (Object.keys(colForDay).length < n / 2) { for (let d = 1; d <= n; d++) colForDay[d] = d; dateRow = Math.max(dateRow, 1); }
    const people = [];
    for (let ri = dateRow + 1; ri < rows.length; ri++) {
      const r = rows[ri] ?? [];
      const name = String(r[0] ?? '').trim();
      if (!name || /^(DEN|DATUM|CHYB)/.test(fold(name))) continue;
      const codes = [];
      for (let d = 1; d <= n; d++) codes.push(codeFromCell(r[colForDay[d]]));
      people.push({ nick: name, codes });
    }
    return people;
  }
  const nickMatch = (a, b) => fold(a) !== '' && fold(a) === fold(b);

  const api = {
    DAY_NAMES, DAY_LONG, MONTHS, CONTRACTS, LEAD_KEYS, DEFAULT_CONFIG, POSITION_KEYS, VENUES, CODE_LABEL,
    normalizeConfig, normalizeStaff, buildSlots, generate, evaluate, optionsForSlot, rotationType,
    monthDays, monthWeeks, weekStart, addDays, dow, isWeekend, fmtDay, monthLabel, fmtHours, rangeHours,
    slotKeyOf, slotDateOf, codeFor, tierFor, parseSheetRows, sheetNameFor, codeFromCell, nickMatch, fold, TIME_RE,
  };
  root.SmenyEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
