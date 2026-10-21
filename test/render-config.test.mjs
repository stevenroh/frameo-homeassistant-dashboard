import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConfig } from '../tools/render-config.mjs';

const base = { host: 'h', token: 't', weather: 'weather.w', waste: 'calendar.a', calendars: ['calendar.g'] };

test('renderConfig emits one window.CONFIG statement with waste added to calendars', () => {
  const js = renderConfig(base);
  const window = {};
  new Function('window', js)(window);
  assert.deepEqual(window.CONFIG.calendars, ['calendar.g', 'calendar.a']);
  assert.equal(window.CONFIG.token, 't');
});

test('renderConfig does not duplicate the waste calendar', () => {
  const window = {};
  new Function('window', renderConfig({ ...base, calendars: ['calendar.a'] }))(window);
  assert.deepEqual(window.CONFIG.calendars, ['calendar.a']);
});

test('renderConfig works without a waste calendar', () => {
  const window = {};
  new Function('window', renderConfig({ ...base, waste: undefined }))(window);
  assert.deepEqual(window.CONFIG.calendars, ['calendar.g']);
  assert.equal(window.CONFIG.waste, '');
});

test('renderConfig rejects missing keys', () => {
  assert.throws(() => renderConfig({ ...base, token: '' }), /missing token/);
});

test('renderConfig passes thermostats and lights through, defaulting to none', () => {
  const w1 = {};
  new Function('window', renderConfig(base))(w1);
  assert.deepEqual(w1.CONFIG.climate, []);
  assert.deepEqual(w1.CONFIG.lights, []);
  const w2 = {};
  new Function('window', renderConfig({ ...base, climate: ['climate.b'], lights: [{ id: 'light.x', name: 'X' }] }))(w2);
  assert.deepEqual(w2.CONFIG.climate, ['climate.b']);
  assert.deepEqual(w2.CONFIG.lights, [{ id: 'light.x', name: 'X' }]);
});

test('renderConfig passes the todo list through, defaulting to none', () => {
  const w1 = {};
  new Function('window', renderConfig(base))(w1);
  assert.equal(w1.CONFIG.todo, '');
  const w2 = {};
  new Function('window', renderConfig({ ...base, todo: 'todo.frame' }))(w2);
  assert.equal(w2.CONFIG.todo, 'todo.frame');
});

import { manifest } from '../tools/manifest.mjs';
test('manifest lists the files and never itself', () => {
  assert.deepEqual(manifest(['index.html', 'manifest.json', 'app.js'], 'v1'), { version: 'v1', files: ['index.html', 'app.js'] });
});
