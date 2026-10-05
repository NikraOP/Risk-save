'use strict';
/* Редактор профиля Risk of Rain 2.
   Что где лежит в файле профиля (UserProfile/*.xml):
   - achievementsList   — достижения через пробел;
   - stats > unlock     — всё открытое: Characters.*, Skills.*, Skins.*, Items.*, Artifacts.*, Logs.*, Eclipse.* …;
   - discoveredPickups  — что видели в логбуке: ItemIndex.*, EquipmentIndex.*, DroneIndex.*;
   - coins              — лунные монеты.
   Важно: если достижение есть в профиле, игра при входе сама выдаёт его награду.
   Поэтому, закрывая открытие, убираем и достижения, которые его дают. */

const G = window.GAME;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let lang = 'ru';
try { lang = localStorage.getItem('ror2-lang') || 'ru'; } catch (e) {}
const T = n => (n ? n[lang] || n.en || n.ru : '');

// ---------- состояние ----------
const S = {
  doc: null, fileName: '', apiPath: null, originalText: '',
  ach: [], unlocks: [], disc: [], coins: 0,
  achSet: new Set(), unlockSet: new Set(), discSet: new Set(),
  dirty: false, history: [],
  page: 'overview', survivor: null, tierFilter: 'all', search: '',
};

const achByReward = {};
for (const a of G.achievements) if (a.reward) (achByReward[a.reward] = achByReward[a.reward] || []).push(a);
const achById = Object.fromEntries(G.achievements.map(a => [a.id, a]));
const unlockName = buildUnlockNames();

function buildUnlockNames() {
  const m = {};
  const put = (u, n) => { if (u && n) m[u] = n; };
  G.survivors.forEach(s => put(s.unlock, s.name));
  G.skills.forEach(s => put(s.unlock, s.name));
  G.skins.forEach(s => {
    const sv = G.survivors.find(x => x.body === s.body);
    put(s.unlock, { ru: s.name.ru + ' · ' + (sv ? sv.name.ru : ''), en: s.name.en + ' · ' + (sv ? sv.name.en : '') });
  });
  G.items.forEach(s => put(s.unlock, s.name));
  G.equipment.forEach(s => put(s.unlock, s.name));
  G.artifacts.forEach(s => put(s.unlock, s.name));
  G.monsterLogs.forEach(s => put(s.id, s.name));
  G.stageLogs.forEach(s => put(s.id, s.name));
  return m;
}

// ---------- чтение ----------
function loadText(text, name) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root.nodeName !== 'UserProfile') {
    throw new Error('Это не файл профиля Risk of Rain 2. Нужен .xml из папки UserProfiles.');
  }
  S.doc = doc; S.fileName = name || 'profile.xml'; S.originalText = text;
  const words = tag => (child(tag)?.textContent || '').split(/\s+/).filter(Boolean);
  S.ach = words('achievementsList');
  S.disc = words('discoveredPickups');
  const stats = child('stats');
  S.unlocks = stats ? [...stats.children].filter(e => e.nodeName === 'unlock').map(e => e.textContent.trim()) : [];
  S.coins = parseInt(child('coins')?.textContent || '0', 10) || 0;
  syncSets();
  S.dirty = false; S.history = [];
  S.survivor = G.survivors[0].body;
}
function child(tag) { return [...S.doc.documentElement.children].find(e => e.nodeName === tag) || null; }
function ensureChild(tag) {
  let el = child(tag);
  if (!el) { el = S.doc.createElement(tag); S.doc.documentElement.appendChild(el); }
  return el;
}
function syncSets() {
  S.achSet = new Set(S.ach); S.unlockSet = new Set(S.unlocks); S.discSet = new Set(S.disc);
}

// ---------- запись ----------
function buildXml() {
  ensureChild('achievementsList').textContent = S.ach.join(' ');
  ensureChild('discoveredPickups').textContent = S.disc.join(' ');
  ensureChild('coins').textContent = String(S.coins);
  const stats = ensureChild('stats');
  [...stats.children].filter(e => e.nodeName === 'unlock').forEach(e => e.remove());
  for (const u of S.unlocks) {
    const el = S.doc.createElement('unlock');
    el.textContent = u;
    stats.appendChild(el);
  }
  // пустые теги повторяем в том виде, как они были в исходном файле: <tag /> или <tag></tag>
  const selfClosed = new Set([...S.originalText.matchAll(/<([A-Za-z_][\w.-]*) \/>/g)].map(m => m[1]));
  const body = new XMLSerializer().serializeToString(S.doc.documentElement)
    .replace(/<([A-Za-z_][\w.-]*)\/>/g, (m, t) => (selfClosed.has(t) ? `<${t} />` : `<${t}></${t}>`));
  return '<?xml version="1.0" encoding="utf-8"?>' + body;
}

