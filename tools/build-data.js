// Превращает data/game-data.json (выгрузка из игры) в data/game-data.js для сайта.
// Запуск: node tools/build-data.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
const d = JSON.parse(fs.readFileSync(path.join(dir, 'game-data.json'), 'utf8'));

// Если русской строки нет или она битая, берём английскую
const nm = (l, fallback) => {
  if (!l) return fallback ? { ru: fallback, en: fallback } : null;
  const bad = s => !s || s.includes('??') || /^[A-Z0-9_]+$/.test(s);
  const en = bad(l.en) ? fallback || l.en : l.en;
  const ru = bad(l.ru) ? en : l.ru;
  return { ru, en };
};
const isToken = l => !l || /^[A-Z0-9_]+$/.test(l.en);

const DLC_BY_BODY = {
  RailgunnerBody: 'DLC1', VoidSurvivorBody: 'DLC1',
  SeekerBody: 'DLC2', FalseSonBody: 'DLC2', ChefBody: 'DLC2',
  DroneTechBody: 'DLC3', DrifterBody: 'DLC3',
};

// В игре имя Исчадия Пустоты оформлено спецсимволами, которые не переносятся
const NAME_FIX = { VoidSurvivor: { ru: 'Исчадие Пустоты', en: 'Void Fiend' } };

const survivors = d.survivors.filter(s => !s.hidden).map(s => ({
  id: s.id, body: s.body, name: NAME_FIX[s.id] || nm(s.name, s.id), unlock: s.unlock, icon: s.icon, dlc: DLC_BY_BODY[s.body] || null,
}));
const bodies = new Set(survivors.map(s => s.body));

const SLOT_ORDER = ['primary', 'secondary', 'utility', 'special', 'other'];
const skills = d.skills.filter(s => bodies.has(s.body)).map(s => ({
  body: s.body, slot: s.slot, id: s.id, name: nm(s.name, s.id), unlock: s.unlock, icon: s.icon,
})).sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));

const skins = d.skins.filter(s => bodies.has(s.body)).map(s => ({
  body: s.body, id: s.id, name: nm(s.name, s.id), unlock: s.unlock, icon: s.icon,
}));

const items = d.items
  .filter(i => !i.hidden && i.tier !== 'NoTier' && !isToken(i.name))
  .map(i => ({ id: i.id, pickup: i.pickup, name: nm(i.name), desc: nm(i.desc), tier: i.tier, unlock: i.unlock, dlc: i.dlc, icon: i.icon }));

const equipment = d.equipment
  .filter(e => !isToken(e.name) && e.icon >= 0 && !e.id.endsWith('Consumed'))
  .map(e => ({
    id: e.id, pickup: e.pickup, name: nm(e.name), desc: nm(e.desc), lunar: e.lunar, boss: e.boss,
    elite: e.id.startsWith('Elite'), unlock: e.unlock, dlc: e.dlc, icon: e.icon,
  }));

const drones = d.pickups.filter(p => p.kind === 'drone' && !isToken(p.name))
  .map(p => ({ pickup: p.id, name: nm(p.name) }));

const artifacts = d.artifacts.map(a => ({ id: a.id, name: nm(a.name, a.id), desc: nm(a.desc), unlock: a.unlock, icon: a.icon }));

const achievements = d.achievements.map(a => ({
  id: a.id, name: nm(a.name, a.id), desc: nm(a.desc), reward: a.reward, prereq: a.prereq, coins: a.coins, icon: a.icon,
}));

const U = d.unlockables;
const monsterLogs = U.filter(u => /^Logs?\./.test(u.id) && !u.id.startsWith('Logs.Stages.'))
  .map(u => ({ id: u.id, name: nm(u.subject) || nm(u.name, u.id), icon: u.icon }));
// у части логов в названии стоит «Запись о монстре: …» — оставляем только имя
monsterLogs.forEach(l => {
  for (const k of ['ru', 'en']) l.name[k] = l.name[k].replace(/^(Запись о монстре|Monster Log):\s*/i, '');
});
const stageLogs = U.filter(u => u.id.startsWith('Logs.Stages.'))
  .map(u => ({ id: u.id, name: nm(u.subject) || nm(u.name, u.id), icon: u.icon }));
stageLogs.forEach(l => {
  for (const k of ['ru', 'en']) l.name[k] = l.name[k].replace(/^(Запись об окружении|Environment Log):\s*/i, '');
});

const eclipse = U.filter(u => u.id.startsWith('Eclipse.')).map(u => u.id);
const newts = U.filter(u => u.id.startsWith('NewtStatue.')).map(u => u.id);
const shop = U.filter(u => u.id.startsWith('Shop.')).map(u => u.id);

const out = {
  version: d.version, cell: d.cell, cols: d.atlasCols,
  survivors, skills, skins, items, equipment, drones, artifacts, achievements,
  monsterLogs, stageLogs, eclipse, newts, shop,
  allUnlocks: U.map(u => u.id),
};
fs.writeFileSync(path.join(dir, 'game-data.js'), 'window.GAME = ' + JSON.stringify(out) + ';\n');
console.log(Object.entries(out).map(([k, v]) => k + ':' + (Array.isArray(v) ? v.length : v)).join('  '));
