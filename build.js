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
const urls = all.filter((r, i) => all.findIndex(x => x.url === r.url) === i)
  .filter(r => !r.url.endsWith('.html') && !r.url.includes('/danke/'));
const lastmod = r => (r.lastmod && !isNaN(new Date(r.lastmod)) ? `<lastmod>${new Date(r.lastmod).toISOString().slice(0, 10)}</lastmod>` : '');
fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(r => `  <url><loc>${site.url}${r.url}</loc>${lastmod(r)}</url>`).join('\n') + '\n</urlset>\n');
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${site.url}/sitemap.xml\n`);

// 4) .htaccess für reines Apache-Hosting (kontakt.php nur bei Bedarf, siehe README)
fs.copyFileSync(path.join(ROOT, 'deploy', 'siteground', '.htaccess'), path.join(DIST, '.htaccess'));

console.log(`Fertig: ${seen.size} Seiten nach dist/ geschrieben.`);

// 5) Bilder verkleinern + WebP (mit --no-images überspringen)
if (!process.argv.includes('--no-images')) {
  require('./tools/images').optimize(DIST, path.join(ROOT, '.cache', 'img'))
    .catch(e => { console.error(e); process.exitCode = 1; });
}
