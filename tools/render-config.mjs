// secrets/config.json -> build/assets/config.js. The waste calendar (optional) is fetched with the others.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export function renderConfig(cfg) {
  for (const k of ['host', 'token', 'weather', 'calendars']) {
    if (cfg[k] == null || cfg[k] === '') throw new Error(`config: missing ${k}`);
  }
  const calendars = [...new Set([...cfg.calendars, ...(cfg.waste ? [cfg.waste] : [])])];
  const out = { host: cfg.host, token: cfg.token, weather: cfg.weather, waste: cfg.waste || '', calendars,
    climate: cfg.climate || [], lights: cfg.lights || [], todo: cfg.todo || '',
    ev: cfg.ev || null, music: cfg.music || null, recipes: cfg.recipes || null,
    background: cfg.background || null,
    photos: cfg.photos || null, solar: cfg.solar || null, temperatures: cfg.temperatures || null, gusts: cfg.gusts || null, cameras: cfg.cameras || null, photoSeconds: cfg.photoSeconds || null };
  return `window.CONFIG = ${JSON.stringify(out)};\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = JSON.parse(readFileSync(new URL('../secrets/config.json', import.meta.url)));
  mkdirSync(new URL('../build/assets/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../build/assets/config.js', import.meta.url), renderConfig(cfg));
  console.log('wrote build/assets/config.js');
}
