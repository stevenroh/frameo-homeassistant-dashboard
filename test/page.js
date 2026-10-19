'use strict';
// Loads the page scripts the way the frame does: every <script src> of index.html in order (config.js aside), sharing
// one scope. Runs in this realm, so Dates and arrays from the page compare with the tests' own.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = path.join(__dirname, '..', 'page');
const BROWSER = ['window', 'document', 'localStorage', 'location', 'WebSocket', 'Date',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'];

function scripts() {
  const html = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]).filter((f) => f !== 'config.js');
}

// globals: browser objects for start() (see smoke.test.js); missing ones fall back to Node's own.
function load(globals = {}) {
  const code = scripts().map((f) => fs.readFileSync(path.join(PAGE, f), 'utf8')).join('\n');
  const run = vm.runInThisContext('(function (module, ' + BROWSER.join(', ') + ') {\n' + code + '\n})',
    { filename: 'page' });
  const module = { exports: {} };
  run(module, ...BROWSER.map((k) => (k in globals ? globals[k] : globalThis[k])));
  return module.exports;
}

module.exports = load();
module.exports.load = load;
module.exports.scripts = scripts;
