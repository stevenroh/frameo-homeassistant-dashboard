'use strict';
// Run with TZ=Europe/Amsterdam (package.json does this); the frame runs in that zone.
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./page.js');
const initial = require('./fixtures/entities-initial.json');
const diff = require('./fixtures/entities-diff.json');
const events = require('./fixtures/get_events.json');
const forecasts = require('./fixtures/get_forecasts.json');

test('applyEntityDiff loads the initial snapshot', () => {
  const store = {};
  const changed = app.applyEntityDiff(store, initial.event);
  assert.deepEqual([...changed].sort(), Object.keys(initial.event.a).sort());
  assert.equal(store['sun.sun'].s, 'above_horizon');
  assert.equal(store['sun.sun'].a.friendly_name, 'Sun');
});

test('applyEntityDiff merges partial attribute changes', () => {
  const store = {};
  app.applyEntityDiff(store, initial.event);
  const changed = app.applyEntityDiff(store, diff.event);
  assert.deepEqual([...changed], ['sun.sun']);
  assert.equal(store['sun.sun'].a.elevation, 25.81);
  assert.equal(store['sun.sun'].a.friendly_name, 'Sun', 'untouched attributes survive');
  assert.equal(store['sun.sun'].s, 'above_horizon', 'state kept when not in the diff');
});

test('applyEntityDiff handles state changes, attribute removal and entity removal', () => {
  const store = { 'x.a': { s: 'on', a: { k: 1, j: 2 } }, 'x.b': { s: 'off', a: {} } };
  const changed = app.applyEntityDiff(store, {
    c: { 'x.a': { '+': { s: 'off' }, '-': { a: ['k'] } } },
    r: ['x.b'],
  });
  assert.deepEqual([...changed].sort(), ['x.a', 'x.b']);
  assert.deepEqual(store['x.a'], { s: 'off', a: { j: 2 } });
  assert.equal(store['x.b'], undefined);
});

test('applyEntityDiff ignores a change for an unknown entity without throwing', () => {
  const store = {};
  const changed = app.applyEntityDiff(store, { c: { 'x.new': { '+': { s: '1' } } } });
  assert.deepEqual(store['x.new'], { s: '1', a: {} });
  assert.deepEqual([...changed], ['x.new']);
});

test('parseForecast returns n daily rows from a real response', () => {
  const rows = app.parseForecast(forecasts.result, 'weather.buienradar', 3);
  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['bearing', 'condition', 'date', 'gust', 'low', 'mm', 'rain', 'temp', 'wind']);
  assert.equal(rows[0].temp, forecasts.result.response['weather.buienradar'].forecast[0].temperature);
  assert.ok(rows[0].date instanceof Date);
});

test('parseForecast tolerates failures', () => {
  assert.deepEqual(app.parseForecast(null, 'weather.buienradar'), []);
  assert.deepEqual(app.parseForecast({ response: {} }, 'weather.buienradar'), []);
});

test('parseDate reads date-only values as local midnight, not UTC', () => {
  const d = app.parseDate('2026-10-15');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 0);
  assert.equal(app.parseDate('2026-10-15T09:30:00+02:00').getHours(), 9);
});

test('parseEvents merges calendars, sorts, marks all-day and source', () => {
  const result = {
    response: {
      'calendar.a': { events: [{ start: '2026-10-16T09:00:00+02:00', end: '2026-10-16T10:00:00+02:00', summary: 'Dentist' }] },
      'calendar.b': { events: [{ start: '2026-10-15', end: '2026-10-16', summary: 'Mijnafvalwijzer: GFT' }] },
    },
  };
  const list = app.parseEvents(result);
  assert.deepEqual(list.map((e) => e.summary), ['Mijnafvalwijzer: GFT', 'Dentist']);
  assert.equal(list[0].allDay, true);
  assert.equal(list[1].allDay, false);
  assert.equal(list[0].source, 'calendar.b');
});

test('parseEvents reads the real afvalwijzer response', () => {
  const list = app.parseEvents(events.result);
  assert.ok(list.length > 0);
  assert.ok(list.every((e) => e.allDay));
});

test('dayLabel says Today, Tomorrow, then a short date', () => {
  const now = new Date(2026, 9, 14, 15, 0);
  assert.equal(app.dayLabel(new Date(2026, 9, 14), now), 'Aujourd’hui');
  assert.equal(app.dayLabel(new Date(2026, 9, 15, 8), now), 'Demain');
  assert.equal(app.dayLabel(new Date(2026, 9, 16), now), 'Ven 16 oct.');
});

test('groupByDay keeps upcoming days in order and drops past events', () => {
  const now = new Date(2026, 9, 14, 15, 0);
  const list = [
    { start: new Date(2026, 9, 14, 9), end: new Date(2026, 9, 14, 10), allDay: false, summary: 'past' },
    { start: new Date(2026, 9, 14, 14), end: new Date(2026, 9, 14, 16), allDay: false, summary: 'now' },
    { start: new Date(2026, 9, 16), end: new Date(2026, 9, 17), allDay: true, summary: 'later' },
  ];
  const days = app.groupByDay(list, now);
  assert.deepEqual(days.map((d) => d.label), ['Aujourd’hui', 'Ven 16 oct.']);
  assert.deepEqual(days[0].events.map((e) => e.summary), ['now']);
});

test('wasteType strips the afvalwijzer prefix', () => {
  assert.equal(app.wasteType('Mijnafvalwijzer: Plastic'), 'Plastic');
  assert.equal(app.wasteType('Papier'), 'Papier');
});

test('formatClock and formatDate', () => {
  const d = new Date(2026, 9, 14, 7, 5);
  assert.equal(app.formatClock(d), '07:05');
  assert.equal(app.formatDate(d), 'Mercredi 14 octobre');
  assert.equal(app.formatTime(d), '07:05');
});

test('conditionLabel covers HA conditions and unknowns', () => {
  assert.equal(app.conditionLabel('partlycloudy'), 'Peu nuageux');
  assert.equal(app.conditionLabel('pouring'), 'Averses');
  assert.equal(app.conditionLabel('lightning-rainy'), 'Orage');
  assert.equal(app.conditionLabel('whatever'), '—');
  assert.equal(typeof app.conditionIcon('sunny'), 'string');
});

