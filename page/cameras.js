'use strict';
// Caméras tab: RTSP streams from cfg.cameras ([{ name, url }]), up to four in a 2x2 grid; a tap on one shows it full
// screen, another tap goes back to the grid. A page cannot play RTSP, so the kiosk app plays each stream with Android's
// own player over the tile this tab reserves for it, draws the names and states, and reports taps as camTap(slot).

// cfg.cameras -> [{ name, url, full }] with an rtsp:// url, at most four; anything else is dropped. full is the stream
// for full screen (e.g. the camera's HD stream1 while the grid uses stream2), url when not set.
function cameraList(cfg) {
  var rtsp = /^rtsp:\/\//;
  return (cfg.cameras || []).filter(function (c) { return c && rtsp.test(c.url || ''); }).slice(0, 4)
    .map(function (c, i) { return { name: c.name || 'Caméra ' + (i + 1), url: c.url, full: rtsp.test(c.full || '') ? c.full : c.url }; });
}

// The 16:9 rectangle centred on r ({ left, top, width, height }) that covers it, cropping the overflow: the player
// gets exactly the video's shape (this frame's player stretches the picture to its box) and there are no black bars.
function fitVideo(r, ratio) {
  ratio = ratio || 16 / 9;
  var w = Math.max(r.width, r.height * ratio);
  var h = w / ratio;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
}

// Size of a camera tile's video area: the largest 16:9 (or ratio) box that fits its grid cell. The grid is 1148 x 672
// (under the title), 12 px gaps, two columns (one for a single camera), and a 12 px card border around the video.
var CAM_GAP = 12, CAM_BORDER = 12;
function tileSize(n, ratio) {
  var cols = n > 1 ? 2 : 1;
  var rows = Math.ceil(n / cols);
  var cellW = (1148 - CAM_GAP * (cols - 1)) / cols - 2 * CAM_BORDER;
  var cellH = (672 - CAM_GAP * (rows - 1)) / rows - 2 * CAM_BORDER;
  var w = Math.min(cellW, cellH * ratio);
  return { width: Math.floor(w), height: Math.floor(w / ratio) };
}

// The stream in its tile: full height, centred, black only on the sides when it is narrower than the tile.
function fitHeight(r, ratio) {
  var w = Math.min(r.width, r.height * ratio);
  return { left: r.left + (r.width - w) / 2, top: r.top, width: w, height: r.height };
}

function camerasTab(ctx) {
  var $ = ctx.$;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var cams = cameraList(ctx.cfg);
  var kiosk = typeof window !== 'undefined' && window.Kiosk && window.Kiosk.playRtsp ? window.Kiosk : null;
  var full = -1;      // the camera shown full screen, -1 for the grid
  var ratios = cams.map(function () { return 16 / 9; }); // each stream's shape, as the kiosk app reports it
  var showing = false;

  if (!cams.length) $('nav-cameras').style.display = 'none';
  // Fewer cameras use the space: one fills it, two sit side by side.
  $('cam-grid').className = 'n' + Math.min(cams.length, 4);
  // Rounded cards holding a 16:9 video each (the tiles take the video's shape, so no black bars); the kiosk app writes
  // the camera's name on the video, which sits above the page.
  setHTML('cam-grid', cams.map(function (c) {
    // In the kiosk app the name is written on the video; here only without it.
    return '<div class="cam-card"><div class="cam-vid">' + (kiosk ? '' : '<span>' + esc(c.name) +
      ' · les flux RTSP se lisent dans l’app du cadre</span>') + '</div></div>';
  }).join(''));
  ctx.setText('cam-sub', cams.length + (cams.length > 1 ? ' caméras' : ' caméra') + ' · touchez une caméra pour l’agrandir');

  function layout() {
    if (!kiosk || !cams.length) return;
    $('view-cameras').className = 'view' + (full >= 0 ? ' full' : '');
    $('stale').style.visibility = full >= 0 ? 'hidden' : '';
    var vids = $('cam-grid').querySelectorAll('.cam-vid');
    var t = tileSize(cams.length, 16 / 9); // every tile the same size; the stream fits its height
    for (var k = 0; k < vids.length; k++) { vids[k].style.width = t.width + 'px'; vids[k].style.height = t.height + 'px'; }
    cams.forEach(function (c, i) {
      if (full >= 0 && i !== full) { kiosk.stopVideo(i); return; }
      // Full screen plays the full stream, falling back to the grid's when the frame cannot play it.
      var r = full >= 0 ? fitVideo({ left: 0, top: 0, width: 1280, height: 800 }, ratios[i]) : fitHeight(vids[i].getBoundingClientRect(), ratios[i]);
      if (full >= 0) kiosk.playRtsp(i, c.name, c.full, c.url, r.left, r.top, r.width, r.height, 1280);
      else kiosk.playRtsp(i, c.name, c.url, '', r.left, r.top, r.width, r.height, 1280);
    });
  }

  // The kiosk app reports a stream's real size once it plays: its video takes that width at the tile's full height.
  if (typeof window !== 'undefined') window.camSize = function (i, w, h) {
    if (!cams[i] || !w || !h || Math.abs(ratios[i] - w / h) < 0.01) return;
    ratios[i] = w / h;
    if (showing) layout();
  };

  // The kiosk app catches taps on the videos (they sit above the page).
  if (typeof window !== 'undefined') window.camTap = function (i) { full = full === i ? -1 : i; layout(); };

  return {
    onView: function (v) {
      if (v === 'cameras') { showing = true; full = -1; layout(); }
      else if (showing) {
        showing = false;
        full = -1;
        $('view-cameras').className = 'view';
        $('stale').style.visibility = '';
        if (kiosk) kiosk.stopVideo(-1);
      }
    },
    // Something opens over the tab (Settings): the videos, drawn above the page, step aside.
    pauseVideo: function () { if (showing && kiosk) kiosk.stopVideo(-1); },
    resumeVideo: function () { if (showing) layout(); },
  };
}
