'use strict';
// Music tab, and the music card on Home: the speaker that is playing, transport, volume, Spotify shelves.

// --- Spotify library (SpotifyPlus browse_media) ---

var SHELVES = [
  { id: 'spotify_user_playlists', label: 'Playlists' },
  { id: 'spotify_user_recently_played', label: 'Récents' },
  { id: 'spotify_user_saved_tracks', label: 'Titres likés' },
  { id: 'spotify_user_followed_artists', label: 'Artistes' },
  { id: 'spotify_user_saved_albums', label: 'Albums' },
];

function browseCall(state, entity, shelf) {
  var id = state.nextId++;
  state.pending[id] = { kind: 'browse', shelf: shelf };
  return { state: state, send: [{ id: id, type: 'media_player/browse_media', entity_id: entity,
    media_content_id: shelf, media_content_type: shelf }] };
}

// browse_media result -> playable tiles [{ title, uri, type, thumb }]
function parseBrowse(result) {
  var kids = result && result.children;
  if (!kids) return [];
  return kids.filter(function (c) { return c.media_content_id && c.media_content_id.indexOf('spotify:') === 0; }).map(function (c) {
    return { title: c.title || '', uri: c.media_content_id, type: c.media_content_type || '', thumb: c.thumbnail || '' };
  });
}

// What to ask SpotifyPlus to play: tracks by uri, everything else as a context (playlist, album, artist).
function playTarget(item, device) {
  if (item.uri.indexOf('spotify:track:') === 0) return { service: 'player_media_play_tracks', data: { uris: item.uri, device_id: device } };
  return { service: 'player_media_play_context', data: { context_uri: item.uri, device_id: device } };
}

// --- Music Assistant library (music.assistant: the MA config entry id) ---

var MA_SHELVES = [
  { id: 'radio', label: 'Radios' },
  { id: 'playlist', label: 'Playlists' },
  { id: 'album', label: 'Albums' },
  { id: 'artist', label: 'Artistes' },
  { id: 'track', label: 'Titres' },
];
var MA_SEARCH = { id: 'search', label: 'Résultats' };

function maLibraryCall(state, entry, type) {
  var id = state.nextId++;
  state.pending[id] = { kind: 'browse', shelf: type, ma: true };
  return { state: state, send: [{ id: id, type: 'call_service', domain: 'music_assistant', service: 'get_library',
    service_data: { config_entry_id: entry, media_type: type, limit: 60 }, return_response: true }] };
}

function maSearchCall(state, entry, text) {
  var id = state.nextId++;
  state.pending[id] = { kind: 'browse', shelf: MA_SEARCH.id, ma: true };
  return { state: state, send: [{ id: id, type: 'call_service', domain: 'music_assistant', service: 'search',
    service_data: { config_entry_id: entry, name: text, limit: 8 }, return_response: true }] };
}

// MA media item -> tile; a track shows its artist too.
function maTile(x) {
  var artist = x.artists && x.artists[0] && x.artists[0].name;
  return { title: (x.name || '') + (x.media_type === 'track' && artist ? ' · ' + artist : ''), uri: x.uri,
    type: x.media_type || '', thumb: typeof x.image === 'string' ? x.image : '' };
}

// get_library response ({ items }) or search response ({ radio, artists, albums, playlists, tracks }) -> tiles.
function parseMa(result) {
  var r = (result && result.response) || {};
  var items = r.items || [].concat(r.radio || [], r.artists || [], r.albums || [], r.playlists || [], r.tracks || []);
  return items.filter(function (x) { return x && x.uri; }).map(maTile);
}


// --- player ---

function fmtDur(sec) {
  if (sec == null || !isFinite(sec)) return '';
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + pad(sec % 60);
}

// media_player entity -> what the Music tab shows. Position is extrapolated while playing.
function musicView(e, now) {
  var a = (e && e.a) || {};
  var unavailable = !e || e.s === 'unavailable' || e.s === 'unknown';
  var playing = !unavailable && e.s === 'playing';
  var pos = a.media_position;
  if (pos != null && playing && a.media_position_updated_at) {
    pos += (now - new Date(a.media_position_updated_at)) / 1000;
  }
  var dur = a.media_duration;
  if (pos != null && dur) pos = Math.min(pos, dur);
  return {
    unavailable: unavailable, playing: playing, state: unavailable ? 'unavailable' : e.s,
    title: a.media_title || (playing || (e && e.s === 'paused') ? 'Inconnu' : 'Aucune lecture'),
    artist: a.media_artist || '', art: a.entity_picture || '',
    pos: pos, dur: dur, pct: pos != null && dur ? Math.round(pos / dur * 100) : 0,
    volume: a.volume_level != null ? Math.round(a.volume_level * 100) : null,
  };
}