test('msToNextMinute aligns ticks to the minute', () => {
  assert.equal(app.msToNextMinute(new Date(2026, 0, 1, 0, 0, 59, 500)), 500);
  assert.equal(app.msToNextMinute(new Date(2026, 0, 1, 0, 0, 0, 0)), 60000);
});

test('backoffDelay grows and caps at 60 s', () => {
  assert.equal(app.backoffDelay(0), 1000);
  assert.equal(app.backoffDelay(1), 2000);
  assert.equal(app.backoffDelay(10), 60000);
});

test('staleLabel is empty while fresh, then says how old', () => {
  const now = 1_000_000_000;
  assert.equal(app.staleLabel(now - 60_000, now), '');
  assert.equal(app.staleLabel(now - 5 * 60_000, now), 'Pas de connexion depuis 5 min');
  assert.equal(app.staleLabel(0, now), 'Connexion…');
});

test('protocol: auth, then subscribe and fetch, then results route by id', () => {
  const cfg = { token: 'T', weather: 'weather.w', calendars: ['calendar.g', 'calendar.a'], waste: 'calendar.a' };
  let st = app.initialState();
  let out = app.handleMessage(st, { type: 'auth_required' }, cfg);
  assert.deepEqual(out.send, [{ type: 'auth', access_token: 'T' }]);
  out = app.handleMessage(out.state, { type: 'auth_ok' }, cfg);
  const types = out.send.map((m) => m.type);
  assert.deepEqual(types, ['subscribe_entities', 'call_service', 'call_service']);
  assert.deepEqual(out.send[0].entity_ids, ['weather.w', 'sun.sun']);
  const cal = out.send.find((m) => m.domain === 'calendar');
  assert.deepEqual(cal.target.entity_id, ['calendar.g', 'calendar.a']);
  assert.deepEqual(cal.service_data, { duration: { days: 14 } });
  assert.equal(cal.return_response, true);
  const ids = out.send.map((m) => m.id);
  assert.equal(new Set(ids).size, 3);

  out = app.handleMessage(out.state, { id: cal.id, type: 'result', success: true, result: events.result }, cfg);
  assert.equal(out.update.kind, 'calendar');
  assert.ok(Array.isArray(out.update.events));

  const fc = out.state.pending;
  const wid = Object.keys(fc).find((k) => fc[k] === 'forecast');
  out = app.handleMessage(out.state, { id: Number(wid), type: 'result', success: true, result: forecasts.result }, cfg);
  assert.equal(out.update.kind, 'forecast');

  out = app.handleMessage(out.state, initial, cfg);
  assert.equal(out.update.kind, 'entities');
});

test('protocol: auth_invalid is terminal, failed results do not throw', () => {
  const cfg = { token: 'T', weather: 'weather.w', calendars: ['calendar.a'] };
  let out = app.handleMessage(app.initialState(), { type: 'auth_invalid', message: 'bad' }, cfg);
  assert.equal(out.state.fatal, 'bad');
  out = app.handleMessage(app.initialState(), { type: 'auth_ok' }, cfg);
  const id = out.send[1].id;
  out = app.handleMessage(out.state, { id, type: 'result', success: false, error: { code: 'x' } }, cfg);
  assert.equal(out.update, null);
});

test('refresh builds calendar and forecast calls with fresh ids', () => {
  const cfg = { token: 'T', weather: 'weather.w', calendars: ['calendar.a'] };
  let out = app.handleMessage(app.initialState(), { type: 'auth_ok' }, cfg);
  const before = out.state.nextId;
  out = app.refresh(out.state, cfg, 'calendar');
  assert.equal(out.send.length, 1);
  assert.equal(out.send[0].id, before);
  assert.equal(out.state.pending[before], 'calendar');
});

test('cleanTitle strips every emoji, including flags, ZWJ sequences and skin tones', () => {
  assert.equal(app.cleanTitle('🇧🇷🇳🇱 Visit from Grandma'), 'Visit from Grandma');
  assert.equal(app.cleanTitle('Yoga class 🏃🏽‍♀️'), 'Yoga class');
  assert.equal(app.cleanTitle('👶🍼Papahalfdag'), 'Papahalfdag');
  assert.equal(app.cleanTitle('Tikkie 🏢  test'), 'Tikkie test');
  assert.equal(app.cleanTitle('Fazer AH 🛒'), 'Fazer AH');
  assert.equal(app.cleanTitle('Room 1 #2 ©'), 'Room 1 #2 ©');
  assert.equal(app.cleanTitle('🎉'), '');
});

test('clockTrusted is false for the 2021 boot clock, true once network time arrives', () => {
  assert.equal(app.clockTrusted(new Date(2021, 4, 15, 2, 0)), false);
  assert.equal(app.clockTrusted(new Date(2026, 9, 14, 15, 24)), true);
});

test('monthGrid starts on Monday and covers whole weeks', () => {
  const g = app.monthGrid(2026, 9); // October 2026 starts on a Thursday
  assert.equal(g.length, 35);
  assert.deepEqual([g[0].getMonth(), g[0].getDate()], [8, 28]);
  assert.deepEqual([g[3].getMonth(), g[3].getDate()], [9, 1]);
  assert.deepEqual([g[34].getMonth(), g[34].getDate()], [10, 1]);
  assert.equal(app.monthGrid(2026, 1).length, 35); // Sunday 1 Feb 2026: 6 lead days + 28
  assert.equal(app.monthGrid(2026, 7).length, 42); // Saturday 1 Aug 2026: 5 lead days + 31
  assert.equal(app.monthGrid(2027, 1).length, 28); // Monday 1 Feb 2027, 28 days
});

test('weekDays returns Monday to Sunday around a date', () => {
  const w = app.weekDays(new Date(2026, 9, 14, 15));
  assert.equal(w.length, 7);
  assert.deepEqual(w.map((d) => d.getDate()), [12, 13, 14, 15, 16, 17, 18]);
  assert.equal(w[0].getHours(), 0);
});

test('eventsOnDay includes multi-day all-day events and timed events overlapping the day', () => {
  const list = [
    { start: new Date(2026, 9, 12), end: new Date(2026, 9, 20), allDay: true, summary: 'Visit' },
    { start: new Date(2026, 9, 14, 20), end: new Date(2026, 9, 14, 21), allDay: false, summary: 'Groceries' },
    { start: new Date(2026, 9, 15), end: new Date(2026, 9, 16), allDay: true, summary: 'Tomorrow only' },
  ];
  assert.deepEqual(app.eventsOnDay(list, new Date(2026, 9, 14)).map((e) => e.summary), ['Visit', 'Groceries']);
  assert.deepEqual(app.eventsOnDay(list, new Date(2026, 9, 20)).map((e) => e.summary), []);
});

