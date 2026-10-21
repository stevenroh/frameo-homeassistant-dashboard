'use strict';
// Frame dashboard: start() builds the tabs (one file each, see index.html) and wires them to the clock and the socket.
// Targets Android 6 WebView 107 on a 1 GHz Cortex-A7: no framework, no animations,
// and the DOM is only touched when a value actually changes.

// Every tab is a function of ctx, the shared helpers, returning the hooks it wants (all optional):
//   onConnecting(state)  a new socket; state is the protocol state handleMessage keeps for it
//   onConnected()        logged in; ask for what the tab on screen shows
//   onView(view)         a tab was shown
//   onUpdate(u, changed) a handleMessage update; changed is the entity ids it touched (entities only)
//   onTick(newDay)       every minute; newDay once the real time arrives and at midnight
//   closeSheet()         close the tab's sheet, if open
function start(cfg) {
  var $ = function (id) { return document.getElementById(id); };
  var shown = {};
  function setText(id, text) {
    if (shown[id] === text) return;
    shown[id] = text;
    $(id).textContent = text;
  }
  function setHTML(id, html) {
    if (shown[id] === html) return;
    shown[id] = html;
    $(id).innerHTML = html;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function isWaste(e) { return e.source === cfg.waste; }
  function timeOf(e) { return e.allDay ? 'Toute la journée' : formatTime(e.start); }

  var store = {};
  var lastOk = 0;
  var ws = null;
  var attempt = 0;
  var state = null;
  var keepAlive = newKeepAlive();
  var view = 'home';
  var lastTouch = Date.now();

  function renderClock() {
    var now = new Date();
    var ok = clockTrusted(now);
    setText('clock', ok ? formatClock(now) : '--:--');
    setText('date', ok ? formatDate(now) : 'En attente de l’heure réseau');
    if (!(state && state.fatal)) setText('stale', staleLabel(lastOk, Date.now()));
  }

  function applyTheme() {
    var cls = isNight(store['sun.sun'], new Date()) ? 'night' : 'day';
    if (document.documentElement.className !== cls) document.documentElement.className = cls;
  }

  // Photo background, moving on every 10 min: the configured list in order, or with "background": "frameo" a random
  // landscape from the Frameo app's photos (portraits would be cropped to a strip). A photo that fails to load
  // leaves the plain background colour; with no photos at all the drawn landscape comes back.
  var frameoBg = cfg.background === 'frameo';
  var photos = frameoBg ? [] : photoUrls(cfg);
  var photoAt = -1;
  function bgList() {
    if (!frameoBg) return photos;
    try { return window.Kiosk && window.Kiosk.photos ? JSON.parse(window.Kiosk.photos()) : []; } catch (x) { return []; }
  }
  function nextPhoto(tries) {
    var list = bgList();
    if (!list.length) { if (!$('bg').style.backgroundImage) $('bg').className = ''; return; } // no photos: the landscape
    photoAt = frameoBg ? Math.floor(Math.random() * list.length) : (photoAt + 1) % list.length;
    var url = list[photoAt];
    var img = new Image();
    img.onload = function () {
      if (frameoBg && img.naturalHeight > img.naturalWidth && (tries || 0) < 8) { nextPhoto((tries || 0) + 1); return; }
      $('bg').style.backgroundImage = 'url("' + url + '")';
      $('bg').className = 'photo';
    };
    img.src = url;
  }
  // Plain background colour until the first photo arrives, so the drawn landscape never flashes first.
  if (frameoBg || photos.length) { $('bg').className = 'photo'; nextPhoto(); }
  if (frameoBg || photos.length > 1) setInterval(nextPhoto, 10 * 60000);

  var toastTimer = null;
  function toast(text) {
    setText('toast', text);
    $('toast').style.display = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').style.display = 'none'; }, 4000);
  }

  var VIEWS = { home: 'view-home', forecast: 'view-forecast', calendar: 'view-cal', climate: 'view-climate', lights: 'view-lights',
    music: 'view-music', ev: 'view-ev', recipes: 'view-recipes', photos: 'view-photos', solar: 'view-solar' };
  var NAV = { home: 'nav-home', forecast: 'nav-forecast', calendar: 'nav-cal', climate: 'nav-climate', lights: 'nav-lights',
    music: 'nav-music', ev: 'nav-ev', recipes: 'nav-recipes', photos: 'nav-photos', solar: 'nav-solar' };

  function each(hook, a, b) {
    tabs.forEach(function (t) { if (t[hook]) t[hook](a, b); });
  }

  function showView(v) {
    each('closeSheet');
    view = v;
    Object.keys(VIEWS).forEach(function (k) {
      $(VIEWS[k]).style.display = k === v ? '' : 'none';
      $(NAV[k]).className = 'rail-btn' + (k === v ? ' on' : '');
    });
    each('onView', v);
  }

  Object.keys(NAV).forEach(function (k) { $(NAV[k]).onclick = function () { showView(k); }; });

  var ctx = {
    cfg: cfg, store: store, $: $, shown: shown, setText: setText, setHTML: setHTML, esc: esc, isWaste: isWaste,
    timeOf: timeOf, toast: toast, sendAll: sendAll, showView: showView, view: function () { return view; },
  };
  var tabs = [homeTab(ctx), todoCard(ctx), forecastTab(ctx), calendarTab(ctx), climateTab(ctx), lightsTab(ctx),
    musicTab(ctx), evTab(ctx), recipesTab(ctx), photosTab(ctx), solarTab(ctx), settingsSheet(ctx)];

  $('scrim').onclick = function () { each('closeSheet'); };
  document.addEventListener('touchstart', function () { lastTouch = Date.now(); }, { passive: true });
  document.addEventListener('mousedown', function () { lastTouch = Date.now(); });

  // --- socket ---

  function sendAll(list) {
    list.forEach(function (m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); });
  }

  function onUpdate(u) {
    lastOk = Date.now();
    var changed = null;
    if (u.kind === 'entities') {
      changed = applyEntityDiff(store, u.event);
      if (changed.has('sun.sun')) applyTheme();
    } else if (u.kind === 'action-failed') {
      var name = (store[u.entity] && store[u.entity].a.friendly_name) || u.entity;
      toast('Impossible de modifier ' + name + ' : ' + u.message);
    }
    each('onUpdate', u, changed);
    if (u.kind !== 'action-failed') setText('stale', '');
  }

  function connect() {
    state = initialState();
    keepAlive = newKeepAlive();
    each('onConnecting', state);
    ws = new WebSocket(haSocketUrl(cfg.host));
    ws.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === 'pong') { keepAlive = keepAlivePong(keepAlive); lastOk = Date.now(); return; }
      if (msg.type === 'auth_ok') attempt = 0;
      var out = handleMessage(state, msg, cfg);
      sendAll(out.send);
      if (msg.type === 'auth_ok') each('onConnected');
      if (out.update) onUpdate(out.update);
      if (state.fatal) setText('stale', 'Connexion refusée : ' + state.fatal);
    };
    ws.onclose = function () {
      ws = null;
      if (state.fatal) return;
      setTimeout(connect, backoffDelay(attempt++));
    };
  }

  // Ping every 30 s; a ping still unanswered at the next tick means a dead socket, so reconnect.
  setInterval(function () {
    if (!ws || ws.readyState !== 1 || !state.subId) return;
    var step = keepAliveTick(keepAlive, Date.now());
    keepAlive = step.ka;
    if (step.action === 'close') { ws.close(); return; }
    sendAll([{ id: state.nextId++, type: 'ping' }]);
  }, 30000);

  var hadTime = false;
  function tick() {
    renderClock();
    var now = new Date();
    // Day labels come from the frame's clock; relabel once the real time arrives and at midnight.
    var newDay = now.getHours() === 0 && now.getMinutes() === 0;
    if (clockTrusted(now) && !hadTime) { hadTime = true; newDay = true; }
    each('onTick', newDay);
    applyTheme();
    // Back to the home view after 3 idle minutes anywhere else; the Photos tab is meant to stay up.
    if (view !== 'home' && view !== 'photos' && Date.now() - lastTouch > 3 * 60000) showView('home');
    if (hadTime && now.getHours() === 3 && now.getMinutes() === 0) location.reload();
    // Until network time arrives, check every 2 s so the clock appears as soon as it is right.
    setTimeout(tick, clockTrusted(now) ? msToNextMinute(new Date()) : 2000);
  }

  showView('home');
  tick();
  connect();
  return { showView: showView, onUpdate: onUpdate }; // for test/smoke.test.js
}

