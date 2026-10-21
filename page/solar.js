'use strict';
// Solar tab: production, house, battery and grid cards from the inverter's sensors (cfg.solar). A card shows only
// when its sensors are configured.

var SOLAR_KEYS = ['pv', 'pvToday', 'forecastToday', 'forecastRemaining', 'forecastTomorrow', 'forecastDay2', 'peakToday', 'load', 'grid', 'battery', 'soc', 'chargeToday', 'dischargeToday', 'importToday', 'exportToday'];

function solarIds(solar) {
  if (!solar) return [];
  return SOLAR_KEYS.filter(function (k) { return solar[k]; }).map(function (k) { return solar[k]; });
}

// Entity store + cfg.solar -> what the tab shows. Power in W (kW sensors converted), energy in kWh (Wh converted).
// Battery: + charging, - discharging; grid: + buying, - selling. invertBattery / invertGrid flip an inverter that
// reports the other way round.
function solarView(store, s) {
  function num(id) {
    var e = id && store[id];
    var v = e && parseFloat(e.s);
    return e && isFinite(v) ? { v: v, u: (e.a && e.a.unit_of_measurement) || '' } : null;
  }
  function power(id) { var x = num(id); return x ? (x.u === 'kW' ? x.v * 1000 : x.v) : null; }
  function energy(id) { var x = num(id); return x ? (x.u === 'Wh' ? x.v / 1000 : x.v) : null; }
  // A forecast that only gives what is still to come (Solcast-style "remaining") adds today's production to it.
  var forecastToday = energy(s.forecastToday);
  var remaining = energy(s.forecastRemaining);
  var pvToday = energy(s.pvToday);
  if (forecastToday == null && remaining != null) forecastToday = remaining + (pvToday || 0);
  var bat = power(s.battery);
  var grid = power(s.grid);
  if (bat != null && s.invertBattery) bat = -bat;
  if (grid != null && s.invertGrid) grid = -grid;
  var soc = num(s.soc);
  return {
    pv: power(s.pv), pvToday: energy(s.pvToday), load: power(s.load),
    forecastToday: forecastToday, forecastTomorrow: energy(s.forecastTomorrow), forecastDay2: energy(s.forecastDay2),
    peak: peakTime(store[s.peakToday]),
    soc: soc ? Math.round(soc.v) : null, battery: bat, grid: grid,
    chargeToday: energy(s.chargeToday), dischargeToday: energy(s.dischargeToday),
    importToday: energy(s.importToday), exportToday: energy(s.exportToday),
    batteryText: bat == null ? '' : bat > 30 ? 'En charge' : bat < -30 ? 'En décharge' : 'Au repos',
    gridText: grid == null ? '' : grid > 30 ? 'Achète au réseau' : grid < -30 ? 'Revend au réseau' : 'Équilibre',
    cards: { pv: !!(s.pv || s.pvToday || s.forecastToday || s.forecastRemaining || s.forecastTomorrow), home: !!s.load, battery: !!(s.soc || s.battery || s.chargeToday || s.dischargeToday),
      grid: !!(s.grid || s.importToday || s.exportToday) },
  };
}

// A timestamp sensor (Forecast.Solar's peak time) -> "13:15", or '' when unknown.
function peakTime(e) {
  var d = e && e.s && new Date(e.s);
  return d && !isNaN(d) ? formatTime(d) : '';
}

// 850 -> ['850', 'W'], 2340 -> ['2.3', 'kW']; the sign is told in words, so the number is unsigned.
function fmtPower(w) {
  if (w == null) return ['—', ''];
  var a = Math.abs(w);
  return a < 1000 ? [String(Math.round(a)), 'W'] : [(a / 1000).toFixed(1), 'kW'];
}

function fmtKwh(k) { return k == null ? '—' : k.toFixed(1); }


function solarTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var setHTML = ctx.setHTML;
  var solar = cfg.solar || null;
  var ids = solarIds(solar);

  function big(w, color) {
    var p = fmtPower(w);
    return '<div class="so-big"><span class="so-n"' + (color ? ' style="color:' + color + '"' : '') + '>' + p[0] +
      '</span><span class="so-u">' + p[1] + '</span></div>';
  }
  function tile(tone, label, kwh) {
    return '<div class="det ' + tone + '"><span class="det-l">' + label + '</span><span class="det-v"><span class="det-n">' +
      fmtKwh(kwh) + '</span><span class="det-u">kWh</span></span></div>';
  }

  function renderSolar() {
    if (ctx.view() !== 'solar' || !solar) return;
    var v = solarView(ctx.store, solar);
    $('so-pv').style.display = v.cards.pv ? '' : 'none';
    $('so-home').style.display = v.cards.home ? '' : 'none';
    $('so-bat').style.display = v.cards.battery ? '' : 'none';
    $('so-grid').style.display = v.cards.grid ? '' : 'none';
    // An odd number of cards: the last one takes the whole bottom row instead of leaving a hole.
    var shown = ['so-pv', 'so-home', 'so-bat', 'so-grid'].filter(function (id) { return $(id).style.display !== 'none'; });
    shown.forEach(function (id, i) { $(id).style.gridColumn = shown.length % 2 && i === shown.length - 1 ? '1 / -1' : ''; });
    if (v.cards.pv) {
      // With a forecast: a bar of today's production against it, the peak time and tomorrow's forecast.
      var fc = v.forecastToday;
      var pct = fc && v.pvToday != null ? Math.min(100, Math.round(v.pvToday / fc * 100)) : null;
      setHTML('so-pv-body', '<div class="so-row">' + (solar.pv ? big(v.pv, 'var(--primary)') : '<span></span>') +
        (v.peak ? '<span class="so-state">Pic à ' + v.peak + '</span>' : '') + '</div>' +
        (pct != null ? '<div class="so-bar sun"><i style="width:' + pct + '%"></i></div>' : '') +
        (solar.pvToday || fc != null ? '<div class="so-sub">' + (solar.pvToday ? fmtKwh(v.pvToday) + ' kWh produits' : '') +
          (fc != null ? (solar.pvToday ? ' sur ' : 'Prévu : ') + fmtKwh(fc) + ' kWh prévus aujourd’hui' : ' aujourd’hui') + '</div>' : '') +
        (solar.forecastTomorrow || solar.forecastDay2 ? '<div class="so-tiles">' +
          (solar.forecastTomorrow ? tile('peach', 'Prévu demain', v.forecastTomorrow) : '') +
          (solar.forecastDay2 ? tile('peach', 'Prévu après-demain', v.forecastDay2) : '') + '</div>' : ''));
    }
    if (v.cards.home) setHTML('so-home-body', big(v.load) + '<div class="so-sub">consommés maintenant</div>');
    if (v.cards.battery) {
      setHTML('so-bat-body', '<div class="so-row"><div class="so-big"><span class="so-n" style="color:var(--mint-ink)">' +
        (v.soc == null ? '—' : v.soc) + '</span><span class="so-u">%</span></div>' +
        (v.battery == null ? '' : '<span class="so-state' + (v.batteryText === 'Au repos' ? '' : ' on') + '">' + v.batteryText +
          (v.batteryText === 'Au repos' ? '' : ' · ' + fmtPower(v.battery).join(' ')) + '</span>') + '</div>' +
        (v.soc == null ? '' : '<div class="so-bar"><i style="width:' + Math.max(0, Math.min(100, v.soc)) + '%"></i></div>') +
        (solar.chargeToday || solar.dischargeToday ? '<div class="so-tiles">' +
          (solar.chargeToday ? tile('mint', 'Chargé aujourd’hui', v.chargeToday) : '') +
          (solar.dischargeToday ? tile('peach', 'Déchargé aujourd’hui', v.dischargeToday) : '') + '</div>' : ''));
    }
    if (v.cards.grid) {
      setHTML('so-grid-body', (v.grid == null ? '' : big(v.grid) + '<div class="so-sub">' + v.gridText + '</div>') +
        '<div class="so-tiles">' + (solar.importToday ? tile('sky', 'Acheté aujourd’hui', v.importToday) : '') +
        (solar.exportToday ? tile('mint', 'Revendu aujourd’hui', v.exportToday) : '') + '</div>');
    }
  }

  if (!solar) $('nav-solar').style.display = 'none';

  return {
    onView: function (v) { if (v === 'solar') renderSolar(); },
    onUpdate: function (u, changed) {
      if (u.kind === 'entities' && ids.some(function (id) { return changed.has(id); })) renderSolar();
    },
  };
}
