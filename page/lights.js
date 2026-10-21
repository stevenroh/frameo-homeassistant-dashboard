'use strict';
// Lights tab: tiles per room; hold one for its brightness and colour sheet.

function lightView(e, name) {
  var a = (e && e.a) || {};
  var unavailable = !e || e.s === 'unavailable' || e.s === 'unknown';
  var modes = a.supported_color_modes || [];
  var dimmable = modes.length > 0 && !(modes.length === 1 && modes[0] === 'onoff');
  var on = !unavailable && e.s === 'on';
  var pct = on && a.brightness ? Math.round(a.brightness / 255 * 100) : 0;
  return {
    name: name, on: on, pct: pct, dimmable: dimmable, unavailable: unavailable,
    label: unavailable ? 'Indisponible' : on ? (dimmable && pct ? pct + '%' : 'Allumé') : 'Éteint',
  };
}

// Colour temperature range for the hold sheet; HA's defaults when the light does not say.
function colorTempView(e) {
  var a = (e && e.a) || {};
  var supported = (a.supported_color_modes || []).indexOf('color_temp') >= 0;
  if (!supported) return { supported: false };
  var min = a.min_color_temp_kelvin || 2000;
  var max = a.max_color_temp_kelvin || 6535;
  return { supported: true, min: min, max: max, kelvin: a.color_temp_kelvin || Math.round((min + max) / 2) };
}

// Colour swatches for the hold sheet, sent as rgb_color. HA reports rgb_color at full brightness,
// so the nearest swatch is a fair guess at the current colour.
var SWATCHES = [
  { name: 'Rouge', rgb: [255, 0, 0] }, { name: 'Orange', rgb: [255, 128, 0] }, { name: 'Jaune', rgb: [255, 220, 0] },
  { name: 'Vert', rgb: [0, 255, 0] }, { name: 'Cyan', rgb: [0, 255, 255] }, { name: 'Bleu', rgb: [0, 0, 255] },
  { name: 'Violet', rgb: [140, 0, 255] }, { name: 'Rose', rgb: [255, 0, 160] },
];
var COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];

function colorView(e) {
  var a = (e && e.a) || {};
  var supported = (a.supported_color_modes || []).some(function (m) { return COLOR_MODES.indexOf(m) >= 0; });
  if (!supported) return { supported: false, current: -1 };
  var c = e.s === 'on' && COLOR_MODES.indexOf(a.color_mode) >= 0 && a.rgb_color;
  if (!c) return { supported: true, current: -1 };
  var best = -1, bestD = Infinity;
  SWATCHES.forEach(function (s, i) {
    var d = Math.pow(s.rgb[0] - c[0], 2) + Math.pow(s.rgb[1] - c[1], 2) + Math.pow(s.rgb[2] - c[2], 2);
    if (d < bestD) { bestD = d; best = i; }
  });
  return { supported: true, current: best };
}

// On/off goes to the entity's own domain, so a switch (a smart plug) can sit in the list next to lights.
function domainOf(id) { return id.split('.')[0]; }

function lightsTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var store = ctx.store;
  var setText = ctx.setText;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var sendAll = ctx.sendAll;
  var state = null;
  if (!cfg.lights.length) $('nav-lights').style.display = 'none';
  var lights = cfg.lights || [];
  var lightIds = lights.map(function (l) { return l.id; });

  var sliding = false; // a finger is on a slider: don't re-render under it
  var sheetId = null;
  var press = null;
  var pressFired = false;

  function lightName(id) {
    for (var i = 0; i < lights.length; i++) if (lights[i].id === id) return lights[i].name;
    return id;
  }

  function renderLights() {
    if (ctx.view() !== 'lights') return;
    var anyOn = false;
    var rooms = [];
    var byRoom = {};
    lights.forEach(function (l) {
      var r = l.room || l.name;
      if (!byRoom[r]) { byRoom[r] = { name: r, items: [] }; rooms.push(byRoom[r]); }
      byRoom[r].items.push(l);
    });
    setHTML('lights-grid', rooms.map(function (r) {
      var onCount = 0;
      var rows = r.items.map(function (l) {
        var v = lightView(store[l.id], l.name);
        if (v.on) { anyOn = true; onCount++; }
        return '<button class="lt' + (v.on ? ' on' : '') + (v.unavailable ? ' unavail' : '') + '" data-id="' + l.id + '">' +
          '<span class="lt-fill" style="width:' + (v.on ? (v.dimmable && v.pct ? v.pct : 100) : 0) + '%"></span>' +
          '<span class="lt-ic">' + BULB_S + '</span><span class="lt-name">' + esc(v.name) + '</span><span class="lt-label">' + v.label + '</span></button>';
      }).join('');
      return '<section class="room"><div class="room-head"><span class="room-ic">' + roomIconSvg(r.name, null, 22) + '</span><span class="room-name">' +
        esc(r.name) + '</span><span class="room-count">' +
        (r.items.length > 1 ? onCount + ' sur ' + r.items.length + ' allumées' : (onCount ? 'Allumé' : 'Éteint')) + '</span></div>' + rows + '</section>';
    }).join(''));
    $('all-off').disabled = !anyOn;
    var onCount = lights.filter(function (l) { return lightView(store[l.id], l.name).on; }).length;
    setText('lights-sub', onCount + (onCount > 1 ? ' allumées' : ' allumée'));
  }

  function setRange(el, value, min, max) {
    el.min = min;
    el.max = max;
    el.value = value;
    el.style.setProperty('--v', ((value - min) / (max - min) * 100) + '%');
  }

  // The sheet is plain elements updated in place (no innerHTML), so HA updates never break a drag.
  function renderSheet() {
    if (!sheetId || sliding) return;
    var v = lightView(store[sheetId], lightName(sheetId));
    var ct = colorTempView(store[sheetId]);
    var col = colorView(store[sheetId]);
    setText('sheet-name', v.name);
    $('sheet-switch').setAttribute('aria-checked', v.on ? 'true' : 'false');
    $('sheet-switch').disabled = v.unavailable;
    $('sheet-bri').disabled = !v.dimmable || v.unavailable;
    setRange($('sheet-bri'), v.on ? (v.pct || 100) : 0, 0, 100);
    setText('sheet-bri-v', v.on ? (v.pct || 100) + '%' : 'Éteint');
    $('sheet-ct-row').style.display = ct.supported ? '' : 'none';
    if (ct.supported) {
      setRange($('sheet-ct'), ct.kelvin, ct.min, ct.max);
      setText('sheet-ct-v', ct.kelvin + ' K');
    }
    $('sheet-rgb-row').style.display = col.supported ? '' : 'none';
    renderSwatches(col.current);
  }

  // Buttons, not sliders, so rewriting them on an update cannot break a drag; setHTML skips unchanged HTML.
  function renderSwatches(current) {
    setHTML('sheet-rgb', SWATCHES.map(function (s, i) {
      return '<button class="swatch' + (i === current ? ' on' : '') + '" data-i="' + i + '" aria-label="' + s.name +
        '" style="background:rgb(' + s.rgb.join(',') + ')"></button>';
    }).join(''));
  }

  $('sheet-rgb').onclick = function (ev) {
    var b = ev.target.closest('.swatch');
    if (!b || !sheetId || !state) return;
    var i = +b.getAttribute('data-i');
    renderSwatches(i);
    $('sheet-switch').setAttribute('aria-checked', 'true');
    sendAll(serviceCall(state, 'light', 'turn_on', sheetId, { rgb_color: SWATCHES[i].rgb }).send);
  };

  function openSheet(id) {
    sheetId = id;
    $('scrim').style.display = '';
    $('sheet').style.display = '';
    renderSheet();
  }

  function closeSheet() {
    sheetId = null;
    $('scrim').style.display = 'none';
    $('sheet').style.display = 'none';
  }

  // Hold a tile for half a second to open its sheet.
  var grid = $('lights-grid');
  grid.addEventListener('touchstart', function (ev) {
    pressFired = false;
    var tile = ev.target.closest('.lt');
    if (!tile || tile.className.indexOf('unavail') >= 0) return;
    var t = ev.touches[0];
    var id = tile.getAttribute('data-id');
    press = { x: t.clientX, y: t.clientY, timer: setTimeout(function () {
      press = null;
      pressFired = true;
      openSheet(id);
    }, 500) };
  }, { passive: true });
  grid.addEventListener('touchmove', function (ev) {
    if (!press) return;
    var t = ev.touches[0];
    if (Math.abs(t.clientX - press.x) > 10 || Math.abs(t.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
  }, { passive: true });
  function endPress(ev) {
    if (press) { clearTimeout(press.timer); press = null; }
    // The finger lifts over the new sheet; cancel the click so it neither toggles the light nor hits the scrim.
    if (pressFired) { pressFired = false; ev.preventDefault(); }
  }
  grid.addEventListener('touchend', endPress, { passive: false });
  grid.addEventListener('touchcancel', endPress, { passive: false });

  $('sheet-done').onclick = closeSheet;
  $('sheet-switch').onclick = function () {
    if (!sheetId || !state) return;
    var on = $('sheet-switch').getAttribute('aria-checked') === 'true';
    $('sheet-switch').setAttribute('aria-checked', on ? 'false' : 'true');
    sendAll(serviceCall(state, domainOf(sheetId), on ? 'turn_off' : 'turn_on', sheetId, {}).send);
  };
  $('sheet-bri').addEventListener('input', function () {
    var el = $('sheet-bri');
    el.style.setProperty('--v', el.value + '%');
    setText('sheet-bri-v', Math.max(1, +el.value) + '%');
  });
  $('sheet-bri').addEventListener('change', function () {
    if (!sheetId || !state) return;
    sendAll(serviceCall(state, 'light', 'turn_on', sheetId, { brightness_pct: Math.max(1, +$('sheet-bri').value) }).send);
  });
  $('sheet-ct').addEventListener('input', function () { setText('sheet-ct-v', $('sheet-ct').value + ' K'); });
  $('sheet-ct').addEventListener('change', function () {
    if (!sheetId || !state) return;
    sendAll(serviceCall(state, 'light', 'turn_on', sheetId, { color_temp_kelvin: +$('sheet-ct').value }).send);
  });
  document.addEventListener('touchstart', function (ev) { if (ev.target.tagName === 'INPUT') sliding = true; }, { passive: true });
  document.addEventListener('touchend', function () {
    if (sliding) { sliding = false; setTimeout(renderSheet, 800); }
  });

  grid.onclick = function (ev) {
    if (!state) return;
    var tile = ev.target.closest('.lt');
    if (!tile || tile.className.indexOf('unavail') >= 0) return;
    var id = tile.getAttribute('data-id');
    // Show the flip right away; the subscription confirms it a moment later.
    tile.className = tile.className.indexOf(' on') >= 0 ? tile.className.replace(' on', '') : tile.className + ' on';
    sendAll(serviceCall(state, domainOf(id), 'toggle', id, {}).send);
  };
  $('all-off').onclick = function () {
    if (!state) return;
    lights.forEach(function (l) {
      if (store[l.id] && store[l.id].s === 'on') sendAll(serviceCall(state, domainOf(l.id), 'turn_off', l.id, {}).send);
    });
  };

  return {
    onConnecting: function (s) { state = s; },
    onView: function () { renderLights(); },
    onUpdate: function (u, changed) {
      if (u.kind === 'action-failed' || u.kind === 'entities' && lightIds.some(function (id) { return changed.has(id); })) {
        renderLights();
        renderSheet();
      }
    },
    closeSheet: closeSheet,
  };
}