// The pure functions of every page file, for the tests (test/page.js loads the files the way index.html does).
if (typeof module !== 'undefined') {
  module.exports = {
    parseDate: parseDate, formatClock: formatClock, formatTime: formatTime, formatDate: formatDate,
    clockTrusted: clockTrusted, dayLabel: dayLabel, conditionLabel: conditionLabel,
    conditionIcon: conditionIcon, weatherIcon: weatherIcon, wasteType: wasteType, cleanTitle: cleanTitle,
    binColor: binColor, binFill: binFill, applyEntityDiff: applyEntityDiff, parseForecast: parseForecast,
    parseEvents: parseEvents, groupByDay: groupByDay, todayEvents: todayEvents, parseTodos: parseTodos,
    todoDue: todoDue, todoLists: todoLists, reminderOptions: reminderOptions, nextTarget: nextTarget, climateView: climateView, roomIcon: roomIcon,
    lightView: lightView, domainOf: domainOf, colorTempView: colorTempView, colorView: colorView, serviceCall: serviceCall, haBase: haBase, photoUrls: photoUrls, isPortrait: isPortrait, slide: slide, shuffled: shuffled, haSocketUrl: haSocketUrl, eventsOnDay: eventsOnDay, chipOrder: chipOrder, monthGrid: monthGrid,
    weekDays: weekDays, localIso: localIso, msToNextMinute: msToNextMinute, backoffDelay: backoffDelay,
    staleLabel: staleLabel, newKeepAlive: newKeepAlive, keepAliveTick: keepAliveTick,
    keepAlivePong: keepAlivePong, initialState: initialState, handleMessage: handleMessage, refresh: refresh,
    fetchRange: fetchRange, isNight: isNight, hourlyPrices: hourlyPrices, evView: evView, solarView: solarView, roomTemps: roomTemps, solarIds: solarIds, fmtPower: fmtPower, peakTime: peakTime, evIds: evIds, stepTime: stepTime, fmtDur: fmtDur, musicView: musicView, nextVolume: nextVolume, playingSpeaker: playingSpeaker, compass: compass, weatherDetails: weatherDetails, apparentTemp: apparentTemp, dewPoint: dewPoint, parseRecipes: parseRecipes, thumbUrl: thumbUrl, tagLabel: tagLabel,
    recipeSearchData: recipeSearchData, recipeIngredients: recipeIngredients, parseRecipeHtml: parseRecipeHtml, parseBrowse: parseBrowse, parseMa: parseMa, maLibraryCall: maLibraryCall, maSearchCall: maSearchCall, playTarget: playTarget, browseCall: browseCall, SHELVES: SHELVES, recipeContentCall: recipeContentCall, recipeCall: recipeCall, RECIPE_TAGS: RECIPE_TAGS, start: start,
  };
}