function nextVolume(level, dir) {
  var v = Math.round(((level || 0) + dir * 0.05) * 100) / 100;
  return Math.min(1, Math.max(0, v));
}

// The speaker the player shows: the current one while it plays, else whichever one plays, unless the user picked one
// a moment ago.
function playingSpeaker(store, speakers, current, pickedAt, now) {
  if (now - pickedAt < 60000) return current;
  if (store[current] && store[current].s === 'playing') return current;
  for (var i = 0; i < speakers.length; i++) {
    var e = store[speakers[i].id];
    if (e && e.s === 'playing') return speakers[i].id;
  }
  return current;
}


function musicTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var store = ctx.store;
  var shown = ctx.shown;
  var setText = ctx.setText;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var sendAll = ctx.sendAll;
  var toast = ctx.toast;
  var state = null;
  var music = cfg.music || null;
  var speakers = (music && music.speakers) || [];
  var speaker = speakers.length ? speakers[0].id : null;
  var recent = [];
  try { recent = JSON.parse(localStorage.getItem('recent') || '[]'); } catch (x) { recent = []; }
  var PLAY = '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"></path></svg>';
  var PAUSE = '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"></rect><rect x="14" y="5" width="4" height="14" rx="1.2"></rect></svg>';
  var NOTE = '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="17" cy="16" r="3"></circle></svg>';

  var pickedAt = 0;
  var volDrag = false; // a finger is on the volume slider: don't move it under the finger

  // Library shelves: Music Assistant (music.assistant, a config entry id) or Spotify (music.library, SpotifyPlus).
  var ma = music && music.assistant || null;
  var library = ma ? null : music && music.library || null;
  var shelfList = ma ? MA_SHELVES : SHELVES;
  var shelf = shelfList[0].id;
  var shelves = {};   // shelf id -> tiles, null when it failed
  var shelfAsked = {};

  function loadShelf(id) {
    if (!(library || ma) || !state || !state.subId || shelfAsked[id] || id === MA_SEARCH.id) return;
    shelfAsked[id] = true;
    sendAll((ma ? maLibraryCall(state, ma, id) : browseCall(state, library, id)).send);
  }

  function speakerDevice() {
    var m = speakers.filter(function (x) { return x.id === speaker; })[0];
    var e = store[speaker];
    return (m && m.device) || (e && e.a.friendly_name) || (m && m.name) || '';
  }

  function renderShelf() {
    if (!(library || ma)) return;
    setHTML('mu-shelves', (MA_SEARCH.id in shelves ? [MA_SEARCH] : []).concat(shelfList).map(function (h) {
      return '<button class="chip' + (h.id === shelf ? ' on' : '') + '" data-shelf="' + h.id + '">' + esc(h.label) + '</button>';
    }).join(''));
    var items = shelves[shelf];
    setHTML('mu-lib', items ? items.map(function (t, i) {
      return '<button class="tile" data-i="' + i + '"><span class="tile-art' + (t.type === 'artist' ? ' round' : '') + '">' +
        (t.thumb ? '<img src="' + esc(t.thumb) + '" alt="" onerror="this.style.display=\'none\'">' : '') + '</span><span class="tile-t">' + esc(t.title) + '</span></button>';
    }).join('') || '<div class="rc-empty-s">Rien ici</div>' :
      '<div class="rc-empty-s">' + (items === null ? (ma ? 'Impossible de charger Music Assistant' : 'Impossible de charger Spotify') : 'Chargement…') + '</div>');
  }

  function playTile(t) {
    if (ma && state && t && speaker) {
      sendAll(serviceCall(state, 'music_assistant', 'play_media', speaker, { media_id: t.uri, media_type: t.type }).send);
      var on = speakers.filter(function (x) { return x.id === speaker; })[0];
      toast('Lecture de ' + t.title + (on ? ' sur ' + on.name : ''));
      return;
    }
    if (!state || !library || !t) return;
    var dev = speakerDevice();
    var pt = playTarget(t, dev);
    // SpotifyPlus takes entity_id as a plain string, which the websocket `target` (always a list) breaks.
    sendAll(serviceCall(state, 'spotifyplus', pt.service, null, Object.assign({ entity_id: library }, pt.data)).send);
    toast('Lecture de ' + t.title + (dev ? ' sur ' + dev : ''));
  }

  // What both players show, the Music tab (ids mu-*) and the Home card (mc-*).
  function renderPlayer(p, v) {
    setText(p + '-title', v.title);
    setText(p + '-artist', v.artist);
    // A cover that fails to load (a dead station logo, an address the frame cannot reach) falls back to the note.
    setHTML(p + '-art', v.art ? '<img src="' + esc(v.art.indexOf('/') === 0 ? haBase(cfg.host) + v.art : v.art) +
      '" alt="" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'\'">' +
      NOTE.replace('<svg', '<svg style="display:none"') : NOTE);
    var name = speakers.filter(function (m) { return m.id === speaker; })[0];
    setText(p + '-on', 'Sur ' + (name ? name.name : ''));
    setText(p + '-vol-v', v.volume == null ? '—' : v.volume + '%');
    if (!volDrag) {
      var r = $(p + '-vol-r');
      r.disabled = v.volume == null;
      if (+r.value !== (v.volume || 0)) { r.value = v.volume || 0; r.style.setProperty('--v', (v.volume || 0) + '%'); }
    }
    setHTML(p + '-play', v.playing ? PAUSE : PLAY);
    var label = v.playing ? 'Pause' : 'Lecture';
    if (shown[p + '-play:label'] !== label) { shown[p + '-play:label'] = label; $(p + '-play').setAttribute('aria-label', label); }
  }

  function renderMusicCard() {
    if (ctx.view() !== 'home' || !music) return;
    speaker = playingSpeaker(store, speakers, speaker, pickedAt, Date.now());
    renderPlayer('mc', musicView(store[speaker], new Date()));
  }

  function renderMusic() {
    if (ctx.view() !== 'music' || !music) return;
    speaker = playingSpeaker(store, speakers, speaker, pickedAt, Date.now());
    var v = musicView(store[speaker], new Date());
    renderPlayer('mu', v);
    setText('mu-eyebrow', v.playing ? 'EN LECTURE' : v.state === 'paused' ? 'EN PAUSE' : 'AUCUNE LECTURE');
    $('mu-fill').style.width = v.pct + '%';
    setText('mu-pos', fmtDur(v.pos));
    setText('mu-dur', fmtDur(v.dur));
    setHTML('mu-spk', speakers.map(function (m) {
      var u = store[m.id] && store[m.id].s === 'unavailable';
      return '<button class="spk' + (m.id === speaker ? ' on' : '') + '" data-id="' + m.id + '"' + (u ? ' disabled style="opacity:.4"' : '') + '>' +
        (m.id === speaker ? CHECK : '') + esc(m.name) + '</button>';
    }).join(''));
    renderShelf();
    setHTML('mu-recent', recent.map(function (r) { return '<button class="rc">' + esc(r) + '</button>'; }).join('') ||
      '<span class="muted" style="padding-top:0">Rien pour l’instant</span>');
  }

  function playQuery(q) {
    q = q.replace(/\s+/g, ' ').trim();
    if (ma) {
      if (!q || !state || !state.subId) return;
      shelf = MA_SEARCH.id;
      shelves[shelf] = undefined;
      sendAll(maSearchCall(state, ma, q).send);
      $('mu-q').blur();
      renderMusic();
      return;
    }
    if (!q || !state || !speaker) return;
    sendAll(serviceCall(state, 'media_player', 'play_media', speaker,
      { media_content_type: 'music', media_content_id: q + ' on Spotify' }).send);
    recent = [q].concat(recent.filter(function (r) { return r !== q; })).slice(0, 8);
    try { localStorage.setItem('recent', JSON.stringify(recent)); } catch (x) { /* storage off: no history */ }
    $('mu-q').value = '';
    $('mu-q').blur();
    toast('Demande à Alexa : ' + q);
    renderMusic();
  }

  if (!(library || ma)) { $('mu-shelves').style.display = 'none'; $('mu-lib').style.display = 'none'; }
  else { $('mu-recent').style.display = 'none'; $('mu-recent-l').style.display = 'none'; }
  if (ma) { $('mu-q').placeholder = 'Titre, artiste, album ou radio'; $('mu-go').textContent = 'Chercher'; $('mu-hint').textContent = 'Recherche dans Music Assistant ; touchez un résultat pour le lire.'; }

  // "search": false for speakers that are not Alexa or no Spotify: the search box could not play anything.
  if (music && music.search === false) {
    ['mu-searchrow', 'mu-hint', 'mu-recent', 'mu-recent-l'].forEach(function (id) { $(id).style.display = 'none'; });
    if (!library && !ma) { $('mu-find').style.display = 'none'; $('mu-now').style.width = 'auto'; $('mu-now').style.right = '24px'; }
  }

  if (!music) $('mc-box').style.display = 'none';
  if (music) {
    function transport(service) { if (state) sendAll(serviceCall(state, 'media_player', service, speaker, {}).send); }
    function vol(dir) {
      var e = store[speaker];
      if (!e) return;
      setVolume(nextVolume(e.a.volume_level, dir));
    }
    function setVolume(next) {
      var e = store[speaker];
      if (!state || !e) return;
      e.a.volume_level = next; // show it now; the subscription confirms
      renderMusic();
      renderMusicCard();
      sendAll(serviceCall(state, 'media_player', 'volume_set', speaker, { volume_level: next }).send);
    }
    ['mu', 'mc'].forEach(function (p) {
      $(p + '-play').onclick = function () { transport('media_play_pause'); };
      $(p + '-prev').onclick = function () { transport('media_previous_track'); };
      $(p + '-next').onclick = function () { transport('media_next_track'); };
      $(p + '-vdown').onclick = function () { vol(-1); };
      $(p + '-vup').onclick = function () { vol(1); };
    });
    // The sliders (Music tab and Home card) show the value while dragging and send one volume_set when the finger lifts.
    ['mu', 'mc'].forEach(function (p) {
      var r = $(p + '-vol-r');
      r.addEventListener('input', function () {
        volDrag = true;
        r.style.setProperty('--v', r.value + '%');
        setText(p + '-vol-v', r.value + '%');
      });
      r.addEventListener('change', function () {
        volDrag = false;
        setVolume(+r.value / 100);
      });
    });
    $('mc-open').onclick = function () { ctx.showView('music'); };
    $('mu-spk').onclick = function (e) {
      var b = e.target.closest('.spk');
      if (!b || b.disabled) return;
      speaker = b.getAttribute('data-id');
      pickedAt = Date.now();
      renderMusic();
    };
    $('mu-go').onclick = function () { playQuery($('mu-q').value); };
    $('mu-q').onkeydown = function (e) { if (e.keyCode === 13) playQuery($('mu-q').value); };
    $('mu-recent').onclick = function (e) {
      var b = e.target.closest('.rc');
      if (b) playQuery(b.textContent);
    };
    $('mu-shelves').onclick = function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      shelf = b.getAttribute('data-shelf');
      loadShelf(shelf);
      renderShelf();
    };
    $('mu-lib').onclick = function (e) {
      var b = e.target.closest('.tile');
      if (b) playTile((shelves[shelf] || [])[+b.getAttribute('data-i')]);
    };
    setInterval(function () { if (ctx.view() === 'music') renderMusic(); }, 5000);
  }

  if (!music) $('nav-music').style.display = 'none';

  return {
    onConnecting: function (s) { state = s; shelfAsked = {}; },
    onConnected: function () { if (ctx.view() === 'music') loadShelf(shelf); },
    onView: function (v) {
      if (v === 'home') renderMusicCard();
      if (v === 'music') { loadShelf(shelf); renderMusic(); }
    },
    onUpdate: function (u, changed) {
      if (u.kind === 'entities' && speakers.some(function (m) { return changed.has(m.id); })) {
        renderMusic();
        renderMusicCard();
      } else if (u.kind === 'browse') {
        shelves[u.shelf] = u.items;
        if (u.items === null) delete shelfAsked[u.shelf];
        renderMusic();
      }
    },
  };
}