test('binColor maps Dutch bin types and falls back to grey', () => {
  assert.equal(app.binColor('GFT'), '#5DAA68');
  assert.equal(app.binColor('Plastic'), '#E8873A');
  assert.equal(app.binColor('PMD'), '#E8873A');
  assert.equal(app.binColor('Papier'), '#4F8FD9');
  assert.equal(app.binColor('Restafval'), '#8E949A');
});

test('binFill is one bin colour, or equal stripes for several bins', () => {
  assert.equal(app.binFill(['GFT']), '#5DAA68');
  assert.equal(app.binFill(['Plastic', 'PMD']), '#E8873A');
  assert.equal(app.binFill(['GFT', 'Papier']), 'linear-gradient(90deg, #5DAA68 0% 50%, #4F8FD9 50% 100%)');
  assert.equal(app.binFill(['Papier', 'PMD', 'Restafval']),
    'linear-gradient(90deg, #4F8FD9 0% 33%, #E8873A 33% 67%, #8E949A 67% 100%)');
});

test('localIso formats local time with its UTC offset for HA', () => {
  assert.equal(app.localIso(new Date(2026, 8, 28)), '2026-09-28T00:00:00+02:00');
  assert.equal(app.localIso(new Date(2026, 10, 2)), '2026-11-02T00:00:00+01:00');
});

test('protocol: range fetches carry their key back with the parsed events', () => {
  const cfg = { token: 'T', weather: 'weather.w', calendars: ['calendar.g'] };
  let out = app.handleMessage(app.initialState(), { type: 'auth_ok' }, cfg);
  out = app.fetchRange(out.state, cfg, '2026-09', new Date(2026, 8, 28), new Date(2026, 10, 2));
  const msg = out.send[0];
  assert.deepEqual(msg.service_data, { start_date_time: '2026-09-28T00:00:00+02:00', end_date_time: '2026-11-02T00:00:00+01:00' });
  out = app.handleMessage(out.state, { id: msg.id, type: 'result', success: true, result: events.result }, cfg);
  assert.equal(out.update.kind, 'range');
  assert.equal(out.update.key, '2026-09');
  assert.ok(out.update.events.length > 0);
});

test('weatherIcon picks a drawing for every HA condition', () => {
  for (const c of ['sunny', 'clear-night', 'partlycloudy', 'cloudy', 'fog', 'rainy', 'pouring', 'lightning-rainy', 'snowy', 'windy', 'nonsense']) {
    assert.match(app.weatherIcon(c, 28), /^<svg /);
  }
});

test('chipOrder puts single-day events before multi-day ones', () => {
  const list = [
    { start: new Date(2026, 9, 12), end: new Date(2026, 9, 20), allDay: true, summary: 'Long visit' },
    { start: new Date(2026, 9, 14), end: new Date(2026, 9, 15), allDay: true, summary: 'Fair' },
    { start: new Date(2026, 9, 14, 9), end: new Date(2026, 9, 14, 10), allDay: false, summary: 'Gym' },
  ];
  assert.deepEqual(app.chipOrder(list).map((e) => e.summary), ['Fair', 'Gym', 'Long visit']);
});

test('nextTarget steps, rounds to the entity step and clamps to its range', () => {
  const a = { temperature: 20, min_temp: 5, max_temp: 25, target_temp_step: 0.5 };
  assert.equal(app.nextTarget(a, 1), 20.5);
  assert.equal(app.nextTarget(a, -1), 19.5);
  assert.equal(app.nextTarget({ ...a, temperature: 25 }, 1), 25);
  assert.equal(app.nextTarget({ ...a, temperature: 5 }, -1), 5);
  assert.equal(app.nextTarget({ ...a, target_temp_step: 0.1, temperature: 19.4 }, 1), 19.5);
  assert.equal(app.nextTarget({ ...a, target_temp_step: undefined, temperature: 20 }, 1), 20.5);
});

test('climateView describes a tado zone', () => {
  const v = app.climateView({ s: 'heat', a: { friendly_name: 'Bedroom', current_temperature: 17.5, temperature: 19,
    hvac_action: 'heating', hvac_modes: ['off', 'auto', 'heat'] } });
  assert.deepEqual(v, { name: 'Bedroom', current: '17.5°', target: '19.0°', mode: 'heat', action: 'Chauffe',
    canAdjust: true, unavailable: false });
  const off = app.climateView({ s: 'off', a: { friendly_name: 'Living Room', current_temperature: 19.4, temperature: 5 } });
  assert.equal(off.target, 'Arrêt');
  assert.equal(off.canAdjust, false);
  assert.equal(app.climateView({ s: 'unavailable', a: { friendly_name: 'Ben' } }).unavailable, true);
});

test('lightView reads on/off, brightness percent and availability', () => {
  assert.deepEqual(app.lightView({ s: 'on', a: { brightness: 128, supported_color_modes: ['brightness'] } }, 'Shades'),
    { name: 'Shades', on: true, pct: 50, dimmable: true, unavailable: false, label: '50%' });
  assert.deepEqual(app.lightView({ s: 'off', a: { supported_color_modes: ['onoff'] } }, 'Garden'),
    { name: 'Garden', on: false, pct: 0, dimmable: false, unavailable: false, label: 'Éteint' });
  assert.equal(app.lightView({ s: 'unavailable', a: {} }, 'Spot').label, 'Indisponible');
  assert.equal(app.lightView(undefined, 'Missing').unavailable, true);
});

test('serviceCall builds a call_service with a target and tracks it as an action', () => {
  const st = app.initialState();
  const out = app.serviceCall(st, 'climate', 'set_temperature', 'climate.bedroom', { temperature: 19.5 });
  assert.deepEqual(out.send[0], { id: 1, type: 'call_service', domain: 'climate', service: 'set_temperature',
    target: { entity_id: 'climate.bedroom' }, service_data: { temperature: 19.5 } });
  assert.equal(out.state.pending[1].kind, 'action');
});