async function save() {
  const xml = buildXml();
  if (S.apiPath) {
    // запущено через start.bat: сервер пишет прямо в файл Steam и сам делает копию
    try {
      const r = await fetch('/api/profile?path=' + encodeURIComponent(S.apiPath), { method: 'POST', body: xml });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      S.dirty = false; S.originalText = xml; refreshChrome();
      toast('Сохранено в профиль. Старая версия: ' + j.backup);
    } catch (e) {
      toast('Не сохранилось: ' + e.message);
    }
    return;
  }
  download(xml, S.fileName);
  S.dirty = false; refreshChrome();
  toast('Файл скачан. Замени им старый в папке UserProfiles.');
}
function download(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- изменения ----------
function snapshot() {
  S.history.push({ ach: S.ach.slice(), unlocks: S.unlocks.slice(), disc: S.disc.slice(), coins: S.coins });
  if (S.history.length > 100) S.history.shift();
}
function undo() {
  const h = S.history.pop(); if (!h) return;
  Object.assign(S, h); syncSets(); S.dirty = S.history.length > 0; render();
}
function change(fn) { snapshot(); fn(); syncSets(); S.dirty = true; render(); }

const addTo = (arr, set, v) => { if (v && !set.has(v)) { arr.push(v); set.add(v); } };
const removeFrom = (key, set, vals) => {
  const rm = new Set([].concat(vals).filter(v => set.has(v)));
  if (rm.size) S[key] = S[key].filter(v => !rm.has(v));
};

function setUnlock(id, on) {
  if (!id) return;
  if (on) addTo(S.unlocks, S.unlockSet, id);
  else {
    removeFrom('unlocks', S.unlockSet, id);
    // иначе игра выдаст открытие обратно по достижению
    removeFrom('ach', S.achSet, (achByReward[id] || []).map(a => a.id));
  }
}
function setDisc(p, on) {
  if (!p) return;
  if (on) addTo(S.disc, S.discSet, p); else removeFrom('disc', S.discSet, p);
}
function setAch(id, on) {
  const a = achById[id];
  if (on) { addTo(S.ach, S.achSet, id); if (a && a.reward) addTo(S.unlocks, S.unlockSet, a.reward); }
  else removeFrom('ach', S.achSet, id);
}

// Состояние объекта: 'on' | 'off' | 'part' (открыт, но не в логбуке, или наоборот)
function pickupState(x) {
  const u = x.unlock ? S.unlockSet.has(x.unlock) : null;
  const d = x.pickup ? S.discSet.has(x.pickup) : null;
  const parts = [u, d].filter(v => v !== null);
  if (parts.every(Boolean)) return 'on';
  if (parts.some(Boolean)) return 'part';
  return 'off';
}
function setPickup(x, on) { setUnlock(x.unlock, on); setDisc(x.pickup, on); }

const isOn = u => !u || S.unlockSet.has(u);

// ---------- разделы ----------
const PAGES = [
  { id: 'overview', title: 'Профиль' },
  { id: 'survivors', title: 'Выжившие', count: () => cnt(G.survivors.filter(s => s.unlock), s => isOn(s.unlock)) },
  { id: 'loadout', title: 'Навыки и скины', count: () => cnt([...G.skills, ...G.skins].filter(s => s.unlock), s => isOn(s.unlock)) },
  { id: 'items', title: 'Предметы', count: () => cnt(G.items, x => pickupState(x) === 'on') },
  { id: 'equipment', title: 'Снаряжение', count: () => cnt(G.equipment, x => pickupState(x) === 'on') },
  { id: 'artifacts', title: 'Артефакты', count: () => cnt(G.artifacts, a => isOn(a.unlock)) },
  { id: 'logbook', title: 'Логбук', count: () => cnt([...G.monsterLogs, ...G.stageLogs], l => S.unlockSet.has(l.id)) },
  { id: 'achievements', title: 'Достижения', count: () => cnt(G.achievements, a => S.achSet.has(a.id)) },
  { id: 'other', title: 'Прочее' },
];
function cnt(list, f) { return list.filter(f).length + '/' + list.length; }

const TIERS = [
  ['Tier1', 'Обычные', 'Common', '--t-white'],
  ['Tier2', 'Необычные', 'Uncommon', '--t-green'],
  ['Tier3', 'Легендарные', 'Legendary', '--t-red'],
  ['Boss', 'Боссовые', 'Boss', '--t-boss'],
  ['Lunar', 'Лунные', 'Lunar', '--t-lunar'],
  ['VoidTier1', 'Пустота: обычные', 'Void common', '--t-void'],
  ['VoidTier2', 'Пустота: необычные', 'Void uncommon', '--t-void'],
  ['VoidTier3', 'Пустота: легендарные', 'Void legendary', '--t-void'],
  ['VoidBoss', 'Пустота: боссовые', 'Void boss', '--t-void'],
  ['FoodTier', 'Еда', 'Food', '--t-food'],
];
const DLC = { DLC1: 'SotV', DLC2: 'SotS', DLC3: 'AC' };
const DLC_FULL = { DLC1: 'Survivors of the Void', DLC2: 'Seekers of the Storm', DLC3: 'Alloyed Collective' };
const SLOTS = { primary: ['Основной', 'Primary'], secondary: ['Вторичный', 'Secondary'], utility: ['Вспомогательный', 'Utility'], special: ['Особый', 'Special'], other: ['Пассивный', 'Passive'] };
const L = (ru, en) => (lang === 'ru' ? ru : en);

function icon(atlas, i, size) {
  if (i == null || i < 0) return `<div class="ic" style="--tile:${size || 56}px"></div>`;
  const s = size || 56, k = s / G.cell, cols = G.cols;
  return `<div class="ic" style="--tile:${s}px;background-image:url(data/icons-${atlas}.png);background-size:${cols * G.cell * k}px auto;background-position:-${(i % cols) * s}px -${Math.floor(i / cols) * s}px"></div>`;
}
function stateMark(st) { return `<span class="state">${st === 'on' ? '✓' : st === 'part' ? '½' : ''}</span>`; }
function matches(x) {
  if (!S.search) return true;
  const q = S.search.toLowerCase();
  return [x.name?.ru, x.name?.en, x.id].some(v => v && v.toLowerCase().includes(q));
}

function head(title, desc, actions) {
  return `<div class="head"><div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ''}</div><div class="head-actions">${actions || ''}</div></div>`;
}
function bulk(scope) {
  return `<button class="btn small" data-bulk="${scope}" data-on="1">${L('Открыть все', 'Unlock all')}</button>` +
         `<button class="btn small danger" data-bulk="${scope}" data-on="0">${L('Закрыть все', 'Lock all')}</button>`;
}

// ---------- страницы ----------
const RENDER = {
  overview() {
    const stats = PAGES.filter(p => p.count).map(p => {
      const [a, b] = p.count().split('/').map(Number);
      return `<button class="stat" data-go="${p.id}"><div class="stat-top"><span>${p.title}</span><span>${Math.round(a / b * 100) || 0}%</span></div>
        <div class="stat-num">${a} <span style="color:var(--muted);font-size:15px">/ ${b}</span></div><div class="bar"><b style="width:${a / b * 100}%"></b></div></button>`;
    }).join('');
    return head(L('Профиль', 'Profile'), L('Сводка по сохранению. Нажми на карточку, чтобы перейти в раздел.', 'Save summary. Click a card to open the section.')) +
      `<div class="stats">${stats}</div>
      <div class="panel"><h3>${L('Лунные монеты', 'Lunar coins')}</h3>
        <p>${L('Валюта для Базара между временем. Больше 2 147 483 647 игра не поддерживает.', 'Currency for the Bazaar. The game caps it at 2,147,483,647.')}</p>
        <div class="coins"><input class="num" id="coinsInput" type="number" min="0" max="2147483647" value="${S.coins}">
        <button class="btn small" data-coins="1000">1 000</button><button class="btn small" data-coins="99999">99 999</button><button class="btn small" data-coins="2147483647">${L('Максимум', 'Max')}</button></div></div>
      <div class="panel"><h3>${L('Всё сразу', 'Everything at once')}</h3>
        <p>${L('Открыть всё — это все достижения, персонажи, навыки, скины, предметы, артефакты, логи и уровни Затмения. Закрыть всё — профиль как с нуля, монеты и статистика останутся.', 'Unlock all adds every achievement, survivor, skill, skin, item, artifact, log and Eclipse level. Lock all resets progress; coins and stats stay.')}</p>
        <div class="big-actions"><button class="btn primary" data-all="1">${L('Открыть всё', 'Unlock everything')}</button>
        <button class="btn danger" data-all="0">${L('Закрыть всё', 'Lock everything')}</button></div>
        <div class="note">${L('Персонажи из DLC доступны в игре, только если DLC куплено. Флаги в сохранении это не обходят.', 'DLC survivors are only playable if you own the DLC; save flags do not change that.')}</div></div>`;
  },

  survivors() {
    const cards = G.survivors.map(s => {
      const on = isOn(s.unlock);
      const ecl = G.eclipse.filter(e => e.startsWith('Eclipse.' + s.id + '.'));
      let eclSel = '';
      if (ecl.length) {
        const lvl = 1 + ecl.filter(e => S.unlockSet.has(e)).length;
        eclSel = `<label class="card-sub">${L('Затмение', 'Eclipse')} <select class="sel" data-eclipse="${s.id}">${
          Array.from({ length: ecl.length + 1 }, (_, i) => `<option value="${i + 1}" ${i + 1 === lvl ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>`;
      }
      const src = s.unlock && achByReward[s.unlock] && achByReward[s.unlock][0];
      const sub = s.unlock ? (src ? L('Достижение «', 'Achievement “') + esc(T(src.name)) + L('»', '”') : L('Открывается в игре', 'Unlocked in game'))
        : s.dlc ? L('Открывается вместе с DLC ', 'Comes with DLC ') + DLC_FULL[s.dlc] : L('Доступен с начала', 'Available from start');
      return `<div class="card ${on ? '' : 'off'}">${icon('survivors', s.icon, 64)}<div>
        <div class="card-name">${esc(T(s.name))}</div><div class="card-sub">${sub}</div>
        <div class="card-ctl">${s.unlock ? sw('surv', s.unlock, on, L('Открыт', 'Unlocked')) : ''}${eclSel}</div></div></div>`;
    }).join('');
    return head(L('Выжившие', 'Survivors'), L('Персонажи и уровень Затмения, до которого он открыт.', 'Survivors and their unlocked Eclipse level.'), bulk('survivors')) + `<div class="cards">${cards}</div>`;
  },

  loadout() {
    const tabs = G.survivors.map(s => `<button class="surv-tab ${S.survivor === s.body ? 'on' : ''}" data-surv="${s.body}">${icon('survivors', s.icon, 30)}${esc(T(s.name))}</button>`).join('');
    const sv = G.survivors.find(s => s.body === S.survivor);
    const skills = G.skills.filter(s => s.body === S.survivor);
    const slots = [...new Set(skills.map(s => s.slot))];
    const rows = slots.map(slot => `<div class="slot-row"><div class="slot-name">${L(...SLOTS[slot])}</div><div class="tiles wide">${
      skills.filter(s => s.slot === slot).map(s => unlockTile('skills', s)).join('')}</div></div>`).join('');
    const skins = G.skins.filter(s => s.body === S.survivor).map(s => unlockTile('skins', s)).join('');
    return head(L('Навыки и скины', 'Skills & skins'), L('Навыки без замка доступны всегда. Нажми на плитку, чтобы открыть или закрыть.', 'Skills without a lock are always available. Click a tile to toggle.'), bulk('loadout:' + S.survivor)) +
      `<div class="surv-tabs">${tabs}</div>
      <div class="group"><div class="group-head"><h3>${L('Навыки', 'Skills')} · ${esc(T(sv.name))}</h3></div>${rows}</div>
      <div class="group"><div class="group-head"><h3>${L('Скины', 'Skins')}</h3></div><div class="tiles wide">${skins}</div></div>`;
  },

  items() {
    const chips = [['all', L('Все', 'All'), null], ...TIERS.map(t => [t[0], L(t[1], t[2]), t[3]])]
      .filter(([id]) => id === 'all' || G.items.some(i => i.tier === id))
      .map(([id, n, c]) => `<button class="chip ${S.tierFilter === id ? 'on' : ''}" data-tier="${id}">${c ? `<span class="dot" style="background:var(${c})"></span>` : ''}${n}</button>`).join('');
    const groups = TIERS.filter(t => S.tierFilter === 'all' || S.tierFilter === t[0]).map(t => {
      const list = G.items.filter(i => i.tier === t[0] && matches(i));
      if (!list.length) return '';
      return group(L(t[1], t[2]), list, 'items', 'items:' + t[0], `var(${t[3]})`);
    }).join('');
    return head(L('Предметы', 'Items'), L('Зелёная галочка — предмет открыт и есть в логбуке. «½» — только одно из двух.', 'Green check: unlocked and in the logbook. "½" means only one of the two.'), bulk('items')) +
      `<div class="toolbar"><input class="search" id="search" placeholder="${L('Поиск по названию', 'Search')}" value="${esc(S.search)}">${chips}</div>${groups || `<div class="empty">${L('Ничего не найдено', 'Nothing found')}</div>`}`;
  },

  equipment() {
    const kinds = [
      [L('Обычное', 'Regular'), e => !e.lunar && !e.elite, '--t-equip'],
      [L('Лунное', 'Lunar'), e => e.lunar && !e.elite, '--t-lunar'],
      [L('Аспекты элиты', 'Elite aspects'), e => e.elite, '--t-boss'],
    ];
    const groups = kinds.map(([n, f, c], i) => {
      const list = G.equipment.filter(e => f(e) && matches(e));
      return list.length ? group(n, list, 'equipment', 'equipment:' + i, `var(${c})`) : '';
    }).join('');
    return head(L('Снаряжение', 'Equipment'), L('Аспекты элиты нельзя «открыть» — их можно только отметить найденными в логбуке.', 'Elite aspects have no unlock, only a logbook entry.'), bulk('equipment')) +
      `<div class="toolbar"><input class="search" id="search" placeholder="${L('Поиск по названию', 'Search')}" value="${esc(S.search)}"></div>${groups}`;
  },

  artifacts() {
    return head(L('Артефакты', 'Artifacts'), L('Открытые артефакты можно включать перед забегом.', 'Unlocked artifacts can be toggled before a run.'), bulk('artifacts')) +
      `<div class="tiles wide">${G.artifacts.map(a => unlockTile('artifacts', a)).join('')}</div>`;
  },

  logbook() {
    const logs = (title, list, atlas, scope) => `<div class="group"><div class="group-head"><h3>${title}</h3><span class="cnt">${cnt(list, l => S.unlockSet.has(l.id))}</span><span class="spacer"></span>
      <button class="link" data-bulk="${scope}" data-on="1">${L('открыть все', 'unlock all')}</button><button class="link" data-bulk="${scope}" data-on="0">${L('закрыть все', 'lock all')}</button></div>
      <div class="tiles">${list.filter(matches).map(l => tile(atlas, l.icon, T(l.name), S.unlockSet.has(l.id) ? 'on' : 'off', `data-log="${esc(l.id)}"`)).join('')}</div></div>`;
    const drones = G.drones.filter(matches).map(d => {
      const on = S.discSet.has(d.pickup);
      return `<button class="chip ${on ? 'on' : ''}" data-disc="${esc(d.pickup)}">${on ? '✓ ' : ''}${esc(T(d.name))}</button>`;
    }).join('');
    return head(L('Логбук', 'Logbook'), L('Записи о монстрах и локациях. Предметы и снаряжение в логбуке отмечаются в своих разделах.', 'Monster and environment entries. Items and equipment are handled in their own sections.'), bulk('logbook')) +
      `<div class="toolbar"><input class="search" id="search" placeholder="${L('Поиск', 'Search')}" value="${esc(S.search)}"></div>` +
      logs(L('Монстры', 'Monsters'), G.monsterLogs, 'logs', 'logs:monsters') +
      logs(L('Окружение', 'Environments'), G.stageLogs, 'logs', 'logs:stages') +
      `<div class="group"><div class="group-head"><h3>${L('Дроны', 'Drones')}</h3><span class="cnt">${cnt(G.drones, d => S.discSet.has(d.pickup))}</span></div><div class="toolbar">${drones}</div></div>`;
  },

  achievements() {
    const list = G.achievements.filter(matches).map(a => {
      const on = S.achSet.has(a.id);
      const rw = a.reward ? T(unlockName[a.reward]) || a.reward : '';
      return `<div class="li ${on ? '' : 'off'}" data-ach="${esc(a.id)}">${icon('achievements', a.icon, 44)}
        <div><div class="li-title">${esc(T(a.name))}</div><div class="li-desc">${esc(T(a.desc))}</div>${rw ? `<div class="li-reward">${L('Награда', 'Reward')}: ${esc(rw)}</div>` : ''}</div>
        ${sw('achsw', a.id, on, '')}</div>`;
    }).join('');
    return head(L('Достижения', 'Achievements'), L('Отметка достижения сразу открывает его награду. Лунные монеты за достижение при этом не начисляются.', 'Marking an achievement also unlocks its reward. Its lunar coin bonus is not added.'), bulk('achievements')) +
      `<div class="toolbar"><input class="search" id="search" placeholder="${L('Поиск', 'Search')}" value="${esc(S.search)}"></div><div class="list">${list}</div>`;
  },

  other() {
    const newtOn = G.newts.filter(n => S.unlockSet.has(n)).length;
    const known = new Set([
      ...G.survivors.map(s => s.unlock), ...G.skills.map(s => s.unlock), ...G.skins.map(s => s.unlock),
      ...G.items.map(s => s.unlock), ...G.equipment.map(s => s.unlock), ...G.artifacts.map(s => s.unlock),
      ...G.monsterLogs.map(s => s.id), ...G.stageLogs.map(s => s.id), ...G.eclipse, ...G.newts,
    ]);
    const rest = G.allUnlocks.filter(u => !known.has(u));
    const foreign = S.unlocks.filter(u => !G.allUnlocks.includes(u));
    return head(L('Прочее', 'Other'), L('Статуи тритонов и служебные открытия, которые не попали в другие разделы.', 'Newt altars and other unlocks not covered elsewhere.')) +
      `<div class="panel"><h3>${L('Статуи тритонов', 'Newt altars')}</h3><p>${L('Найдено', 'Found')} ${newtOn} ${L('из', 'of')} ${G.newts.length}. ${L('Влияет только на достижение «Ищите и найдёте».', 'Only matters for the related achievement.')}</p>
        <div class="big-actions"><button class="btn small" data-bulk="newts" data-on="1">${L('Отметить все', 'Mark all')}</button><button class="btn small danger" data-bulk="newts" data-on="0">${L('Снять все', 'Clear all')}</button></div></div>
      <div class="panel"><h3>${L('Служебные открытия', 'Misc unlocks')}</h3><p>${L('Внутренние флаги игры. Трогать обычно не нужно.', 'Internal game flags. Usually no need to touch.')}</p>
        <div class="toolbar">${rest.map(u => `<button class="chip ${S.unlockSet.has(u) ? 'on' : ''}" data-raw="${esc(u)}">${S.unlockSet.has(u) ? '✓ ' : ''}${esc(u)}</button>`).join('')}</div></div>
      ${foreign.length ? `<div class="panel"><h3>${L('Неизвестные записи', 'Unknown entries')}</h3><p>${L('Есть в файле, но игры о них не знает (например, от модов). Редактор их не трогает.', 'Present in the file but unknown to the game (e.g. from mods). Left untouched.')}</p><div class="toolbar">${foreign.map(u => `<span class="chip">${esc(u)}</span>`).join('')}</div></div>` : ''}`;
  },
};

function sw(kind, id, on, label) {
  return `<label class="sw ${on ? 'on' : ''}" data-sw="${kind}" data-id="${esc(id)}"><input type="checkbox" ${on ? 'checked' : ''}><i></i>${label}</label>`;
}
function tile(atlas, ic, name, st, attrs, extra) {
  return `<div class="tile ${st === 'on' ? '' : st}" ${attrs} title="${esc(name)}">${stateMark(st)}${extra || ''}${icon(atlas, ic, 56)}<div class="nm">${esc(name)}</div></div>`;
}
function unlockTile(atlas, x) {
  if (!x.unlock) return tile(atlas, x.icon, T(x.name), 'on', '', `<span class="badge">${L('база', 'base')}</span>`);
  return tile(atlas, x.icon, T(x.name), isOn(x.unlock) ? 'on' : 'off', `data-unlock="${esc(x.unlock)}"`);
}
function group(title, list, atlas, scope, color) {
  const tiles = list.map(x => {
    const badge = x.dlc ? `<span class="badge">${DLC[x.dlc] || x.dlc}</span>` : '';
    return `<div style="--tier:${color};display:contents">${tile(atlas, x.icon, T(x.name), pickupState(x), `data-pick="${atlas}:${esc(x.id)}"`, badge)}</div>`;
  }).join('');
  return `<div class="group"><div class="group-head"><span class="dot" style="background:${color}"></span><h3>${title}</h3><span class="cnt">${cnt(list, x => pickupState(x) === 'on')}</span><span class="spacer"></span>
    <button class="link" data-bulk="${scope}" data-on="1">${L('открыть все', 'unlock all')}</button><button class="link" data-bulk="${scope}" data-on="0">${L('закрыть все', 'lock all')}</button></div>
    <div class="tiles">${tiles}</div></div>`;
}

// ---------- массовые действия ----------
function bulkApply(scope, on) {
  const [kind, arg] = scope.split(':');
  const U = list => list.forEach(x => setUnlock(x.unlock, on));
  switch (kind) {
    case 'survivors': U(G.survivors); if (!on) G.eclipse.forEach(e => setUnlock(e, false)); break;
    case 'loadout': U(G.skills.filter(s => s.body === arg)); U(G.skins.filter(s => s.body === arg)); break;
    case 'items': G.items.filter(i => !arg || i.tier === arg).forEach(i => setPickup(i, on)); break;
    case 'equipment': {
      const f = [e => !e.lunar && !e.elite, e => e.lunar && !e.elite, e => e.elite][arg];
      G.equipment.filter(e => !f || f(e)).forEach(e => setPickup(e, on)); break;
    }
    case 'artifacts': U(G.artifacts); break;
    case 'logbook': [...G.monsterLogs, ...G.stageLogs].forEach(l => setUnlock(l.id, on)); G.drones.forEach(d => setDisc(d.pickup, on)); break;
    case 'logs': (arg === 'monsters' ? G.monsterLogs : G.stageLogs).forEach(l => setUnlock(l.id, on)); break;
    case 'achievements': G.achievements.forEach(a => setAch(a.id, on)); break;
    case 'newts': G.newts.forEach(n => setUnlock(n, on)); break;
  }
}
function allApply(on) {
  if (on) {
    G.achievements.forEach(a => setAch(a.id, true));
    G.allUnlocks.forEach(u => setUnlock(u, true));
    [...G.items, ...G.equipment].forEach(x => setDisc(x.pickup, true));
    G.drones.forEach(d => setDisc(d.pickup, true));
  } else {
    const keep = new Set(S.unlocks.filter(u => !G.allUnlocks.includes(u))); // записи модов не трогаем
    S.ach = []; S.unlocks = S.unlocks.filter(u => keep.has(u)); S.disc = [];
  }
}

// Двухшаговое подтверждение для опасных кнопок
let armed = null;
function confirmArm(btn) {
  if (armed === btn) { armed = null; return true; }
  if (armed) { armed.classList.remove('armed'); armed.textContent = armed.dataset.label; }
  armed = btn; btn.dataset.label = btn.textContent; btn.classList.add('armed'); btn.textContent = L('Точно? Нажми ещё раз', 'Sure? Click again');
  setTimeout(() => { if (armed === btn) { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; armed = null; } }, 3500);
  return false;
}

// ---------- отрисовка ----------
function render() {
  refreshChrome();
  const main = $('#main');
  const y = window.scrollY;
  main.innerHTML = RENDER[S.page]();
  window.scrollTo(0, y);
  const s = $('#search');
  if (s && document.activeElement !== s && S.searchFocus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}
function refreshChrome() {
  $('#nav').innerHTML = PAGES.map(p => `<button class="${S.page === p.id ? 'on' : ''}" data-page="${p.id}"><span>${p.title}</span>${p.count ? `<span class="cnt">${p.count()}</span>` : ''}</button>`).join('');
  $('#dirtyNote').hidden = !S.dirty;
  $('#undoBtn').disabled = !S.history.length;
  $('#profileName').textContent = child('name')?.textContent || L('Без имени', 'Unnamed');
  $('#profileFile').textContent = S.fileName;
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
}
function go(page) { S.page = page; S.search = ''; S.tierFilter = 'all'; window.scrollTo(0, 0); render(); }

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 4500);
}

// ---------- события ----------
$('#main').addEventListener('click', e => {
  const el = e.target.closest('[data-go],[data-surv],[data-tier],[data-unlock],[data-pick],[data-log],[data-disc],[data-ach],[data-sw],[data-bulk],[data-all],[data-coins],[data-raw]');
  if (!el) return;
  const d = el.dataset;
  if (d.go) return go(d.go);
  if (d.surv) { S.survivor = d.surv; return render(); }
  if (d.tier) { S.tierFilter = d.tier; return render(); }
  if (d.coins) return change(() => { S.coins = +d.coins; });
  if (d.all !== undefined) {
    if (d.all === '0' && !confirmArm(el)) return;
    return change(() => allApply(d.all === '1'));
  }
  if (d.bulk) {
    if (d.on === '0' && el.classList.contains('danger') && !confirmArm(el)) return;
    return change(() => bulkApply(d.bulk, d.on === '1'));
  }
  if (d.sw) {
    e.preventDefault();
    const id = d.id;
    if (d.sw === 'achsw') return change(() => setAch(id, !S.achSet.has(id)));
    return change(() => setUnlock(id, !S.unlockSet.has(id)));
  }
  if (d.ach) return change(() => setAch(d.ach, !S.achSet.has(d.ach)));
  if (d.unlock) return change(() => setUnlock(d.unlock, !S.unlockSet.has(d.unlock)));
  if (d.log) return change(() => setUnlock(d.log, !S.unlockSet.has(d.log)));
  if (d.raw) return change(() => setUnlock(d.raw, !S.unlockSet.has(d.raw)));
  if (d.disc) return change(() => setDisc(d.disc, !S.discSet.has(d.disc)));
  if (d.pick) {
    const [atlas, id] = d.pick.split(':');
    const x = (atlas === 'items' ? G.items : G.equipment).find(i => i.id === id);
    return change(() => setPickup(x, pickupState(x) !== 'on'));
  }
});
$('#main').addEventListener('input', e => {
  if (e.target.id === 'search') { S.search = e.target.value; S.searchFocus = true; render(); }
});
$('#main').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'coinsInput') {
    const v = Math.max(0, Math.min(2147483647, parseInt(t.value, 10) || 0));
    change(() => { S.coins = v; });
  }
  if (t.dataset.eclipse) {
    const id = t.dataset.eclipse, lvl = +t.value;
    change(() => G.eclipse.filter(x => x.startsWith('Eclipse.' + id + '.')).forEach(x => setUnlock(x, +x.split('.').pop() <= lvl)));
  }
});
$('#main').addEventListener('focusout', e => { if (e.target.id === 'search') S.searchFocus = false; });

$('#nav').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) go(b.dataset.page); });
$('#saveBtn').onclick = save;
$('#undoBtn').onclick = undo;
$('#downloadBtn').onclick = () => download(buildXml(), S.fileName);
$('#closeFileBtn').onclick = () => {
  if (S.dirty && !confirmArm($('#closeFileBtn'))) return;
  $('#app').hidden = true; $('#start').hidden = false; S.doc = null; S.dirty = false;
  loadProfileList();
};
document.querySelectorAll('.lang button').forEach(b => b.onclick = () => {
  lang = b.dataset.lang; try { localStorage.setItem('ror2-lang', lang); } catch (e) {}
  render();
});
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !$('#app').hidden && e.target.tagName !== 'INPUT') { e.preventDefault(); undo(); } });

// ---------- открытие файла ----------
function openEditor(text, name, apiPath) {
  try {
    loadText(text, name);
    S.apiPath = apiPath || null;
    S.page = 'overview';
    $('#start').hidden = true; $('#app').hidden = false; $('#startError').hidden = true;
    render();
    toast(apiPath ? 'Профиль открыт. «Сохранить» запишет изменения прямо в него.' : 'Файл открыт. «Сохранить» скачает исправленную копию.');
  } catch (err) {
    $('#startError').textContent = err.message; $('#startError').hidden = false;
  }
}

// Если сайт открыт через start.bat, сервер сам находит профили в папке Steam
async function loadProfileList() {
  let data;
  try { const r = await fetch('/api/profiles'); if (!r.ok) return; data = await r.json(); } catch (e) { return; }
  const box = $('#profiles');
  const when = ms => new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  box.innerHTML = `<div class="profiles-title">Профили на этом компьютере</div>` +
    (data.gameRunning ? `<div class="warn">Игра сейчас запущена. Закрой её перед сохранением, иначе она перезапишет файл при выходе.</div>` : '') +
    (data.profiles.length ? data.profiles.map((p, i) => `<button class="profile-btn" data-i="${i}"><b>${esc(p.name)}</b><span>изменён ${when(p.mtime)} · Steam ${esc(p.steamId)}</span></button>`).join('')
      : `<div class="note">Профилей RoR2 не нашлось. Выбери файл вручную ниже.</div>`);
  box.hidden = false;
  if (data.profiles[0]) $('#pathText').textContent = data.profiles[0].path.replace(/\\[^\\]+$/, '');
  box.onclick = async e => {
    const b = e.target.closest('.profile-btn'); if (!b) return;
    const p = data.profiles[+b.dataset.i];
    const r = await fetch('/api/profile?path=' + encodeURIComponent(p.path));
    openEditor(await r.text(), p.file, p.path);
  };
  $('.drop-title').textContent = 'Или перетащи сюда другой файл';
}

$('#gameVersion').textContent = G.version;
$('#drop').onclick = () => $('#fileInput').click();
$('#drop').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } };
$('#fileInput').onchange = async e => { const f = e.target.files[0]; if (f) openEditor(await f.text(), f.name); e.target.value = ''; };
$('#drop').ondragover = e => { e.preventDefault(); $('#drop').classList.add('over'); };
$('#drop').ondragleave = () => $('#drop').classList.remove('over');
$('#drop').ondrop = async e => {
  e.preventDefault(); $('#drop').classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) openEditor(await f.text(), f.name);
};
loadProfileList();
$('#copyPath').onclick = () => {
  navigator.clipboard?.writeText($('#pathText').textContent.trim()).then(() => toast('Путь скопирован. Вставь его в адресную строку окна выбора файла.'));
};

window.__editor = { loadText: (t, n) => openEditor(t, n), buildXml, S };
