'use strict';
// Shared by every tab: dates, icons, entity diffs, the websocket protocol, timing. Pure functions only.
// index.html loads this file first, the tab files next and app.js last; plain scripts, so they share one scope.

var DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];
// Juin and juillet share their first three letters, so short months are spelled out.
var MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

var CONDITIONS = {
  'clear-night': ['Dégagé', '☾'],
  cloudy: ['Nuageux', '☁'],
  exceptional: ['Exceptionnel', '!'],
  fog: ['Brouillard', '≋'],
  hail: ['Grêle', '❄'],
  lightning: ['Éclairs', '⚡'],
  'lightning-rainy': ['Orage', '⚡'],
  partlycloudy: ['Peu nuageux', '⛅'],
  pouring: ['Averses', '☂'],
  rainy: ['Pluie', '☂'],
  snowy: ['Neige', '❄'],
  'snowy-rainy': ['Neige fondue', '❄'],
  sunny: ['Ensoleillé', '☀'],
  windy: ['Venteux', '≈'],
  'windy-variant': ['Venteux', '≈'],
};

// Icon colours that read on both the day and night cards; clouds follow the text colour.
var AMBER = '#e09a2d';
var LIGHT = 'currentColor';
var RAIN = '#4F8FD9';
var MINUS = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"></path></svg>';
var PLUS = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"></path></svg>';
var CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';
var FLAME = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.6.3 1.6 1 2.6 2.1 3.1C11 9 11.2 5.5 12 3z"></path></svg>';
var BULB = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4"></path><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"></path></svg>';
var BULB_S = BULB.replace('width="24" height="24"', 'width="22" height="22"');
var CLOUD_PATH = 'M7 18.5h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 11.2 3.65 3.65 0 0 0 7 18.5z';
var CLOUD_HIGH = 'M7 15.5h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 8.2 3.65 3.65 0 0 0 7 15.5z';
var ICONS = {
  sun: '<circle cx="12" cy="12" r="4" stroke="' + AMBER + '"></circle><path stroke="' + AMBER +
    '" d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"></path>',
  night: '<path stroke="' + LIGHT + '" d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"></path>',
  partly: '<path stroke="' + AMBER + '" d="M8.5 3.5v1.2M3.6 8.6h1.2M5 5.1l.9.9M12.1 5.1l-.9.9M5.6 10.9A3.6 3.6 0 0 1 11.7 7.4"></path>' +
    '<path stroke="' + LIGHT + '" d="M9 20h8.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 8.4 13.6 3.2 3.2 0 0 0 9 20z"></path>',
  cloud: '<path stroke="' + LIGHT + '" d="' + CLOUD_PATH + '"></path>',
  rain: '<path stroke="' + LIGHT + '" d="' + CLOUD_HIGH + '"></path><path stroke="' + RAIN +
    '" d="M8.5 18.5l-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2"></path>',
  snow: '<path stroke="' + LIGHT + '" d="' + CLOUD_HIGH + '"></path><path stroke="' + LIGHT +
    '" d="M8 19.5h.01M12 20.5h.01M16 19.5h.01"></path>',
  storm: '<path stroke="' + LIGHT + '" d="' + CLOUD_HIGH + '"></path><path stroke="' + AMBER +
    '" d="M12.5 15.5l-2 3.5h3l-2 3.5"></path>',
};
var ICON_FOR = {
  sunny: 'sun', 'clear-night': 'night', partlycloudy: 'partly', cloudy: 'cloud', fog: 'cloud',
  windy: 'cloud', 'windy-variant': 'cloud', exceptional: 'cloud', rainy: 'rain', pouring: 'rain',
  snowy: 'snow', 'snowy-rainy': 'snow', hail: 'snow', lightning: 'storm', 'lightning-rainy': 'storm',
};

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// HA sends all-day dates as "YYYY-MM-DD"; new Date() would read those as UTC midnight.
function parseDate(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  return new Date(s);
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

function dayDiff(a, b) {
  return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
}

// Local time with its UTC offset, so HA reads the same instant whatever its own zone.
function localIso(d) {
  var off = -d.getTimezoneOffset();
  var sign = off >= 0 ? '+' : '-';
  off = Math.abs(off);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    sign + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
}

// The frame has no clock battery: every boot starts at 2021-05-15 02:00 until network time arrives.
function clockTrusted(d) { return d.getFullYear() >= 2025; }

function formatClock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
var formatTime = formatClock;

function formatDate(d) {
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}

function shortDate(d) {
  return DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
}

function dayLabel(d, now) {
  var diff = dayDiff(d, now);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Demain';
  return shortDate(d);
}

function conditionLabel(c) { return CONDITIONS[c] ? CONDITIONS[c][0] : '—'; }
function conditionIcon(c) { return CONDITIONS[c] ? CONDITIONS[c][1] : '·'; }

function weatherIcon(c, size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[ICON_FOR[c] || 'cloud'] + '</svg>';
}

// Android 6's emoji font predates most emoji (flags, ZWJ sequences show as boxes), so titles
// lose all of them: pictographs, misc symbols and dingbats, flags, skin tones, ZWJ, variation
// selectors, keycaps and tag characters. Text symbols like (c) stay.
var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{E0020}-\u{E007F}‍︎️⃣]/gu;
function cleanTitle(s) { return s.replace(EMOJI, '').replace(/\s+/g, ' ').trim(); }

