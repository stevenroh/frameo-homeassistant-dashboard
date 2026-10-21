'use strict';
// Settings sheet: over-the-air updates through the kiosk app. window.Kiosk only exists inside the app.

function settingsSheet(ctx) {
  var $ = ctx.$;
  var kiosk = typeof window !== 'undefined' && window.Kiosk ? window.Kiosk : null;
  function openSettings() {
    $('set-ver').textContent = 'Version du tableau de bord : ' + kiosk.version();
    $('set-url').value = kiosk.updateUrl();
    $('scrim').style.display = '';
    $('set-sheet').style.display = '';
  }
  function closeSettings() {
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
  }

  return kiosk ? { closeSheet: closeSettings } : {};
}
