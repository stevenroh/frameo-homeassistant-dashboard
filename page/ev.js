'use strict';
// EV tab: the charger, today's hourly prices and the smart-charging settings.

// --- EV charging ---

function evIds(ev) {
  if (!ev) return [];
  return Object.keys(ev).filter(function (k) { return k !== 'start' && k !== 'stop'; }).map(function (k) { return ev[k]; });
}

// A day of prices as 24 hourly values (Nord Pool reports 15-minute steps: the average of each hour).
function hourlyPrices(list) {
  if (!list || !list.length) return [];
  var per = Math.max(1, Math.round(list.length / 24));
  var out = [];
  for (var h = 0; h < 24 && (h + 1) * per <= list.length; h++) {
    var sum = 0;
    for (var i = 0; i < per; i++) sum += list[h * per + i];
    out.push(sum / per);
  }
  return out;
}

var CHARGER_STATE = {
  connected_charging: ['En charge', true], connected_requesting: ['En attente de la voiture', false],
  connected_finished: ['Terminé', false], disconnected: ['Non branché', false],
};

function num(e) { var v = e && parseFloat(e.s); return isFinite(v) ? v : null; }

// Entity store + config -> everything the EV tab shows.
function evView(store, ev, now) {
  function g(k) { return ev[k] ? store[ev[k]] : undefined; }
  var mode = g('mode');
  var st = CHARGER_STATE[mode && mode.s] || ['Inconnu', false];
  var power = num(g('power'));
  var cap = num(g('cap'));
  var prices = hourlyPrices(g('prices') && g('prices').a.today);
  var hour = now.getHours();
  var surplus = num(g('surplus'));
  var chargeMode = g('chargeMode');
  var ready = g('readyBy');
  var hours = num(g('hours'));
  var planned = !!chargeMode && chargeMode.s === 'Planned window';
  function on(k) { return !!g(k) && g(k).s === 'on'; }
  return {
    stateText: st[0], charging: st[1], pluggedIn: !!mode && mode.s !== 'disconnected' && mode.s !== 'unknown',
    kw: power == null ? '—' : (power / 1000).toFixed(1),
    session: num(g('session')), today: num(g('today')), month: num(g('month')),
    price: num(g('price')), cap: cap, prices: prices, hour: hour,
    hoursBelow: prices.filter(function (p) { return cap != null && p <= cap; }).length,
    modes: chargeMode ? (chargeMode.a.options || []) : [], mode: chargeMode ? chargeMode.s : '',
    planned: planned, plan: (g('plan') && g('plan').s) || '',
    ready: ready ? ready.s.slice(0, 5) : '', hours: hours,
    smart: on('smart'), solar: on('solar'), override: on('override'),
    surplus: surplus == null ? null : Math.max(0, surplus) / 1000,
  };
}

function stepTime(hhmm, dir) {
  var p = hhmm.split(':');
  var m = ((+p[0] * 60 + +p[1] + dir * 30) % 1440 + 1440) % 1440;
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}


function evTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var store = ctx.store;
  var setText = ctx.setText;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var sendAll = ctx.sendAll;
  var state = null;
  var ev = cfg.ev || null;
  var EV_ICONS = { minus: MINUS, plus: PLUS };

  function renderEV() {
    if (ctx.view() !== 'ev' || !ev) return;
    var v = evView(store, ev, new Date());
    setText('ev-state', v.stateText);
    $('ev-state').className = v.charging ? 'on' : '';
    setText('ev-kw', v.kw);
    function nt(x, l) { return '<span class="num-t"><b>' + (x == null ? '—' : x.toFixed(1)) + '</b><span>' + l + '</span></span>'; }
    setHTML('ev-nums', nt(v.session, 'kWh cette session') + nt(v.today, 'kWh aujourd’hui') + nt(v.month, 'kWh ce mois'));
    $('ev-start').disabled = !v.pluggedIn || v.charging;
    $('ev-stop').disabled = !v.charging;
    setHTML('ev-now', 'Prix actuel <b>' + (v.price == null ? '—' : '€' + v.price.toFixed(2)) + '</b> /kWh');
    setText('ev-below', v.cap == null ? '' : v.hoursBelow + ' heures sous votre plafond');
    var max = 0.1;
    v.prices.forEach(function (p) { if (p > max) max = p; });
    if (v.cap != null && v.cap > max) max = v.cap;
    max = max * 1.1;
    var bars = v.prices.map(function (p, h) {
      var cls = h === v.hour ? 'now' : (v.cap != null && p > v.cap ? 'hi' : '');
      return '<i class="' + cls + '" style="height:' + Math.round(p / max * 100) + '%"></i>';
    }).join('');
    $('ev-cap').style.bottom = v.cap == null ? '0' : Math.round(v.cap / max * 100) + '%';
    setText('ev-cap-l', v.cap == null ? '' : 'plafond €' + v.cap.toFixed(2));
    setHTML('ev-bars', '<span id="ev-cap" style="bottom:' + (v.cap == null ? 0 : Math.round(v.cap / max * 100)) + '%"><span id="ev-cap-l">' +
      (v.cap == null ? '' : 'plafond €' + v.cap.toFixed(2)) + '</span></span>' + bars);
    setHTML('ev-modes', v.modes.map(function (m) {
      return '<button class="seg' + (m === v.mode ? ' on' : '') + '" data-ev="mode" data-v="' + esc(m) + '">' + esc(m) + '</button>';
    }).join(''));
    setText('ev-plan-txt', v.plan);
    function step(key, label, note, value, dim) {
      return '<div class="step' + (dim ? ' dim' : '') + '"><span class="step-l">' + label + '<span>' + note + '</span></span>' +
        '<button class="icon-btn" data-ev="' + key + '" data-dir="-1" aria-label="' + label + ' moins">' + MINUS + '</button>' +
        '<span class="step-v">' + value + '</span>' +
        '<button class="icon-btn" data-ev="' + key + '" data-dir="1" aria-label="' + label + ' plus">' + PLUS + '</button></div>';
    }
    setHTML('ev-steps',
      step('cap', 'Prix max', 'Charger en dessous', v.cap == null ? '—' : '€' + v.cap.toFixed(2), false) +
      step('ready', 'Prête à', 'Fenêtre planifiée uniquement', v.ready || '—', !v.planned) +
      step('hours', 'Heures de charge', 'Fenêtre planifiée uniquement', v.hours == null ? '—' : v.hours + ' h', !v.planned));
    function sw(key, label, on) {
      return '<div class="sw-row"><span>' + label + '</span><button class="sw" role="switch" data-ev="' + key +
        '" aria-checked="' + on + '" aria-label="' + label + '"></button></div>';
    }
    setHTML('ev-sw', sw('smart', 'Charge intelligente', v.smart) + sw('solar', 'Charger avec le surplus solaire', v.solar) +
      sw('override', 'Ignorer le plafond de prix', v.override) +
      '<div class="sw-row"><span>Surplus solaire actuel</span><b>' + (v.surplus == null ? '—' : v.surplus.toFixed(1) + ' kW') + '</b></div>');
  }

  if (ev) {
    $('ev-start').onclick = function () { if (state) sendAll(serviceCall(state, 'button', 'press', ev.start, {}).send); };
    $('ev-stop').onclick = function () { if (state) sendAll(serviceCall(state, 'button', 'press', ev.stop, {}).send); };
    function evClick(e) {
      var b = e.target.closest('[data-ev]');
      if (!b || !state) return;
      var k = b.getAttribute('data-ev');
      var dir = +b.getAttribute('data-dir');
      var cur;
      if (k === 'mode') sendAll(serviceCall(state, 'input_select', 'select_option', ev.chargeMode, { option: b.getAttribute('data-v') }).send);
      else if (k === 'cap') {
        cur = num(store[ev.cap]);
        if (cur != null) sendAll(serviceCall(state, 'input_number', 'set_value', ev.cap, { value: Math.min(1, Math.max(0.05, Math.round((cur + dir * 0.01) * 100) / 100)) }).send);
      } else if (k === 'hours') {
        cur = num(store[ev.hours]);
        if (cur != null) sendAll(serviceCall(state, 'input_number', 'set_value', ev.hours, { value: Math.min(12, Math.max(1, cur + dir)) }).send);
      } else if (k === 'ready') {
        if (store[ev.readyBy]) sendAll(serviceCall(state, 'input_datetime', 'set_datetime', ev.readyBy, { time: stepTime(store[ev.readyBy].s.slice(0, 5), dir) + ':00' }).send);
      } else if (k === 'smart' || k === 'solar' || k === 'override') {
        sendAll(serviceCall(state, 'input_boolean', 'toggle', ev[k], {}).send);
      }
    }
    $('ev-plan').onclick = evClick;
    $('ev-sw').onclick = evClick;
  }

  if (!ev) $('nav-ev').style.display = 'none';

  return {
    onConnecting: function (s) { state = s; },
    onView: function () { renderEV(); },
    onUpdate: function (u) { if (u.kind === 'entities') renderEV(); },
  };
}