// subscribe_entities messages: "a" = full entities, "c" = changes ("+" add/replace,
// "-" removed attributes), "r" = removed entities. Returns the set of changed ids.
function applyEntityDiff(store, ev) {
  var changed = new Set();
  var id;
  if (ev.a) {
    for (id in ev.a) {
      store[id] = { s: ev.a[id].s, a: Object.assign({}, ev.a[id].a) };
      changed.add(id);
    }
  }
  if (ev.c) {
    for (id in ev.c) {
      var cur = store[id] || (store[id] = { s: undefined, a: {} });
      var plus = ev.c[id]['+'];
      var minus = ev.c[id]['-'];
      if (plus) {
        if ('s' in plus) cur.s = plus.s;
        if (plus.a) Object.assign(cur.a, plus.a);
      }
      if (minus && minus.a) minus.a.forEach(function (k) { delete cur.a[k]; });
      changed.add(id);
    }
  }
  if (ev.r) {
    ev.r.forEach(function (rid) { delete store[rid]; changed.add(rid); });
  }
  return changed;
}

function msToNextMinute(now) {
  return 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

// Keep-alive: ping every 30 s; a ping still unanswered at the next tick means a dead socket.
// Each connection starts with a fresh record, so an old missed pong can't close a new socket.
function newKeepAlive() { return { deadline: null }; }
function keepAliveTick(ka, now) {
  if (ka.deadline && now > ka.deadline) return { action: 'close', ka: newKeepAlive() };
  return { action: 'ping', ka: { deadline: now + 10000 } };
}
function keepAlivePong() { return newKeepAlive(); }

function backoffDelay(attempt) { return Math.min(60000, 1000 * Math.pow(2, attempt)); }

function staleLabel(lastOk, now) {
  if (!lastOk) return 'Connexion…';
  var mins = Math.floor((now - lastOk) / 60000);
  return mins >= 2 ? 'Pas de connexion depuis ' + mins + ' min' : '';
}

// --- websocket protocol, as a reducer so it can be tested without a socket ---

function initialState() { return { nextId: 1, pending: {}, fatal: null, subId: null }; }

function calendarCall(id, cfg, serviceData) {
  return {
    id: id, type: 'call_service', domain: 'calendar', service: 'get_events',
    target: { entity_id: cfg.calendars }, service_data: serviceData, return_response: true,
  };
}

function call(state, kind, cfg) {
  var id = state.nextId++;
  state.pending[id] = kind;
  if (kind === 'calendar') {
    // No start: HA uses its own "now", so a wrong frame clock at boot can't skew the window.
    return calendarCall(id, cfg, { duration: { days: 14 } });
  }
  if (kind === 'todo') {
    return {
      id: id, type: 'call_service', domain: 'todo', service: 'get_items',
      target: { entity_id: todoIds(cfg) }, service_data: { status: 'needs_action' }, return_response: true,
    };
  }
  return {
    id: id, type: 'call_service', domain: 'weather', service: 'get_forecasts',
    target: { entity_id: cfg.weather }, service_data: { type: 'daily' }, return_response: true,
  };
}

function refresh(state, cfg, kind) {
  return { state: state, send: [call(state, kind, cfg)] };
}

// HA's base address from cfg.host: "xxx.ui.nabu.casa" means https; a LAN install gives the scheme and port,
// e.g. "http://192.168.1.10:8123". The websocket uses the matching ws/wss scheme.
function haBase(host) { return (/^https?:\/\//.test(host) ? host : 'https://' + host).replace(/\/+$/, ''); }
// cfg.background (one URL or a list) -> full photo URLs; "/local/x.jpg" is a file in HA's /config/www.
function photoUrls(cfg) {
  return [].concat(cfg.background || []).map(function (u) { return u.charAt(0) === '/' ? haBase(cfg.host) + u : u; });
}
function haSocketUrl(host) { return haBase(host).replace(/^http/, 'ws') + '/api/websocket'; }

// A user action (light toggle, thermostat change). The new state arrives through the subscription;
// only a failure comes back as an update.
function serviceCall(state, domain, service, entity, data) {
  var id = state.nextId++;
  state.pending[id] = { kind: 'action', entity: entity };
  return {
    state: state,
    send: [Object.assign({ id: id, type: 'call_service', domain: domain, service: service },
      entity ? { target: { entity_id: entity } } : {}, { service_data: data })],
  };
}

function handleMessage(state, msg, cfg) {
  var send = [];
  var update = null;
  if (msg.type === 'auth_required') {
    send.push({ type: 'auth', access_token: cfg.token });
  } else if (msg.type === 'auth_invalid') {
    state.fatal = msg.message || 'auth_invalid';
  } else if (msg.type === 'auth_ok') {
    state.subId = state.nextId++;
    var ids = [cfg.weather, 'sun.sun'].concat(cfg.gusts ? [cfg.gusts] : [], cfg.climate || [], (cfg.lights || []).map(function (l) { return l.id; }),
      todoIds(cfg), evIds(cfg.ev), solarIds(cfg.solar), (cfg.temperatures || []).reduce(function (a, t) { return a.concat(t.humidity ? [t.id, t.humidity] : [t.id]); }, []), (cfg.music && cfg.music.speakers || []).map(function (m) { return m.id; }),
      cfg.recipes && cfg.recipes.favorites ? [cfg.recipes.favorites] : []);
    send.push({ id: state.subId, type: 'subscribe_entities', entity_ids: ids });
    send.push(call(state, 'calendar', cfg));
    send.push(call(state, 'forecast', cfg));
    if (todoIds(cfg).length) send.push(call(state, 'todo', cfg));
  } else if (msg.type === 'event' && msg.id === state.subId) {
    update = { kind: 'entities', event: msg.event };
  } else if (msg.type === 'result' && state.pending[msg.id]) {
    var p = state.pending[msg.id];
    delete state.pending[msg.id];
    if (p.kind === 'action') {
      if (!msg.success) {
        update = { kind: 'action-failed', entity: p.entity, message: (msg.error && msg.error.message) || 'failed' };
      }
    } else if (p.kind === 'browse') {
      update = { kind: 'browse', shelf: p.shelf, items: msg.success ? (p.ma ? parseMa(msg.result) : parseBrowse(msg.result)) : null };
    } else if (p.kind === 'recipe-content') {
      update = { kind: 'recipe-content', rid: p.rid, content: msg.success ? parseRecipeHtml(msg.result && msg.result.html) : null };
    } else if (p.kind === 'recipes') {
      update = msg.success ? { kind: 'recipes', key: p.key, items: parseRecipes(msg.result) } : { kind: 'recipes-failed', key: p.key };
    } else if (msg.success) {
      if (p.kind === 'range') update = { kind: 'range', key: p.key, events: parseEvents(msg.result) };
      else if (p === 'calendar') update = { kind: 'calendar', events: parseEvents(msg.result) };
      else if (p === 'todo') update = { kind: 'todo', lists: todoIds(cfg).reduce(function (o, id) { o[id] = parseTodos(msg.result, id); return o; }, {}) };
      else update = { kind: 'forecast', days: parseForecast(msg.result, cfg.weather, 6) };
    }
  }
  return { state: state, send: send, update: update };
}

// Night runs from sunset to sunrise: sun.sun when HA has it, otherwise 19:00-07:00 on the frame's clock.
function isNight(sun, now) {
  if (sun && (sun.s === 'below_horizon' || sun.s === 'above_horizon')) return sun.s === 'below_horizon';
  var h = now.getHours();
  return h >= 19 || h < 7;
}

