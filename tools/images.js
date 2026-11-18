/**
 * Bildoptimierung für den Build:
 *  - erzeugt zu jedem JPG/PNG in dist/uploads eine verkleinerte WebP-Version (max. 1600 px)
 *  - schreibt alle Verweise in HTML/CSS auf die WebP-Dateien um
 *  - Cache in .cache/img (wird in der GitHub Action zwischen Builds aufbewahrt)
 * Die Originale bleiben zusätzlich erhalten (für alte Links und Social-Media-Vorschauen).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX = 1600;
const QUALITY = 78;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

async function optimize(dist, cacheDir) {
  let sharp;
  try { sharp = require('sharp'); } catch (e) {
    console.warn('sharp nicht installiert – Bilder werden nicht optimiert.');
    return;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const uploads = path.join(dist, 'uploads');
  const files = walk(uploads).filter(f => /\.(jpe?g|png)$/i.test(f));
  const map = new Map(); // "/uploads/a.jpg" -> "/uploads/a.webp"
  let before = 0, after = 0, fresh = 0;

  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < files.length) {
      const file = files[i++];
      const target = file.replace(/\.(jpe?g|png)$/i, '.webp');
      if (fs.existsSync(target)) continue; // Namenskollision → Original verwenden
      const buf = fs.readFileSync(file);
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      const cached = path.join(cacheDir, hash + '.webp');
      try {
        if (!fs.existsSync(cached)) {
          await sharp(buf).rotate()
            .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: QUALITY, effort: 5 })
            .toFile(cached);
          fresh++;
        }
        const size = fs.statSync(cached).size;
        if (size >= buf.length) continue; // WebP wäre größer → Original behalten
        fs.copyFileSync(cached, target);
        before += buf.length; after += size;
        const web = '/' + path.relative(dist, file).split(path.sep).join('/');
        map.set(web, web.replace(/\.(jpe?g|png)$/i, '.webp'));
      } catch (e) {
        console.warn('  Bild übersprungen:', path.relative(dist, file), e.message);
      }
    }
  }));

  // Verweise umschreiben (src, href, srcset, url(...)) – og:image bleibt beim Original
  const encodeMap = new Map();
  for (const [from, to] of map) {
    encodeMap.set(from, to);
    const enc = from.split('/').map(encodeURIComponent).join('/');
    if (enc !== from) encodeMap.set(enc, to.split('/').map(encodeURIComponent).join('/'));
  }
  const re = /((?:src|href)="|url\(['"]?)(\/uploads\/[^"')\s]+?\.(?:jpe?g|png))/gi;
  for (const f of walk(dist).filter(f => /\.(html|css)$/.test(f) && !f.includes(path.sep + 'admin' + path.sep))) {
    const src = fs.readFileSync(f, 'utf8');
    const out = src.replace(re, (m, pre, url) => (encodeMap.has(url) ? pre + encodeMap.get(url) : m));
    if (out !== src) fs.writeFileSync(f, out);
  }

  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  console.log(`Bilder: ${map.size} als WebP (${fresh} neu berechnet), ${mb(before)} → ${mb(after)}`);
}

module.exports = { optimize };