test('protocol: subscription covers weather, thermostats and lights; failed actions are reported', () => {
  const cfg = { token: 'T', weather: 'weather.w', calendars: ['calendar.a'], climate: ['climate.b'],
    lights: [{ id: 'light.x', name: 'X' }] };
  let out = app.handleMessage(app.initialState(), { type: 'auth_ok' }, cfg);
  assert.deepEqual(out.send[0].entity_ids, ['weather.w', 'sun.sun', 'climate.b', 'light.x']);
  out = app.serviceCall(out.state, 'light', 'toggle', 'light.x', {});
  const id = out.send[0].id;
  out = app.handleMessage(out.state, { id, type: 'result', success: false, error: { message: 'nope' } }, cfg);
  assert.deepEqual(out.update, { kind: 'action-failed', entity: 'light.x', message: 'nope' });
});

test('colorTempView reads the real Hue group shapes', () => {
  assert.deepEqual(app.colorTempView({ s: 'on', a: { supported_color_modes: ['color_temp'], color_mode: 'color_temp',
    min_color_temp_kelvin: 2202, max_color_temp_kelvin: 6535, color_temp_kelvin: 2732 } }),
  { supported: true, min: 2202, max: 6535, kelvin: 2732 });
  assert.deepEqual(app.colorTempView({ s: 'off', a: { supported_color_modes: ['color_temp'],
    min_color_temp_kelvin: 2202, max_color_temp_kelvin: 4504 } }),
  { supported: true, min: 2202, max: 4504, kelvin: 3353 });
  assert.equal(app.colorTempView({ s: 'on', a: { supported_color_modes: ['brightness'] } }).supported, false);
  assert.deepEqual(app.colorTempView({ s: 'on', a: { supported_color_modes: ['color_temp', 'hs'] } }),
    { supported: true, min: 2000, max: 6535, kelvin: 4268 });
  assert.equal(app.colorTempView(undefined).supported, false);
});

test('keep-alive: a lost pong closes once, and a new connection starts without the stale deadline', () => {
  let ka = app.newKeepAlive();
  let step = app.keepAliveTick(ka, 1000);
  assert.equal(step.action, 'ping');
  ka = step.ka;
  step = app.keepAliveTick(ka, 1000 + 30000); // no pong arrived within 10 s
  assert.equal(step.action, 'close');
  ka = app.newKeepAlive(); // reconnect
  step = app.keepAliveTick(ka, 1000 + 60000);
  assert.equal(step.action, 'ping', 'a fresh connection must not inherit the old deadline');
  assert.equal(app.keepAlivePong(step.ka).deadline, null);
});

test('todayEvents keeps only what is left of today', () => {
  const now = new Date(2026, 9, 14, 12, 0);
  const mk = (h1, h2, d = 14) => ({ start: new Date(2026, 9, d, h1), end: new Date(2026, 9, d, h2), allDay: false, summary: 'x' });
  const list = [mk(9, 10), mk(13, 14), mk(9, 10, 15)];
  assert.deepEqual(app.todayEvents(list, now), [list[1]]);
});

test('parseTodos drops completed items and sorts dated ones first', () => {
  const todos = app.parseTodos(require('./fixtures/get_items.json').result, 'todo.frame');
  assert.deepEqual(todos.map(t => t.uid), ['u5', 'u2', 'u4', 'u1']);
  assert.equal(todos[3].due, null);
  assert.equal(todos[2].dueHasTime, false);
  assert.deepEqual(app.parseTodos(null, 'todo.frame'), []);
});

test('todoDue words the due time and flags overdue', () => {
  const now = new Date(2026, 9, 14, 12, 0);
  const todos = app.parseTodos(require('./fixtures/get_items.json').result, 'todo.frame');
  assert.deepEqual(app.todoDue(todos[0], now), { text: '09:00', overdue: true });
  assert.deepEqual(app.todoDue(todos[1], now), { text: '18:00', overdue: false });
  assert.deepEqual(app.todoDue(todos[2], now), { text: 'Mar 20 oct.', overdue: false });
  assert.deepEqual(app.todoDue(todos[3], now), { text: '', overdue: false });
});

test('reminderOptions offers presets that are still in the future', () => {
  const noon = app.reminderOptions(new Date(2026, 9, 14, 12, 0));
  assert.deepEqual(noon.map(o => o.id), ['none', 'hour', 'evening', 'morning']);
  assert.equal(noon[3].due.getTime(), new Date(2026, 9, 15, 9, 0).getTime());
  const late = app.reminderOptions(new Date(2026, 9, 14, 17, 45));
  assert.deepEqual(late.map(o => o.id), ['none', 'hour', 'morning']);
});

test('protocol: a configured todo list is subscribed, fetched and routed', () => {
  const cfg = { token: 't', weather: 'weather.w', calendars: ['calendar.c'], todo: 'todo.frame' };
  let out = app.handleMessage(app.initialState(), { type: 'auth_ok' }, cfg);
  assert.ok(out.send[0].entity_ids.includes('todo.frame'));
  const get = out.send.find(m => m.domain === 'todo');
  assert.equal(get.service, 'get_items');
  assert.deepEqual(get.target, { entity_id: ['todo.frame'] });
  out = app.handleMessage(out.state, { id: get.id, type: 'result', success: true, result: require('./fixtures/get_items.json').result }, cfg);
  assert.equal(out.update.kind, 'todo');
  assert.equal(out.update.lists['todo.frame'].length, 4);
  const none = app.handleMessage(app.initialState(), { type: 'auth_ok' }, { token: 't', weather: 'w', calendars: [] });
  assert.ok(!none.send.some(m => m.domain === 'todo'));
});

test('isNight follows sun.sun, else 19:00-07:00', () => {
  assert.equal(app.isNight({ s: 'below_horizon' }, new Date(2026, 9, 15, 12)), true);
  assert.equal(app.isNight({ s: 'above_horizon' }, new Date(2026, 9, 15, 23)), false);
  assert.equal(app.isNight(undefined, new Date(2026, 9, 15, 20)), true);
  assert.equal(app.isNight(undefined, new Date(2026, 9, 15, 12)), false);
});

