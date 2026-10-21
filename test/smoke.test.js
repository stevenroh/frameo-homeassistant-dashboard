'use strict';
// Runs start() against a fake DOM and socket: every tab shown, every button clicked, every message kind fed in. Catches
// what the unit tests cannot, such as a name start() uses that no page script defines.
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./page.js');
const config = require('../secrets/config.example.json');
const initial = require('./fixtures/entities-initial.json');
const diff = require('./fixtures/entities-diff.json');
const events = require('./fixtures/get_events.json');
const forecasts = require('./fixtures/get_forecasts.json');
const items = require('./fixtures/get_items.json');

// An element that has every property: unknown ones read as undefined, functions are no-ops, writes are kept.
function element(id) {
  const props = {
    id, style: { setProperty() {} }, className: '', textContent: '', innerHTML: '', value: '', disabled: false,
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(k, v) { this['@' + k] = String(v); },
    getAttribute(k) { return '@' + k in this ? this['@' + k] : null; },
    closest() { return null; },
    focus() {}, blur() {},
  };
  return new Proxy(props, { get: (t, k) => (k in t ? t[k] : undefined) });
}

function browser() {
  const els = {};
  const listeners = {};
  const timers = [];
  const sockets = [];
  class WebSocket {
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  const store = {};
  return {
    els, timers, sockets,
    fire: (type) => listeners[type](),
    globals: {
      window: {},
      document: {
        documentElement: { className: '' },
        getElementById: (id) => els[id] || (els[id] = element(id)),
        addEventListener: (type, fn) => { listeners[type] = fn; },
      },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
      location: { reload() {} },
      WebSocket,
      setTimeout: (fn, ms) => timers.push({ fn, ms, every: false }),
      setInterval: (fn, ms) => timers.push({ fn, ms, every: true }),
      clearTimeout() {}, clearInterval() {},
    },
  };
}

const speakers = config.music.speakers;
const playing = { id: 1, type: 'event', event: {
  a: {
    [speakers[0].id]: { s: 'playing', a: { friendly_name: 'Kitchen', media_title: 'Song', media_artist: 'Band',
      volume_level: 0.4, media_duration: 200, media_position: 20 } },
    [config.climate[0]]: { s: 'heat', a: { friendly_name: 'Living room', current_temperature: 19.5, temperature: 20,
      hvac_action: 'heating', min_temp: 5, max_temp: 30 } },
    [config.lights[0].id]: { s: 'on', a: { friendly_name: 'Ceiling', brightness: 128 } },
    [config.ev.power]: { s: '7.2', a: {} },
    [config.ev.prices]: { s: '0.21', a: { today: [0.2, 0.25, 0.3] } },
    [config.recipes.favorites]: { s: '1', a: { recipes: [] } },
  },
} };

test('start() runs every tab, button and message without throwing', () => {
  const b = browser();
  const ui = page.load(b.globals).start(config);
  const ws = b.sockets[0];
  const feed = (msg) => ws.onmessage({ data: JSON.stringify(msg) });

  feed({ type: 'auth_required' });
  assert.equal(ws.sent[0].type, 'auth');
  feed({ type: 'auth_ok' });
  assert.equal(ws.sent[1].type, 'subscribe_entities');
  feed(initial);
  feed(diff);
  feed(playing);
  feed(events);
  feed(forecasts);
  feed(Object.assign({}, items, { id: 4 }));

  for (const v of ['home', 'forecast', 'calendar', 'climate', 'lights', 'music', 'ev', 'recipes']) {
    ui.showView(v);
    assert.equal(b.els['view-' + (v === 'calendar' ? 'cal' : v)].style.display, '', v + ' shown');
    feed({ id: 1, type: 'event', event: { c: { [speakers[0].id]: { '+': { a: { volume_level: 0.5 } } } } } });
  }

  // Click everything that has a handler, from every view; e.target is the element itself.
  for (const v of ['home', 'calendar', 'lights', 'music', 'recipes']) {
    ui.showView(v);
    for (const el of Object.values(b.els)) {
      if (typeof el.onclick === 'function') el.onclick({ target: el, preventDefault() {}, stopPropagation() {} });
    }
  }

  ui.onUpdate({ kind: 'action-failed', entity: config.lights[0].id, message: 'nope' });
  assert.match(b.els.toast.textContent, /Impossible de modifier Ceiling : nope/);

  // The refresh and keep-alive intervals, then the socket dropping and a reconnect.
  for (const t of b.timers.filter((t) => t.every)) t.fn();
  ws.close();
  b.timers[b.timers.length - 1].fn();
  assert.equal(b.sockets.length, 2);
});

test('real time arriving re-renders the calendar; 3 idle minutes go home and close the settings sheet', () => {
  const clock = { now: new Date(2020, 0, 15, 12).getTime() };
  class FrameDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const b = browser();
  b.globals.Date = FrameDate;
  b.globals.window = { Kiosk: { version: () => 'v1', updateUrl: () => '', setUpdateUrl() {}, update() {}, reset() {} } };
  const ui = page.load(b.globals).start(config);
  const tick = () => b.timers.filter((t) => t.fn.name === 'tick').pop().fn();

  ui.showView('calendar');
  assert.match(b.els['cal-grid'].innerHTML, / today/, 'the frame clock marks 15 Jan 2020 as today');
  clock.now = new Date(2026, 9, 19, 12).getTime();
  b.fire('touchstart');
  tick();
  assert.doesNotMatch(b.els['cal-grid'].innerHTML, / today/, 'redrawn with the real date');
  assert.equal(b.els['view-cal'].style.display, '', 'still on the calendar');

  b.els['nav-set'].onclick();
  assert.equal(b.els['set-sheet'].style.display, '');
  clock.now += 4 * 60000;
  tick();
  assert.equal(b.els['view-home'].style.display, '');
  assert.equal(b.els['set-sheet'].style.display, 'none');
});
