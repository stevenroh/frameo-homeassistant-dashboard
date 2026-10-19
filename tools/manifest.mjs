// build/assets/* -> build/assets/manifest.json, the list the frame's "Update dashboard" downloads.
// Run after the page files are copied into build/assets. Pass --no-config to keep config.js (the token) on the frame.
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

export function manifest(files, version) {
  return { version, files: files.filter((f) => f !== 'manifest.json') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL('../build/assets/', import.meta.url);
  let files = readdirSync(dir).filter((f) => f !== 'manifest.json');
  if (process.argv.includes('--no-config')) files = files.filter((f) => f !== 'config.js');
  let rev = 'dev';
  try { rev = execSync('git rev-parse --short HEAD', { cwd: new URL('..', import.meta.url) }).toString().trim(); } catch (e) { /* no git */ }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  writeFileSync(new URL('manifest.json', dir), JSON.stringify(manifest(files, `${rev} ${stamp}`), null, 1));
  console.log(`manifest.json: ${files.join(', ')}`);
}
