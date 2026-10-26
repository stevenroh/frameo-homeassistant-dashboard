'use strict';
// Home tab: today's agenda and the bin chips. The clock is in app.js, the weather chip in forecast.js, the to-do
// card in todo.js and the music card in music.js.

// --- bins and agenda ---

function wasteType(summary) { return summary.replace(/^Mijnafvalwijzer:\s*/i, ''); }

// Dutch bin colours: GFT green, plastic/PMD orange, paper blue.
function binColor(type) {
  var t = type.toLowerCase();
  if (t.indexOf('gft') >= 0) return '#5DAA68';
  if (t.indexOf('plastic') >= 0 || t.indexOf('pmd') >= 0 || t.indexOf('pbd') >= 0) return '#E8873A';
  if (t.indexOf('papier') >= 0 || t.indexOf('paper') >= 0) return '#4F8FD9';
  return '#8E949A';
}

// Background for a day's bins: one colour, or equal hard stripes when the bins differ (GFT and paper on one day).
function binFill(types) {
  var colors = [];
  types.forEach(function (t) { var c = binColor(t); if (colors.indexOf(c) < 0) colors.push(c); });
  if (colors.length === 1) return colors[0];
  return 'linear-gradient(90deg, ' + colors.map(function (c, i) {
    return c + ' ' + Math.round(i * 100 / colors.length) + '% ' + Math.round((i + 1) * 100 / colors.length) + '%';
  }).join(', ') + ')';
}

// Upcoming events grouped per day; events that already ended are dropped.
function groupByDay(events, now) {
  var days = [];
  var byKey = {};
  events.forEach(function (e) {
    if (e.end <= now) return;
    var d = e.start < now ? startOfDay(now) : startOfDay(e.start);
    var key = d.getTime();
    if (!byKey[key]) {
      byKey[key] = { date: d, label: dayLabel(d, now), events: [] };
      days.push(byKey[key]);
    }
    byKey[key].events.push(e);
  });
  days.sort(function (a, b) { return a.date - b.date; });
  return days;
}

// What is left of today: events that overlap it and have not ended.
function todayEvents(events, now) {
  return eventsOnDay(events, now).filter(function (e) { return e.end > now; });
}


function homeTab(ctx) {
  var cfg = ctx.cfg;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var isWaste = ctx.isWaste;
  var timeOf = ctx.timeOf;
  var state = null;
  var events = [];

  function renderHomeCalendars() {
    var now = new Date();
    var bins = groupByDay(events.filter(isWaste), now).slice(0, 3);
    setHTML('bins', bins.map(function (d) {
      var types = d.events.map(function (e) { return wasteType(e.summary); });
      var label = esc(types.join(', ')) + ' ' + esc(d.label.toLowerCase());
      // collection day: the whole chip in the bins' colours, else a dot of them
      if (d.label === 'Aujourd’hui') return '<span class="bchip now" style="background:' + binFill(types) + '">' + label + '</span>';
      return '<span class="bchip"><span class="dot" style="background:' + binFill(types) + '"></span>' + label + '</span>';
    }).join(''));
    var today = todayEvents(events.filter(function (e) { return !isWaste(e); }), now);
    setHTML('agenda', today.map(function (e) {
      return '<div class="a-ev"><span class="a-bar"></span><span class="a-body"><span class="a-t">' + timeOf(e) +
        '</span><span class="a-title">' + esc(e.summary) + '</span></span></div>';
    }).join('') || '<div class="muted">Rien d’autre aujourd’hui</div>');
  }

  // Every 5 min: refresh the agenda.
  setInterval(function () { if (state && state.subId) ctx.sendAll(refresh(state, cfg, 'calendar').send); }, 5 * 60000);

  return {
    onConnecting: function (s) { state = s; },
    onUpdate: function (u) {
      if (u.kind === 'calendar') { events = u.events; renderHomeCalendars(); }
    },
    onTick: function (newDay) { if (newDay) renderHomeCalendars(); },
  };
}
