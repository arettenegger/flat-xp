/** Prüft, ob alle internen Links und Bilder im Build (dist/) existieren.  npm run check */
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'dist');
const missing = new Map();

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!f.endsWith('.html')) continue;
    const html = fs.readFileSync(p, 'utf8');
    for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
      const u = decodeURIComponent(m[1]);
      if (u === '/kontakt.php') continue;
      let target = path.join(D, u);
      if (u.endsWith('/')) target = path.join(target, 'index.html');
      if (!fs.existsSync(target)) {
        const list = missing.get(u) || [];
        list.push(path.relative(D, p));
        missing.set(u, list);
      }
    }
  }
}

walk(D);
console.log(`Fehlende Ziele: ${missing.size}`);
for (const [u, pages] of missing) console.log(`  ${u}  <-  ${pages.slice(0, 3).join(', ')}`);
process.exitCode = missing.size ? 1 : 0;
