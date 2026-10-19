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

var ACTIONS = { heating: 'Heating', idle: 'Idle', off: 'Off', cooling: 'Cooling', drying: 'Drying', fan: 'Fan' };

function climateView(e) {
  var a = (e && e.a) || {};
  var unavailable = !e || e.s === 'unavailable' || e.s === 'unknown';
  return {
    name: a.friendly_name || '',
    current: a.current_temperature != null ? a.current_temperature.toFixed(1) + '°' : '—',
    target: e && e.s === 'off' ? 'Off' : (a.temperature != null ? a.temperature.toFixed(1) + '°' : '—'),
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
  var heldTarget = {}; // entity -> target shown while a +/- burst is waiting to be sent
  var sendTimers = {};

  function renderClimate() {
    if (ctx.view() !== 'climate') return;
    var heating = climateIds.filter(function (id) { return climateView(store[id]).action === 'Heating'; }).length;
    var w = store[cfg.weather];
    setText('climate-sub', (w && w.a.temperature != null ? 'Outside ' + Math.round(w.a.temperature) + '° · ' : '') +
      (heating ? heating + (heating === 1 ? ' room heating' : ' rooms heating') : 'Nothing heating'));
    setHTML('climate-grid', climateIds.map(function (id) {
      var v = climateView(store[id]);
      var target = heldTarget[id] != null ? heldTarget[id].toFixed(1) + '°' : v.target;
      var modes = ['off', 'auto', 'heat'].map(function (m) {
        return '<button class="seg' + (v.mode === m ? ' on' : '') + '" data-act="mode" data-id="' + id +
          '" data-mode="' + m + '"' + (v.unavailable ? ' disabled' : '') + '><span class="chk">' + CHECK + '</span>' +
          m.charAt(0).toUpperCase() + m.slice(1) + '</button>';
      }).join('');
      var status = v.unavailable ? 'Unavailable' : v.action;
      return '<div class="clim' + (v.unavailable ? ' unavail' : '') + '"><div class="clim-head"><span class="clim-name">' +
        esc(v.name) + '</span>' + (status ? '<span class="chip clim-act' + (v.action === 'Heating' ? ' heating' : '') + '">' +
        (v.action === 'Heating' ? FLAME : '') + status + '</span>' : '') + '</div>' +
        '<div class="clim-body"><div><div class="clim-nowl">Now</div><div class="clim-now">' + v.current + '</div></div>' +
        '<div class="clim-set"><button class="round" data-act="minus" data-id="' + id + '"' + (v.canAdjust ? '' : ' disabled') +
        ' aria-label="Lower">' + MINUS + '</button><div class="clim-target"><div class="clim-tl">Target</div><div class="clim-tv">' +
        target + '</div></div><button class="round plus" data-act="plus"data-id="' + id + '"' + (v.canAdjust ? '' : ' disabled') +
        ' aria-label="Raise">' + PLUS + '</button></div></div><div class="segs">' + modes + '</div></div>';
    }).join(''));
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
      if (u.kind === 'action-failed' || u.kind === 'entities' && climateIds.some(function (id) { return changed.has(id); })) {
        renderClimate();
      }
    },
  };
}
