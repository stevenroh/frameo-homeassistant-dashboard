'use strict';
// Calendar tab: a month or a week, fetched per date range.

function parseEvents(result) {
  var out = [];
  var resp = (result && result.response) || {};
  Object.keys(resp).forEach(function (eid) {
    (resp[eid].events || []).forEach(function (e) {
      out.push({
        start: parseDate(e.start),
        end: parseDate(e.end),
        allDay: e.start.length === 10,
        summary: cleanTitle(e.summary || ''),
        source: eid,
      });
    });
  });
  out.sort(function (a, b) {
    return (a.start - b.start) || ((b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));
  });
  return out;
}

// Events that overlap the given day (multi-day all-day events show on every day they cover).
function eventsOnDay(events, day) {
  var from = startOfDay(day);
  var to = addDays(from, 1);
  return events.filter(function (e) { return e.start < to && e.end > from; });
}

// Month cells have room for two titles: single-day events first, multi-day ones (a trip,
// a visit) after them, since those repeat on every day they cover.
function chipOrder(list) {
  function multi(e) { return e.end - e.start > 86400000 + 3600000; }
  return list.filter(function (e) { return !multi(e); }).concat(list.filter(multi));
}

// Month grid in whole Monday-first weeks: 28, 35 or 42 dates.
function monthGrid(year, month) {
  var first = new Date(year, month, 1);
  var lead = (first.getDay() + 6) % 7;
  var days = new Date(year, month + 1, 0).getDate();
  var count = Math.ceil((lead + days) / 7) * 7;
  var out = [];
  for (var i = 0; i < count; i++) out.push(new Date(year, month, 1 - lead + i));
  return out;
}

function weekDays(d) {
  var monday = addDays(startOfDay(d), -((d.getDay() + 6) % 7));
  var out = [];
  for (var i = 0; i < 7; i++) out.push(addDays(monday, i));
  return out;
}

// Events for a calendar view's date range; `key` comes back with the result.
function fetchRange(state, cfg, key, start, end) {
  var id = state.nextId++;
  state.pending[id] = { kind: 'range', key: key };
  return {
    state: state,
    send: [calendarCall(id, cfg, { start_date_time: localIso(start), end_date_time: localIso(end) })],
  };
}


function calendarTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var setText = ctx.setText;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var isWaste = ctx.isWaste;
  var timeOf = ctx.timeOf;
  var sendAll = ctx.sendAll;
  var state = null;
  var ranges = {};
  var calMode = 'month';
  var anchor = new Date();
  var selected = startOfDay(new Date());

  function calDates() {
    return calMode === 'month' ? monthGrid(anchor.getFullYear(), anchor.getMonth()) : weekDays(anchor);
  }
  function rangeKey() {
    var d = calDates()[0];
    return calMode + ':' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function requestRange() {
    var key = rangeKey();
    if (key in ranges || !state || !state.subId) return;
    var dates = calDates();
    ranges[key] = null; // requested; a result replaces it, the 5-min refresh clears it
    sendAll(fetchRange(state, cfg, key, dates[0], addDays(dates[dates.length - 1], 1)).send);
  }

  function binChip(dayEvents) {
    var w = dayEvents.filter(isWaste).map(function (e) { return wasteType(e.summary); }).join(', ');
    return w ? { type: w, color: binColor(w) } : null;
  }

  function renderMonth(list) {
    var now = new Date();
    var month = anchor.getMonth();
    setText('cal-title', MONTHS[month] + ' ' + anchor.getFullYear());
    var dates = calDates();
    $('cal-grid').className = 'month rows' + dates.length / 7;
    setHTML('cal-grid', dates.map(function (d) {
      var evs = eventsOnDay(list, d);
      var shownEvs = chipOrder(evs.filter(function (e) { return !isWaste(e); }));
      var bin = binChip(evs);
      var cls = 'cell' + (d.getMonth() !== month ? ' out' : '') + (dayDiff(d, selected) === 0 ? ' sel' : '') +
        (dayDiff(d, now) === 0 ? ' tod' : '');
      return '<button class="' + cls + '" data-day="' + d.getTime() + '"><span class="cell-top">' +
        '<span class="num' + (dayDiff(d, now) === 0 ? ' today' : '') + '">' + d.getDate() + '</span>' +
        (bin ? '<span class="dot" style="background:' + bin.color + '"></span>' : '') + '</span>' +
        shownEvs.slice(0, 2).map(function (e, i) { return '<span class="evc c' + ((e.summary.length + i) % 4 + 1) + '">' + esc(e.summary) + '</span>'; }).join('') +
        (shownEvs.length > 2 ? '<span class="more">+' + (shownEvs.length - 2) + ' more</span>' : '') +
        '</button>';
    }).join(''));
    renderSide(list);
  }

  function renderSide(list) {
    var now = new Date();
    var diff = dayDiff(selected, now);
    var label = diff === 0 ? 'TODAY' : diff === 1 ? 'TOMORROW' : DAYS[selected.getDay()].toUpperCase();
    setText('side-label', label);
    $('side-label').className = 'side-label' + (diff === 0 ? ' today' : '');
    setText('side-date', (diff === 0 || diff === 1 ? DAYS[selected.getDay()] + ' ' : '') +
      selected.getDate() + ' ' + MONTHS[selected.getMonth()]);
    var evs = eventsOnDay(list, selected);
    var bin = binChip(evs);
    setHTML('side-bin', bin ? '<span class="chip"><span class="dot" style="background:' + bin.color +
      '"></span>' + esc(bin.type) + ' bin goes out</span>' : '');
    var rest = evs.filter(function (e) { return !isWaste(e); });
    setHTML('side-events', rest.map(function (e) {
      return '<div class="s-ev"><span class="s-bar"></span><span><div class="s-t">' + timeOf(e) + '</div><div class="s-title">' +
        esc(e.summary) + '</div></span></div>';
    }).join('') || '<div class="muted">Nothing planned</div>');
  }

  function renderWeek(list) {
    var now = new Date();
    var dates = calDates();
    var a = dates[0];
    var b = dates[6];
    setText('cal-title', a.getMonth() === b.getMonth()
      ? a.getDate() + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()]
      : a.getDate() + ' ' + MONTHS[a.getMonth()].slice(0, 3) + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()].slice(0, 3));
    $('cal-grid').className = 'week';
    setHTML('cal-grid', dates.map(function (d) {
      var evs = eventsOnDay(list, d);
      var bin = binChip(evs);
      var today = dayDiff(d, now) === 0;
      return '<div class="col' + (today ? ' today' : '') + '"><div class="col-head"><div><div class="col-dow">' +
        DAYS[d.getDay()].slice(0, 3) + '</div><div class="col-num">' + d.getDate() + '</div></div>' +
        (bin ? '<span class="chip"><span class="dot" style="background:' + bin.color + '"></span>' + esc(bin.type) + '</span>' : '') +
        '</div><div class="col-evs">' + evs.filter(function (e) { return !isWaste(e); }).map(function (e) {
          return '<div class="card"><div class="card-t">' + timeOf(e) + '</div><div class="card-title">' +
            esc(e.summary) + '</div></div>';
        }).join('') + '</div></div>';
    }).join(''));
  }

  function renderCalendar() {
    if (ctx.view() !== 'calendar') return;
    $('mode-month').className = 'seg' + (calMode === 'month' ? ' on' : '');
    $('mode-week').className = 'seg' + (calMode === 'week' ? ' on' : '');
    $('cal-side').style.display = calMode === 'month' ? '' : 'none';
    $('dow').style.display = calMode === 'month' ? '' : 'none';
    var list = ranges[rangeKey()] || [];
    if (calMode === 'month') renderMonth(list); else renderWeek(list);
    requestRange();
  }

  function goToday() {
    anchor = new Date();
    selected = startOfDay(anchor);
    renderCalendar();
  }

  function step(dir) {
    anchor = calMode === 'month'
      ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
      : addDays(anchor, 7 * dir);
    renderCalendar();
  }

  function openCal() { goToday(); ctx.showView('calendar'); }
  $('nav-cal').onclick = openCal;
  $('open-cal').onclick = openCal;
  $('cal-prev').onclick = function () { step(-1); };
  $('cal-next').onclick = function () { step(1); };
  $('cal-today').onclick = goToday;
  $('mode-month').onclick = function () { calMode = 'month'; anchor = selected; renderCalendar(); };
  $('mode-week').onclick = function () { calMode = 'week'; anchor = selected; renderCalendar(); };
  $('cal-grid').onclick = function (e) {
    var cell = e.target.closest('.cell');
    if (!cell) return;
    selected = new Date(+cell.getAttribute('data-day'));
    if (selected.getMonth() !== anchor.getMonth()) anchor = new Date(selected.getFullYear(), selected.getMonth(), 1);
    renderCalendar();
  };

  // Every 5 min: forget cached ranges, refetch the one on screen.
  setInterval(function () {
    if (!state || !state.subId) return;
    ranges = {};
    if (ctx.view() === 'calendar') requestRange();
  }, 5 * 60000);

  return {
    onConnecting: function (s) { state = s; ranges = {}; },
    onConnected: function () { if (ctx.view() === 'calendar') requestRange(); },
    onView: function () { renderCalendar(); },
    onUpdate: function (u) {
      if (u.kind === 'range') {
        ranges[u.key] = u.events;
        if (u.key === rangeKey()) renderCalendar();
      }
    },
    onTick: function (newDay) { if (newDay) renderCalendar(); },
  };
}