test('weatherDetails fills six tiles and tolerates missing attributes', () => {
  const t = app.weatherDetails({ s: 'cloudy', a: { temperature: 18, apparent_temperature: 18, wind_speed: 13.2, wind_bearing: 180, humidity: 80, pressure: 1021 } }, { rain: 20, mm: 0 });
  assert.equal(t.length, 6);
  assert.equal(t[0].note, 'Comme l’air');
  assert.equal(t[1].note, 'Du S');
  assert.equal(t[4].value, '20');
  assert.equal(app.weatherDetails(undefined, undefined)[1].value, '—');
});

test('hourlyPrices averages 15-minute steps into 24 hours', () => {
  const q = Array.from({ length: 96 }, (_, i) => Math.floor(i / 4));
  const h = app.hourlyPrices(q);
  assert.equal(h.length, 24);
  assert.equal(h[5], 5);
  assert.equal(app.hourlyPrices(Array(24).fill(0.3)).length, 24);
  assert.deepEqual(app.hourlyPrices(undefined), []);
});

test('evView reads charger, price and plan entities', () => {
  const ev = { mode: 'm', power: 'p', cap: 'c', prices: 'n', chargeMode: 'cm', readyBy: 'r', smart: 's', surplus: 'x' };
  const store = {
    m: { s: 'connected_charging', a: {} }, p: { s: '7200', a: {} }, c: { s: '0.32', a: {} },
    n: { s: '0.3', a: { today: Array(24).fill(0.3) } }, cm: { s: 'Planned window', a: { options: ['Planned window', 'Charge when cheap'] } },
    r: { s: '07:30:00', a: {} }, s: { s: 'on', a: {} }, x: { s: '-836', a: {} },
  };
  const v = app.evView(store, ev, new Date(2026, 9, 16, 12));
  assert.equal(v.kw, '7.2');
  assert.equal(v.charging, true);
  assert.equal(v.planned, true);
  assert.equal(v.ready, '07:30');
  assert.equal(v.hoursBelow, 24);
  assert.equal(v.smart, true);
  assert.equal(v.surplus, 0);
  assert.equal(app.evView({}, ev, new Date()).stateText, 'Inconnu');
});

test('stepTime moves by 30 minutes and wraps', () => {
  assert.equal(app.stepTime('07:30', 1), '08:00');
  assert.equal(app.stepTime('00:00', -1), '23:30');
});

test('musicView extrapolates position while playing', () => {
  const e = { s: 'playing', a: { media_title: 'T', media_artist: 'A', media_position: 100, media_duration: 200,
    media_position_updated_at: '2026-10-16T10:00:00+00:00', volume_level: 0.4 } };
  const v = app.musicView(e, new Date('2026-10-16T10:00:20+00:00'));
  assert.equal(v.pos, 120);
  assert.equal(v.pct, 60);
  assert.equal(v.volume, 40);
  assert.equal(app.musicView(undefined, new Date()).unavailable, true);
  assert.equal(app.fmtDur(125), '2:05');
});

test('playingSpeaker follows the playing speaker, unless one was picked within a minute', () => {
  const speakers = [{ id: 'media_player.a' }, { id: 'media_player.b' }];
  const store = { 'media_player.a': { s: 'idle', a: {} }, 'media_player.b': { s: 'playing', a: {} } };
  assert.equal(app.playingSpeaker(store, speakers, 'media_player.a', 0, 100000), 'media_player.b');
  assert.equal(app.playingSpeaker(store, speakers, 'media_player.a', 50000, 100000), 'media_player.a');
  assert.equal(app.playingSpeaker({}, speakers, 'media_player.a', 0, 100000), 'media_player.a');
  const both = { 'media_player.a': { s: 'playing', a: {} }, 'media_player.b': { s: 'playing', a: {} } };
  assert.equal(app.playingSpeaker(both, speakers, 'media_player.b', 0, 100000), 'media_player.b');
});

test('nextVolume steps by 5% inside 0..1', () => {
  assert.equal(app.nextVolume(0.4, 1), 0.45);
  assert.equal(app.nextVolume(0.02, -1), 0);
  assert.equal(app.nextVolume(0.99, 1), 1);
});

test('parseRecipes reads the garfinho.search response and tolerates gaps', () => {
  const r = app.parseRecipes({ response: { recipes: [{ id: 'a', title: 'Bolo', image: 'http://x/y.jpg', tags: ['Fácil'], ingredients: ['ovo'] }, { id: 'b' }] } });
  assert.deepEqual(r[0], { id: 'a', title: 'Bolo', image: 'http://x/y.jpg', tags: ['Fácil'], ingredients: ['ovo'] });
  assert.deepEqual(r[1], { id: 'b', title: '', image: '', tags: [], ingredients: [] });
  assert.deepEqual(app.parseRecipes(null), []);
});

test('recipe helpers: thumbnails, tag labels, search data, ingredient list', () => {
  assert.equal(app.thumbUrl('https://buildfire.imgix.net/a/b.jpg?width=1350&height=1350', 320, 200), 'https://buildfire.imgix.net/a/b.jpg?width=320&height=200&fit=crop');
  assert.equal(app.thumbUrl('https://other.example/b.jpg?x=1', 320, 200), 'https://other.example/b.jpg?x=1');
  assert.equal(app.tagLabel('🌱 Vegana'), 'Vegana');
  assert.equal(app.tagLabel('❄️ Congelável'), 'Congelável');
  assert.equal(app.tagLabel('Até 30 min'), 'Até 30 min');
  assert.deepEqual(app.recipeSearchData('', []), { limit: 100, sort: 'title' });
  assert.deepEqual(app.recipeSearchData('abóbora', ['Fácil']), { limit: 100, sort: 'relevance', text: 'abóbora', tags: ['Fácil'] });
  assert.deepEqual(app.recipeIngredients({ ingredients: ['abóbora', 'Nutricionista Ana', 'azeite'] }), ['abóbora', 'azeite']);
});

test('recipe search goes out without a target and comes back as an update', () => {
  const s = app.initialState();
  const out = app.recipeCall(s, 'q1', { limit: 5 });
  assert.equal(out.send[0].domain, 'garfinho');
  assert.equal(out.send[0].target, undefined);
  assert.equal(out.send[0].return_response, true);
  const id = out.send[0].id;
  const ok = app.handleMessage(s, { type: 'result', id, success: true, result: { response: { recipes: [{ id: 'a', title: 'Bolo' }] } } }, {});
  assert.equal(ok.update.kind, 'recipes');
  assert.equal(ok.update.key, 'q1');
  assert.equal(ok.update.items[0].title, 'Bolo');
  const id2 = app.recipeCall(s, 'q2', {}).send[0].id;
  assert.equal(app.handleMessage(s, { type: 'result', id: id2, success: false }, {}).update.kind, 'recipes-failed');
});

