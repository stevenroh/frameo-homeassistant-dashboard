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

function camerasTab(ctx) {
  var $ = ctx.$;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var cams = cameraList(ctx.cfg);
  var kiosk = typeof window !== 'undefined' && window.Kiosk && window.Kiosk.playRtsp ? window.Kiosk : null;
  var full = -1;      // the camera shown full screen, -1 for the grid
  var showing = false;

  if (!cams.length) $('nav-cameras').style.display = 'none';
  // Fewer cameras use the space: one fills it, two sit side by side.
  $('cam-grid').className = 'n' + Math.min(cams.length, 4);
  var CAM = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.5" width="13" height="11" rx="2.5"></rect><path d="M16 10.5l5-3v9l-5-3z"></path></svg>';
  // Cards like the Climate tab's: a head with the pictogram and name, the video below it.
  setHTML('cam-grid', cams.map(function (c) {
    return '<div class="cam-card"><div class="cs-head"><span class="cs-ic">' + CAM + '</span><span class="clim-name">' + esc(c.name) +
      '</span></div><div class="cam-vid">' + (kiosk ? '' : '<span>Les flux RTSP se lisent dans l’app du cadre.</span>') + '</div></div>';
  }).join(''));
  ctx.setText('cam-sub', cams.length + (cams.length > 1 ? ' caméras' : ' caméra') + ' · touchez une caméra pour l’agrandir');

  function layout() {
    if (!kiosk || !cams.length) return;
    $('view-cameras').className = 'view' + (full >= 0 ? ' full' : '');
    var vids = $('cam-grid').querySelectorAll('.cam-vid');
    cams.forEach(function (c, i) {
      if (full >= 0 && i !== full) { kiosk.stopVideo(i); return; }
      // Full screen plays the full stream, falling back to the grid's when the frame cannot play it.
      if (full >= 0) kiosk.playRtsp(i, c.name, c.full, c.url, 0, 0, 1280, 800, 1280);
      else { var r = vids[i].getBoundingClientRect(); kiosk.playRtsp(i, c.name, c.url, '', r.left, r.top, r.width, r.height, 1280); }
    });
  }

  // The kiosk app catches taps on the videos (they sit above the page).
  if (typeof window !== 'undefined') window.camTap = function (i) { full = full === i ? -1 : i; layout(); };

  return {
    onView: function (v) {
      if (v === 'cameras') { showing = true; full = -1; layout(); }
      else if (showing) { showing = false; full = -1; $('view-cameras').className = 'view'; if (kiosk) kiosk.stopVideo(-1); }
    },
    // Something opens over the tab (Settings): the videos, drawn above the page, step aside.
    pauseVideo: function () { if (showing && kiosk) kiosk.stopVideo(-1); },
    resumeVideo: function () { if (showing) layout(); },
  };
}
