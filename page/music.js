'use strict';
// Music tab, and the music card on Home: the speaker that is playing, transport, volume, Spotify shelves.

// --- Spotify library (SpotifyPlus browse_media) ---

var SHELVES = [
  { id: 'spotify_user_playlists', label: 'Playlists' },
  { id: 'spotify_user_recently_played', label: 'Recent' },
  { id: 'spotify_user_saved_tracks', label: 'Liked songs' },
  { id: 'spotify_user_followed_artists', label: 'Artists' },
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
    title: a.media_title || (playing || (e && e.s === 'paused') ? 'Unknown' : 'Not playing'),
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

  // Spotify library shelves (needs music.library: the SpotifyPlus media_player).
  var library = music && music.library || null;
  var shelf = SHELVES[0].id;
  var shelves = {};   // shelf id -> tiles, null when it failed
  var shelfAsked = {};

  function loadShelf(id) {
    if (!library || !state || !state.subId || shelfAsked[id]) return;
    shelfAsked[id] = true;
    sendAll(browseCall(state, library, id).send);
  }

  function speakerDevice() {
    var m = speakers.filter(function (x) { return x.id === speaker; })[0];
    var e = store[speaker];
    return (m && m.device) || (e && e.a.friendly_name) || (m && m.name) || '';
  }

  function renderShelf() {
    if (!library) return;
    setHTML('mu-shelves', SHELVES.map(function (h) {
      return '<button class="chip' + (h.id === shelf ? ' on' : '') + '" data-shelf="' + h.id + '">' + esc(h.label) + '</button>';
    }).join(''));
    var items = shelves[shelf];
    setHTML('mu-lib', items ? items.map(function (t, i) {
      return '<button class="tile" data-i="' + i + '"><span class="tile-art' + (t.type === 'artist' ? ' round' : '') + '">' +
        (t.thumb ? '<img src="' + esc(t.thumb) + '" alt="">' : '') + '</span><span class="tile-t">' + esc(t.title) + '</span></button>';
    }).join('') || '<div class="rc-empty-s">Nothing here</div>' :
      '<div class="rc-empty-s">' + (items === null ? 'Could not load Spotify' : 'Loading…') + '</div>');
  }

  function playTile(t) {
    if (!state || !library || !t) return;
    var dev = speakerDevice();
    var pt = playTarget(t, dev);
    // SpotifyPlus takes entity_id as a plain string, which the websocket `target` (always a list) breaks.
    sendAll(serviceCall(state, 'spotifyplus', pt.service, null, Object.assign({ entity_id: library }, pt.data)).send);
    toast('Playing ' + t.title + (dev ? ' on ' + dev : ''));
  }

  // What both players show, the Music tab (ids mu-*) and the Home card (mc-*).
  function renderPlayer(p, v) {
    setText(p + '-title', v.title);
    setText(p + '-artist', v.artist);
    setHTML(p + '-art', v.art ? '<img src="' + esc(v.art.indexOf('/') === 0 ? 'https://' + cfg.host + v.art : v.art) + '" alt="">' : NOTE);
    var name = speakers.filter(function (m) { return m.id === speaker; })[0];
    setText(p + '-on', 'On ' + (name ? name.name : ''));
    setText(p + '-vol-v', v.volume == null ? '—' : v.volume + '%');
    setHTML(p + '-play', v.playing ? PAUSE : PLAY);
    var label = v.playing ? 'Pause' : 'Play';
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
    setText('mu-eyebrow', v.playing ? 'NOW PLAYING' : v.state === 'paused' ? 'PAUSED' : 'NOT PLAYING');
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
      '<span class="muted" style="padding-top:0">Nothing yet</span>');
  }

  function playQuery(q) {
    q = q.replace(/\s+/g, ' ').trim();
    if (!q || !state || !speaker) return;
    sendAll(serviceCall(state, 'media_player', 'play_media', speaker,
      { media_content_type: 'music', media_content_id: q + ' on Spotify' }).send);
    recent = [q].concat(recent.filter(function (r) { return r !== q; })).slice(0, 8);
    try { localStorage.setItem('recent', JSON.stringify(recent)); } catch (x) { /* storage off: no history */ }
    $('mu-q').value = '';
    $('mu-q').blur();
    toast('Asking Alexa for ' + q);
    renderMusic();
  }

  if (!library) { $('mu-shelves').style.display = 'none'; $('mu-lib').style.display = 'none'; }
  else { $('mu-recent').style.display = 'none'; $('mu-recent-l').style.display = 'none'; }

  if (!music) $('mc-box').style.display = 'none';
  if (music) {
    function transport(service) { if (state) sendAll(serviceCall(state, 'media_player', service, speaker, {}).send); }
    function vol(dir) {
      var e = store[speaker];
      if (!state || !e) return;
      var next = nextVolume(e.a.volume_level, dir);
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