test('serviceCall without an entity sends no target', () => {
  const s = app.initialState();
  const m = app.serviceCall(s, 'garfinho', 'add_favorite', null, { recipe_id: 'x' }).send[0];
  assert.equal(m.target, undefined);
  assert.deepEqual(m.service_data, { recipe_id: 'x' });
});

test('parseRecipeHtml splits ingredients, steps and notes', () => {
  const html = '<h4>Ingredientes:</h4>\n<ul>\n<li>500g de abóbora</li>\n<li>2 colheres de azeite</li>\n</ul>\n<h4>Cobertura:</h4><ul><li>1 &amp; 2</li></ul>\n<h4>Como preparar:</h4>\n<ol>\n<li>Asse.</li>\n<li>Sirva&nbsp;quente. </li>\n</ol>\n<p>Armazenamento: 3 dias.</p>';
  const r = app.parseRecipeHtml(html);
  assert.deepEqual(r.groups, [{ title: '', items: ['500g de abóbora', '2 colheres de azeite'] }, { title: 'Cobertura', items: ['1 & 2'] }]);
  assert.deepEqual(r.steps, ['Asse.', 'Sirva quente.']);
  assert.deepEqual(r.notes, ['Armazenamento: 3 dias.']);
  assert.deepEqual(app.parseRecipeHtml(''), { groups: [], steps: [], notes: [] });
});

test('recipe text is requested over the websocket and returned parsed', () => {
  const s = app.initialState();
  const m = app.recipeContentCall(s, 'rid').send[0];
  assert.deepEqual([m.type, m.recipe_id], ['garfinho/recipe', 'rid']);
  const ok = app.handleMessage(s, { type: 'result', id: m.id, success: true, result: { html: '<ol><li>A</li></ol>' } }, {});
  assert.equal(ok.update.kind, 'recipe-content');
  assert.deepEqual(ok.update.content.steps, ['A']);
  const m2 = app.recipeContentCall(s, 'r2').send[0];
  assert.equal(app.handleMessage(s, { type: 'result', id: m2.id, success: false }, {}).update.content, null);
});

test('parseRecipeHtml treats bold paragraph headings as headings, not notes', () => {
  const html = '<p><em><strong>Opção: forma grande. </strong></em></p>\n<p><strong>Ingredientes:</strong></p>\n<ul><li>1 lata</li></ul>\n<p><strong>Modo de preparo:</strong></p>\n<ol><li>Bata.</li><li>Asse.</li></ol>\n<p><strong>Obs: </strong>Cremoso.</p>';
  const r = app.parseRecipeHtml(html);
  assert.deepEqual(r.groups, [{ title: '', items: ['1 lata'] }]);
  assert.deepEqual(r.steps, ['Bata.', 'Asse.']);
  assert.deepEqual(r.notes, ['Opção: forma grande.', 'Obs: Cremoso.']);
});

test('parseBrowse keeps playable spotify items; playTarget picks tracks or context', () => {
  const items = app.parseBrowse({ children: [
    { title: 'Mix', media_content_id: 'spotify:playlist:1', media_content_type: 'playlist', thumbnail: 'https://i/x.jpg' },
    { title: 'Folder', media_content_id: 'spotify_user_playlists' },
    { title: 'Song', media_content_id: 'spotify:track:9', media_content_type: 'track' },
  ] });
  assert.deepEqual(items.map((i) => i.title), ['Mix', 'Song']);
  assert.deepEqual(app.playTarget(items[0], 'Office'), { service: 'player_media_play_context', data: { context_uri: 'spotify:playlist:1', device_id: 'Office' } });
  assert.deepEqual(app.playTarget(items[1], 'Office'), { service: 'player_media_play_tracks', data: { uris: 'spotify:track:9', device_id: 'Office' } });
  assert.deepEqual(app.parseBrowse(null), []);
  const s = app.initialState();
  const m = app.browseCall(s, 'media_player.sp', 'spotify_user_playlists').send[0];
  assert.equal(app.handleMessage(s, { type: 'result', id: m.id, success: true, result: { children: [] } }, {}).update.shelf, 'spotify_user_playlists');
});

test('haBase and haSocketUrl default to https and keep a LAN scheme and port', () => {
  assert.equal(app.haSocketUrl('x.ui.nabu.casa'), 'wss://x.ui.nabu.casa/api/websocket');
  assert.equal(app.haSocketUrl('http://192.168.0.10:8123'), 'ws://192.168.0.10:8123/api/websocket');
  assert.equal(app.haSocketUrl('https://ha.example.com/'), 'wss://ha.example.com/api/websocket');
  assert.equal(app.haBase('http://192.168.0.10:8123'), 'http://192.168.0.10:8123');
});

test('domainOf sends switches to the switch domain', () => {
  assert.equal(app.domainOf('switch.plug'), 'switch');
  assert.equal(app.domainOf('light.kitchen'), 'light');
});

test('colorView shows swatches for colour lights and rings the nearest one', () => {
  assert.deepEqual(app.colorView({ s: 'on', a: { supported_color_modes: ['color_temp'] } }), { supported: false, current: -1 });
  assert.deepEqual(app.colorView({ s: 'on', a: { supported_color_modes: ['color_temp', 'xy'], color_mode: 'xy',
    rgb_color: [10, 20, 250] } }), { supported: true, current: 5 });
  assert.deepEqual(app.colorView({ s: 'on', a: { supported_color_modes: ['color_temp', 'hs'], color_mode: 'color_temp',
    rgb_color: [255, 180, 100] } }), { supported: true, current: -1 }, 'white mode rings nothing');
  assert.deepEqual(app.colorView({ s: 'off', a: { supported_color_modes: ['rgb'] } }), { supported: true, current: -1 });
  assert.deepEqual(app.colorView(undefined), { supported: false, current: -1 });
});

