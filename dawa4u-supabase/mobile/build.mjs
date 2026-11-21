// Copies a web app + the shared "common" folder into <app>/www for Capacitor.
// Usage: node build.mjs [customer|rider|pharmacy]   (no argument = all)
// The native apps open the live app on dawa4u.in (capacitor.config.json server.url); this copy is the
// offline fallback and what loads if the site can't be reached.
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const OFFLINE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>dawa4u</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B1708;color:#F1ECD6;font:16px system-ui,sans-serif;text-align:center;padding:24px}
button{margin-top:18px;height:48px;padding:0 24px;border:0;border-radius:12px;background:#2C6420;color:#fff;font-weight:700;font-size:16px}</style></head>
<body><div><h2 style="margin:0 0 8px">You're offline</h2><p style="opacity:.8;margin:0">Check your internet connection and try again.</p>
<button onclick="location.href='https://dawa4u.in/'+(location.pathname.includes('rider')?'rider':location.pathname.includes('pharmacy')?'pharmacy':'app')+'/'">Try again</button></div></body></html>`;
const here = dirname(fileURLToPath(import.meta.url)), web = join(here, '..', 'web');
const apps = { customer: 'app', rider: 'rider', pharmacy: 'pharmacy' };
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
  writeFileSync(join(www, 'offline.html'), OFFLINE);
  console.log(`built ${name} -> ${www}`);
}
