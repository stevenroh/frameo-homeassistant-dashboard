'use strict';
// Settings sheet: over-the-air updates through the kiosk app. window.Kiosk only exists inside the app.

function settingsSheet(ctx) {
  var $ = ctx.$;
  var kiosk = typeof window !== 'undefined' && window.Kiosk ? window.Kiosk : null;
  // Night schedule: off and on times in 30-minute steps; the kiosk app keeps them and switches the screen.
  var night = { on: false, off: '22:00', wake: '07:00' };
  function renderNight() {
    $('set-night').setAttribute('aria-checked', night.on ? 'true' : 'false');
    $('set-night-times').className = night.on ? '' : 'off';
    function row(key, label, value) {
      return '<span class="nt"><span>' + label + '</span><button class="icon-btn" data-nt="' + key + '" data-dir="-1" aria-label="Plus tôt">' +
        MINUS + '</button><b>' + value + '</b><button class="icon-btn" data-nt="' + key + '" data-dir="1" aria-label="Plus tard">' + PLUS + '</button></span>';
    }
    $('set-night-times').innerHTML = row('off', 'Éteint à', night.off) + row('wake', 'Rallumé à', night.wake);
  }
  function saveNight() { kiosk.setNightSchedule(night.on ? night.off : '', night.on ? night.wake : ''); renderNight(); }

  function openSettings() {
    ctx.each('pauseVideo'); // the camera video is drawn above the page and would cover the sheet
    $('set-ver').textContent = 'Version du tableau de bord : ' + kiosk.version();
    $('set-url').value = kiosk.updateUrl();
    if (kiosk.nightSchedule) {
      var n = kiosk.nightSchedule();
      if (n) { night.on = true; night.off = n.split('-')[0]; night.wake = n.split('-')[1]; } else night.on = false;
      renderNight();
    }
    $('scrim').style.display = '';
    $('set-sheet').style.display = '';
  }
  function closeSettings() {
    if ($('set-sheet').style.display !== 'none') ctx.each('resumeVideo'); // only when it really was open
    $('set-url').blur();
    $('scrim').style.display = 'none';
    $('set-sheet').style.display = 'none';
  }
  if (kiosk) {
    $('nav-set').style.display = '';
    $('nav-set').onclick = openSettings;
    $('set-close').onclick = closeSettings;
    $('set-update').onclick = function () { kiosk.setUpdateUrl($('set-url').value); closeSettings(); kiosk.update(); };
    $('set-reset').onclick = function () { closeSettings(); kiosk.reset(); };
    // An app installed before Quitter existed has no exit(); hide the button there.
    if (kiosk.exit) $('set-exit').onclick = function () { closeSettings(); kiosk.exit(); };
    else $('set-exit').style.display = 'none';
    if (kiosk.screenOff) $('set-off').onclick = function () { closeSettings(); kiosk.screenOff(); }; // a touch wakes it
    else $('set-off').style.display = 'none';
    if (kiosk.setNightSchedule) {
      $('set-night').onclick = function () { night.on = !night.on; saveNight(); };
      $('set-night-times').onclick = function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        var k = b.getAttribute('data-nt');
        night[k] = stepTime(night[k], +b.getAttribute('data-dir'));
        saveNight();
      };
    } else $('set-night-box').style.display = 'none';
  }

  return kiosk ? { closeSheet: closeSettings } : {};
}