test('Music Assistant: library and search calls ask for a response', () => {
  const s = app.initialState();
  const lib = app.maLibraryCall(s, 'entry1', 'radio').send[0];
  assert.deepEqual(lib.service_data, { config_entry_id: 'entry1', media_type: 'radio', limit: 60 });
  assert.equal(lib.domain + '.' + lib.service, 'music_assistant.get_library');
  assert.equal(lib.return_response, true);
  const q = app.maSearchCall(s, 'entry1', 'jazz').send[0];
  assert.equal(q.service, 'search');
  assert.equal(q.service_data.name, 'jazz');
  assert.deepEqual(s.pending[q.id], { kind: 'browse', shelf: 'search', ma: true });
});

test('parseMa reads library items and flattens search groups', () => {
  const lib = { response: { items: [
    { media_type: 'radio', uri: 'library://radio/1', name: 'Couleur 3', image: 'http://ma/img/1' },
    { media_type: 'track', uri: 'library://track/2', name: 'La Bohème', artists: [{ name: 'Aznavour' }], image: null },
    { media_type: 'track', name: 'no uri' },
  ] } };
  assert.deepEqual(app.parseMa(lib), [
    { title: 'Couleur 3', uri: 'library://radio/1', type: 'radio', thumb: 'http://ma/img/1' },
    { title: 'La Bohème · Aznavour', uri: 'library://track/2', type: 'track', thumb: '' },
  ]);
  const search = { response: { tracks: [{ media_type: 'track', uri: 't', name: 'T' }], radio: [{ media_type: 'radio', uri: 'r', name: 'R' }], artists: [] } };
  assert.deepEqual(app.parseMa(search).map((t) => t.uri), ['r', 't']);
  assert.deepEqual(app.parseMa(null), []);
});

test('handleMessage routes a Music Assistant result to the browse update', () => {
  const s = app.initialState();
  const id = app.maLibraryCall(s, 'e', 'playlist').send[0].id;
  const out = app.handleMessage(s, { id, type: 'result', success: true, result: { response: { items: [{ media_type: 'playlist', uri: 'p', name: 'P' }] } } }, {});
  assert.deepEqual(out.update, { kind: 'browse', shelf: 'playlist', items: [{ title: 'P', uri: 'p', type: 'playlist', thumb: '' }] });
});

test('photoUrls takes one photo or a list and puts the HA address in front of /local paths', () => {
  const host = 'http://192.168.0.10:8123';
  assert.deepEqual(app.photoUrls({ host }), []);
  assert.deepEqual(app.photoUrls({ host, background: '/local/a.jpg' }), ['http://192.168.0.10:8123/local/a.jpg']);
  assert.deepEqual(app.photoUrls({ host, background: ['/local/a.jpg', 'https://x/b.jpg'] }),
    ['http://192.168.0.10:8123/local/a.jpg', 'https://x/b.jpg']);
});

test('slide shows a landscape alone and pairs a portrait with the next portrait', () => {
  const order = ['p1', 'l1', 'l2', 'p2', 'p3'];
  const dims = { p1: { w: 600, h: 900 }, l1: { w: 1280, h: 800 }, l2: { w: 1600, h: 900 }, p2: { w: 768, h: 1024 }, p3: { w: 600, h: 900 } };
  assert.deepEqual(app.slide(order, 0, dims, 6), ['p1', 'p2']);
  assert.deepEqual(app.slide(order, 1, dims, 6), ['l1']);
  assert.deepEqual(app.slide(order, 3, dims, 6), ['p2', 'p3']);
  assert.deepEqual(app.slide(order, 4, dims, 6), ['p3', 'p1'], 'wraps around');
  assert.deepEqual(app.slide(order, 0, dims, 2), ['p1'], 'no portrait within reach');
  assert.deepEqual(app.slide(['p1'], 0, dims, 6), ['p1']);
  assert.equal(app.isPortrait(undefined), false);
});

test('shuffled keeps every photo once and leaves the input alone', () => {
  const list = ['a', 'b', 'c', 'd'];
  const out = app.shuffled(list, () => 0);
  assert.deepEqual([...out].sort(), list);
  assert.deepEqual(list, ['a', 'b', 'c', 'd']);
  assert.deepEqual(out, ['b', 'c', 'd', 'a']);
});

test('todoLists takes one list or several, with or without names', () => {
  assert.deepEqual(app.todoLists({}), []);
  assert.deepEqual(app.todoLists({ todo: 'todo.a' }), [{ id: 'todo.a', name: '' }]);
  assert.deepEqual(app.todoLists({ todo: ['todo.a', { id: 'todo.b', name: 'Maison' }, { name: 'no id' }] }),
    [{ id: 'todo.a', name: '' }, { id: 'todo.b', name: 'Maison' }]);
});

test('protocol: several todo lists are fetched in one call and routed per list', () => {
  const cfg = { token: 't', weather: 'w', calendars: [], todo: ['todo.frame', { id: 'todo.home', name: 'Maison' }] };
  let out = app.handleMessage(app.initialState(), { type: 'auth_ok' }, cfg);
  assert.ok(out.send[0].entity_ids.includes('todo.home'));
  const get = out.send.find(m => m.domain === 'todo');
  assert.deepEqual(get.target, { entity_id: ['todo.frame', 'todo.home'] });
  const result = JSON.parse(JSON.stringify(require('./fixtures/get_items.json').result));
  result.response['todo.home'] = { items: [{ summary: 'Arroser', uid: 'h1', status: 'needs_action' }] };
  out = app.handleMessage(out.state, { id: get.id, type: 'result', success: true, result }, cfg);
  assert.equal(out.update.lists['todo.frame'].length, 4);
  assert.deepEqual(out.update.lists['todo.home'].map(t => t.summary), ['Arroser']);
});

