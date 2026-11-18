/**
 * Erzeugt die komplette Website als statische Dateien in ./dist
 * (das wird über GitHub auf SiteGround ausgeliefert).
 *
 *   npm run build
 */
const fs = require('fs');
const path = require('path');
const { routes } = require('./src/render');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1) öffentliche Dateien kopieren (CSS, JS, Schriften, Bilder)
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// 2) Seiten rendern
const all = routes();
const seen = new Set();
for (const r of all) {
  if (seen.has(r.url)) { console.warn('Doppelte URL übersprungen:', r.url); continue; }
  seen.add(r.url);
  const file = r.url.endsWith('.html') ? path.join(DIST, r.url) : path.join(DIST, r.url, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, r.render());
}

// 3) Sitemap + robots.txt
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'site.json'), 'utf8'));
const urls = [...seen].filter(u => !u.endsWith('.html') && !u.includes('/danke/'));
fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `  <url><loc>${site.url}${u}</loc></url>`).join('\n') + '\n</urlset>\n');
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`);

// 4) Server-Dateien für SiteGround (Apache/PHP)
fs.cpSync(path.join(ROOT, 'deploy', 'siteground'), DIST, { recursive: true });

console.log(`Fertig: ${seen.size} Seiten nach dist/ geschrieben.`);
