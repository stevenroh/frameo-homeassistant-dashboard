'use strict';
// Climate tab: one card per thermostat.

// --- climate ---

// One +/- press on a thermostat: move by the entity's own step, stay inside its range.
function nextTarget(a, dir) {
  var step = a.target_temp_step || 0.5;
  var base = a.temperature != null ? a.temperature : (a.current_temperature || 20);
  var v = Math.round((base + dir * step) / step) * step;
  v = Math.min(a.max_temp != null ? a.max_temp : 30, Math.max(a.min_temp != null ? a.min_temp : 5, v));
  return Math.round(v * 10) / 10;
}

var ACTIONS = { heating: 'Chauffe', idle: 'Au repos', off: 'Arrêt', cooling: 'Refroidit', drying: 'Déshumidifie', fan: 'Ventilation' };
var MODES = { off: 'Arrêt', auto: 'Auto', heat: 'Chauffage' };

// Room pictograms for the sensor and light cards, picked from the room's name (French or English) unless cfg sets "icon".
var ROOM_ICONS = {
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"></path><path d="M3 13a2 2 0 0 1 4 0v1h10v-1a2 2 0 0 1 4 0v4H3z"></path><path d="M5 17v2M19 17v2"></path>',
  bed: '<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"></path><circle cx="7" cy="11" r="1.6"></circle>',
  kitchen: '<path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path><path d="M2.5 10h19M9 6.5c0-1 1-1.5 1-2.5M14 6.5c0-1 1-1.5 1-2.5"></path>',
  desk: '<rect x="4" y="4" width="16" height="11" rx="1.5"></rect><path d="M9 20h6M12 15v5"></path>',
  bath: '<path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z"></path><path d="M6 12V6a2 2 0 0 1 3.5-1.3M7 19l-1 2M17 19l1 2"></path>',
  kid: '<circle cx="12" cy="7" r="3"></circle><path d="M6 21v-2a6 6 0 0 1 12 0v2"></path>',
  garage: '<path d="M3 21V9l9-5 9 5v12"></path><path d="M7 21v-8h10v8M7 16h10"></path>',
  pool: '<path d="M3 18c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"></path><path d="M8 15V5.5a2 2 0 0 1 4 0M16 15V5.5a2 2 0 0 0-4 0M8 9h8M8 12.5h8"></path>',
  outdoor: '<path d="M12 22v-6M8 16h8l-4-7z"></path><path d="M9.5 11.5L12 7l2.5 4.5M10.5 7.5L12 4l1.5 3.5"></path>',
  thermo: '<path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"></path>',
};
var ROOM_MATCH = [
  [/salon|living|s[ée]jour|lounge/, 'sofa'], [/chambre|bed|room|nuit/, 'bed'], [/cuisine|kitchen/, 'kitchen'],
  [/bureau|office|study/, 'desk'], [/bain|bath|douche|shower/, 'bath'], [/enfant|kid|b[ée]b[ée]|nursery/, 'kid'],
  [/garage|cave|cellier|cellar|atelier/, 'garage'], [/piscine|pool|spa/, 'pool'], [/jardin|ext[ée]rieur|garden|terrasse|outside/, 'outdoor'],
];
function roomIconSvg(name, icon, size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ROOM_ICONS[roomIcon(name, icon)] + '</svg>';
}
function roomIcon(name, icon) {
  if (icon && ROOM_ICONS[icon]) return icon;
  var n = String(name || '').toLowerCase();
  for (var i = 0; i < ROOM_MATCH.length; i++) if (ROOM_MATCH[i][0].test(n)) return ROOM_MATCH[i][1];
  return 'thermo';
}
var DROP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"></path></svg>';

function climateView(e) {
  var a = (e && e.a) || {};
  var unavailable = !e || e.s === 'unavailable' || e.s === 'unknown';
  return {
    name: a.friendly_name || '',
    current: a.current_temperature != null ? a.current_temperature.toFixed(1) + '°' : '—',
    target: e && e.s === 'off' ? 'Arrêt' : (a.temperature != null ? a.temperature.toFixed(1) + '°' : '—'),
    mode: e ? e.s : 'unavailable',
    action: ACTIONS[a.hvac_action] || '',
    canAdjust: !unavailable && e.s !== 'off',
    unavailable: unavailable,
  };
}


function climateTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var store = ctx.store;
  var setText = ctx.setText;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var sendAll = ctx.sendAll;
  var state = null;
  var climateIds = cfg.climate || [];
  var rooms = cfg.temperatures || []; // plain sensors: a read-only card each, after the thermostats
  var roomIds = rooms.reduce(function (a, r) { return a.concat(r.humidity ? [r.id, r.humidity] : [r.id]); }, []);
  if (!climateIds.length && !rooms.length) $('nav-climate').style.display = 'none';
  var heldTarget = {}; // entity -> target shown while a +/- burst is waiting to be sent
  var sendTimers = {};

  function renderClimate() {
    if (ctx.view() !== 'climate') return;
    var heating = climateIds.filter(function (id) { return climateView(store[id]).action === 'Chauffe'; }).length;
    var w = store[cfg.weather];
    var parts = [];
    if (w && w.a.temperature != null) parts.push('Dehors ' + Math.round(w.a.temperature) + '°');
    if (climateIds.length) parts.push(heating ? heating + (heating === 1 ? ' pièce chauffe' : ' pièces chauffent') : 'Rien ne chauffe');
    setText('climate-sub', parts.join(' · '));
    setHTML('climate-grid', climateIds.map(function (id) {
      var v = climateView(store[id]);
      var target = heldTarget[id] != null ? heldTarget[id].toFixed(1) + '°' : v.target;
      var modes = ['off', 'auto', 'heat'].map(function (m) {
        return '<button class="seg' + (v.mode === m ? ' on' : '') + '" data-act="mode" data-id="' + id +
          '" data-mode="' + m + '"' + (v.unavailable ? ' disabled' : '') + '><span class="chk">' + CHECK + '</span>' +
          MODES[m] + '</button>';
      }).join('');
      var status = v.unavailable ? 'Indisponible' : v.action;
      return '<div class="clim' + (v.unavailable ? ' unavail' : '') + '"><div class="clim-head"><span class="clim-name">' +
        esc(v.name) + '</span>' + (status ? '<span class="chip clim-act' + (v.action === 'Chauffe' ? ' heating' : '') + '">' +
        (v.action === 'Chauffe' ? FLAME : '') + status + '</span>' : '') + '</div>' +
        '<div class="clim-body"><div><div class="clim-nowl">Actuel</div><div class="clim-now">' + v.current + '</div></div>' +
        '<div class="clim-set"><button class="round" data-act="minus" data-id="' + id + '"' + (v.canAdjust ? '' : ' disabled') +
        ' aria-label="Baisser">' + MINUS + '</button><div class="clim-target"><div class="clim-tl">Consigne</div><div class="clim-tv">' +
        target + '</div></div><button class="round plus" data-act="plus"data-id="' + id + '"' + (v.canAdjust ? '' : ' disabled') +
        ' aria-label="Monter">' + PLUS + '</button></div></div><div class="segs">' + modes + '</div></div>';
    }).join('') + roomTemps(store, rooms).map(function (r, i) {
      return '<div class="clim sensor' + (r.text === '—' ? ' unavail' : '') + '"><div class="cs-head"><span class="cs-ic">' +
        roomIconSvg(r.name, rooms[i].icon, 28) + '</span><span class="clim-name">' + esc(r.name) + '</span></div>' +
        '<div class="cs-body"><span class="cs-t">' + r.text + '</span>' + (r.hum ? '<span class="cs-h">' + DROP + r.hum + '</span>' : '') + '</div></div>';
    }).join(''));
    // Sensors alone: compact cards from the top instead of rows stretched to the bottom.
    $('climate-grid').className = climateIds.length ? '' : 'sensors-only';
  }

  function bumpTarget(id, dir) {
    var e = store[id];
    if (!e) return;
    var a = Object.assign({}, e.a, heldTarget[id] != null ? { temperature: heldTarget[id] } : {});
    heldTarget[id] = nextTarget(a, dir);
    renderClimate();
    // Send once the taps stop, so five quick presses are one call.
    clearTimeout(sendTimers[id]);
    sendTimers[id] = setTimeout(function () {
      var t = heldTarget[id];
      if (t == null) return;
      sendAll(serviceCall(state, 'climate', 'set_temperature', id, { temperature: t }).send);
      setTimeout(function () { if (heldTarget[id] === t) { delete heldTarget[id]; renderClimate(); } }, 8000);
    }, 1200);
  }

  $('climate-grid').onclick = function (ev) {
    var b = ev.target.closest('button');
    if (!b || b.disabled || !state) return;
    var id = b.getAttribute('data-id');
    var act = b.getAttribute('data-act');
    if (act === 'plus') bumpTarget(id, 1);
    else if (act === 'minus') bumpTarget(id, -1);
    else if (act === 'mode') {
      delete heldTarget[id];
      clearTimeout(sendTimers[id]);
      sendAll(serviceCall(state, 'climate', 'set_hvac_mode', id, { hvac_mode: b.getAttribute('data-mode') }).send);
    }
  };

  return {
    onConnecting: function (s) { state = s; },
    onView: function () { renderClimate(); },
    onUpdate: function (u, changed) {
      if (u.kind === 'action-failed' || u.kind === 'entities' && climateIds.concat(roomIds).some(function (id) { return changed.has(id); })) {
        renderClimate();
      }
    },
  };
}