test('solarView reads power and energy in any unit and words the flows', () => {
  const s = { soc: 'sensor.soc', battery: 'sensor.bat', importToday: 'sensor.imp', exportToday: 'sensor.exp', grid: 'sensor.grid' };
  const store = {
    'sensor.soc': { s: '78.4', a: { unit_of_measurement: '%' } },
    'sensor.bat': { s: '1.25', a: { unit_of_measurement: 'kW' } },
    'sensor.imp': { s: '3400', a: { unit_of_measurement: 'Wh' } },
    'sensor.exp': { s: '6.2', a: { unit_of_measurement: 'kWh' } },
    'sensor.grid': { s: '-640', a: { unit_of_measurement: 'W' } },
  };
  const v = app.solarView(store, s);
  assert.equal(v.soc, 78);
  assert.equal(v.battery, 1250);
  assert.equal(v.batteryText, 'En charge');
  assert.equal(v.importToday, 3.4);
  assert.equal(v.exportToday, 6.2);
  assert.equal(v.gridText, 'Revend au réseau');
  assert.deepEqual(v.cards, { pv: false, home: false, battery: true, grid: true });
  assert.equal(app.solarView({ 'sensor.c': { s: '2.5', a: { unit_of_measurement: 'kWh' } } }, { chargeToday: 'sensor.c' }).chargeToday, 2.5);
  const flipped = app.solarView(store, { ...s, invertBattery: true });
  assert.equal(flipped.batteryText, 'En décharge');
  assert.equal(app.solarView({ 'sensor.soc': { s: 'unavailable', a: {} } }, s).soc, null);
});

test('fmtPower switches to kW from 1000 W and drops the sign', () => {
  assert.deepEqual(app.fmtPower(850), ['850', 'W']);
  assert.deepEqual(app.fmtPower(-2340), ['2.3', 'kW']);
  assert.deepEqual(app.fmtPower(null), ['—', '']);
  assert.deepEqual(app.solarIds({ soc: 'sensor.a', invertGrid: true, grid: 'sensor.b' }), ['sensor.b', 'sensor.a']);
});

test('roomTemps formats each room, naming it from HA when the config does not', () => {
  const store = { 'sensor.a': { s: '21.34', a: { friendly_name: 'Salon temp' } }, 'sensor.b': { s: 'unavailable', a: {} } };
  assert.deepEqual(app.roomTemps(store, [{ id: 'sensor.a', name: 'Salon' }, { id: 'sensor.b', name: 'Chambre' }, { id: 'sensor.a' }]),
    [{ name: 'Salon', text: '21.3°', hum: '' }, { name: 'Chambre', text: '—', hum: '' }, { name: 'Salon temp', text: '21.3°', hum: '' }]);
  assert.equal(app.roomTemps({ 'sensor.h': { s: '54.6', a: {} } }, [{ id: 'sensor.a', humidity: 'sensor.h' }])[0].hum, '55 %');
});

test('roomIcon picks a pictogram from the room name, or the configured one', () => {
  assert.equal(app.roomIcon('Salon'), 'sofa');
  assert.equal(app.roomIcon('Living room'), 'sofa');
  assert.equal(app.roomIcon('Chambre'), 'bed');
  assert.equal(app.roomIcon('Our room'), 'bed');
  assert.equal(app.roomIcon('Cuisine'), 'kitchen');
  assert.equal(app.roomIcon('Cave à vin'), 'garage');
  assert.equal(app.roomIcon('Piscine'), 'pool');
  assert.equal(app.roomIcon('Jardin'), 'outdoor');
  assert.equal(app.roomIcon('Grenier'), 'thermo');
  assert.equal(app.roomIcon('Salon', 'desk'), 'desk');
  assert.equal(app.roomIcon('Salon', 'nope'), 'sofa');
});

test('weatherDetails fills in for MeteoSwiss: computed feels-like, dew point without gusts, rain in mm', () => {
  const ms = { s: 'rainy', a: { temperature: 11.2, humidity: 88, pressure: 954.1, wind_bearing: 261, wind_speed: 12.2 } };
  const t = app.weatherDetails(ms, { rain: null, mm: 4.2 });
  assert.equal(t[0].value, '9°');
  assert.equal(t[0].note, 'Plus froid que l’air');
  assert.equal(t[2].label, 'Point de rosée');
  assert.equal(t[2].value, '9°');
  assert.equal(t[2].note, 'Brouillard possible');
  assert.deepEqual([t[4].value, t[4].unit], ['4.2', 'mm']);
  const withGust = app.weatherDetails(ms, { gust: 31, rain: 60, mm: 2 });
  assert.deepEqual([withGust[2].label, withGust[2].value], ['Rafales', '31']);
  assert.deepEqual([withGust[4].value, withGust[4].unit, withGust[4].note], ['60', '%', '2 mm prévus']);
  assert.equal(Math.round(app.apparentTemp(30, 60, 0)), 34);
});

test('solarView reads the Forecast.Solar forecast and peak time', () => {
  const store = {
    'sensor.energy_production_today': { s: '5.24', a: { unit_of_measurement: 'kWh' } },
    'sensor.energy_production_tomorrow': { s: '7800', a: { unit_of_measurement: 'Wh' } },
    'sensor.power_highest_peak_time_today': { s: '2026-10-14T11:15:00+00:00', a: {} },
  };
  const v = app.solarView(store, { forecastToday: 'sensor.energy_production_today', forecastTomorrow: 'sensor.energy_production_tomorrow',
    peakToday: 'sensor.power_highest_peak_time_today' });
  assert.equal(v.forecastToday, 5.24);
  assert.equal(v.forecastTomorrow, 7.8);
  assert.equal(v.peak, '13:15');
  assert.equal(v.cards.pv, true);
  assert.equal(app.peakTime({ s: 'unknown' }), '');
});

test('solarView adds today\'s production to a remaining-only forecast', () => {
  const store = { 'sensor.pv_today': { s: '0.6', a: { unit_of_measurement: 'kWh' } },
    'sensor.rem': { s: '10.9052638669532', a: { unit_of_measurement: 'kWh' } }, 'sensor.d2': { s: '39.69', a: { unit_of_measurement: 'kWh' } } };
  const v = app.solarView(store, { pvToday: 'sensor.pv_today', forecastRemaining: 'sensor.rem', forecastDay2: 'sensor.d2' });
  assert.equal(Math.round(v.forecastToday * 10) / 10, 11.5);
  assert.equal(v.forecastDay2, 39.69);
});

test('weatherDetails prefers a gust sensor over the dew point', () => {
  const ms = { s: 'rainy', a: { temperature: 11.2, humidity: 88, wind_speed: 12.2 } };
  const t = app.weatherDetails(ms, null, { s: '22.7', a: {} });
  assert.deepEqual([t[2].label, t[2].value], ['Rafales', '23']);
  assert.equal(app.weatherDetails(ms, null, { s: 'unavailable', a: {} })[2].label, 'Point de rosée');
});
