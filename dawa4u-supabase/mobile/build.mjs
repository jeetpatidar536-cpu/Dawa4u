// Copies a web app + the shared "common" folder into <app>/www for Capacitor.
// Usage: node build.mjs [customer|rider]   (no argument = both)
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), web = join(here, '..', 'web');
const apps = { customer: 'app', rider: 'rider' };
for (const [name, folder] of Object.entries(apps)) {
  if (process.argv[2] && process.argv[2] !== name) continue;
  const www = join(here, name, 'www');
  rmSync(www, { recursive: true, force: true });
  cpSync(join(web, folder), www, { recursive: true });
  cpSync(join(web, 'common'), join(www, 'common'), { recursive: true });
  // inside the native app, "../common/" becomes "./common/"
  const fix = dir => readdirSync(dir).forEach(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'common' && dir === www ? null : fix(p);
    if (/\.(html|js|webmanifest)$/.test(f)) writeFileSync(p, readFileSync(p, 'utf8').replaceAll('../common/', './common/'));
  });
  fix(www);
  console.log(`built ${name} -> ${www}`);
}
