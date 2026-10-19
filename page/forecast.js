'use strict';
// Forecast tab, and the weather chip on Home that opens it.

function parseForecast(result, eid, n) {
  var f = result && result.response && result.response[eid] && result.response[eid].forecast;
  if (!f) return [];
  return f.slice(0, n || 5).map(function (x) {
    return {
      date: new Date(x.datetime),
      condition: x.condition,
      temp: x.temperature,
      low: x.templow,
      rain: x.precipitation_probability,
      mm: x.precipitation,
      wind: x.wind_speed,
      bearing: x.wind_bearing,
    };
  });
}

var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass(deg) { return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }

// Weather entity attributes -> the six detail tiles on the Forecast tab (wind in km/h as HA reports it).
function weatherDetails(w, today) {
  var a = (w && w.a) || {};
  function n(v, d) { return v == null ? '—' : String(Math.round(v * (d || 1)) / (d || 1)); }
  var wind = a.wind_speed;
  var gust = a.wind_gust_speed;
  var feels = a.apparent_temperature;
  var hum = a.humidity;
  var rain = today && today.rain != null ? today.rain : null;
  return [
    { label: 'Feels like', value: feels == null ? '—' : Math.round(feels) + '°', unit: '', note: feels == null || a.temperature == null ? '' :
      Math.round(feels) === Math.round(a.temperature) ? 'Same as the air' : (feels < a.temperature ? 'Colder than the air' : 'Warmer than the air'), tone: 'peach' },
    { label: 'Wind', value: n(wind), unit: 'km/h', note: a.wind_bearing != null ? 'From ' + compass(a.wind_bearing) : '', tone: 'mint' },
    { label: 'Gusts', value: n(gust), unit: 'km/h', note: '', tone: 'mint' },
    { label: 'Humidity', value: n(hum), unit: '%', note: hum == null ? '' : hum >= 85 ? 'Damp' : hum <= 40 ? 'Dry' : 'Comfortable', tone: 'sky' },
    { label: 'Rain today', value: rain == null ? '—' : String(rain), unit: '%',
      note: today && today.mm != null ? today.mm + ' mm expected' : '', tone: 'sky' },
    { label: 'Pressure', value: n(a.pressure), unit: 'hPa', note: '', tone: 'lav' },
  ];
}


function forecastTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var store = ctx.store;
  var setText = ctx.setText;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var state = null;
  var forecast = [];

  // Forecast rows by calendar day: today's row, and the days after it.
  function todayRow() {
    var now = new Date();
    for (var i = 0; i < forecast.length; i++) if (dayDiff(forecast[i].date, now) === 0) return forecast[i];
    return forecast[0];
  }
  function nextRows() {
    var now = new Date();
    return forecast.filter(function (d) { return dayDiff(d.date, now) >= 1; }).slice(0, 5);
  }

  function renderWeather() {
    var w = store[cfg.weather];
    if (!w) return;
    var today = todayRow();
    var t = w.a.temperature != null ? Math.round(w.a.temperature) + '°' : '';
    setHTML('wchip-icon', weatherIcon(w.s, 22));
    setText('wchip-text', t + (today ? ' · ' + Math.round(today.temp) + '°/' + Math.round(today.low) + '°' : ''));
    renderForecastView();
  }

  var WIND_ARROW = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="-webkit-transform:rotate(DEGdeg);transform:rotate(DEGdeg)"><path d="M12 4v16M6 14l6 6 6-6"></path></svg>';

  function renderForecastView() {
    if (ctx.view() !== 'forecast') return;
    var w = store[cfg.weather];
    if (!w) return;
    var today = todayRow();
    var next = nextRows();
    setHTML('fc-blob', weatherIcon(w.s, 96));
    setText('fc-temp', w.a.temperature != null ? Math.round(w.a.temperature) + '°' : '');
    setText('fc-cond', conditionLabel(w.s));
    setText('fc-src', 'Updated ' + formatClock(new Date()));
    setText('fc-today', today ? 'Today ' + Math.round(today.temp) + '° / ' + Math.round(today.low) + '°' +
      (today.rain != null ? ' · rain ' + today.rain + '%' : '') : '');
    setHTML('fc-details', weatherDetails(w, today).map(function (d) {
      return '<div class="det ' + d.tone + '"><span class="det-l">' + d.label + '</span><span class="det-v"><span class="det-n">' +
        d.value + '</span><span class="det-u">' + d.unit + '</span></span><span class="det-note">' + esc(d.note) + '</span></div>';
    }).join(''));
    var lo = 99;
    var hi = -99;
    next.forEach(function (d) {
      if (d.low != null && d.low < lo) lo = d.low;
      if (d.temp > hi) hi = d.temp;
    });
    var span = Math.max(1, hi - lo);
    var now = new Date();
    setHTML('fc-list', next.map(function (d, i) {
      var l = d.low != null ? d.low : d.temp;
      var left = Math.round((l - lo) / span * 100);
      var width = Math.max(6, Math.round((d.temp - l) / span * 100));
      var wet = d.rain >= 60;
      return '<div class="day"><div class="day-head"><span class="day-name">' +
        (dayDiff(d.date, now) === 1 ? 'Tomorrow' : DAYS[d.date.getDay()].slice(0, 3)) + '</span><span class="sub">' + d.date.getDate() + ' ' +
        MONTHS[d.date.getMonth()].slice(0, 3) + '</span></div><div class="day-mid">' + weatherIcon(d.condition, 52) +
        '<span class="day-cond">' + conditionLabel(d.condition) + '</span></div><div class="day-temps"><span class="day-hi">' +
        Math.round(d.temp) + '°</span><span class="day-lo">' + (d.low != null ? Math.round(d.low) + '°' : '') +
        '</span></div><div class="day-bar"><i style="left:' + left + '%;width:' + Math.min(width, 100 - left) + '%"></i></div>' +
        '<div class="day-foot"><span class="rainchip' + (wet ? ' wet' : '') + '">' + (d.rain != null ? d.rain + '%' : '—') +
        (d.mm != null ? ' · ' + d.mm + ' mm' : '') + '</span>' +
        (d.bearing != null ? '<span class="wind">' + WIND_ARROW.replace(/DEG/g, Math.round(d.bearing)) + compass(d.bearing) + '</span>' : '') +
        '</div></div>';
    }).join(''));
  }

  $('wchip').onclick = function () { ctx.showView('forecast'); };
  setInterval(function () { if (state && state.subId) ctx.sendAll(refresh(state, cfg, 'forecast').send); }, 30 * 60000);

  return {
    onConnecting: function (s) { state = s; },
    onView: function () { renderForecastView(); },
    onUpdate: function (u, changed) {
      if (u.kind === 'entities' && changed.has(cfg.weather)) renderWeather();
      else if (u.kind === 'forecast') { forecast = u.days; renderWeather(); }
    },
  };
}
