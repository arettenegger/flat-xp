/**
 * Einmaliger Import der bestehenden WordPress-Seite flat-xp.at
 *  - holt Seiten + Beiträge (REST-API + gerenderte Live-Seiten)
 *  - wandelt das Avada/Fusion-HTML in schlankes, eigenes Markup um
 *  - lädt alle verwendeten Bilder nach public/uploads/ herunter
 *  - schreibt content/pages/*.json und content/posts/*.json
 *
 * Aufruf:  npm run import
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SITE = 'https://flat-xp.at';
const ROOT = path.join(__dirname, '..');
const OUT_PAGES = path.join(ROOT, 'content', 'pages');
const OUT_POSTS = path.join(ROOT, 'content', 'posts');
const UPLOADS = path.join(ROOT, 'public', 'uploads');
const UA = { 'User-Agent': 'Mozilla/5.0 (site-migration)' };

// Seiten, die nicht übernommen werden (Duplikate, leere Hilfsseiten)
const SKIP_PAGES = new Set(['home-2', 'g-wurf-2', 'slider', 'test-slide', 'galerien', 'welpen', 'blog', 'kontakt']);

const images = new Set();

async function get(url, type = 'text') {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return type === 'json' ? r.json() : type === 'buf' ? Buffer.from(await r.arrayBuffer()) : r.text();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function getAll(type, extra = '') {
  let all = [];
  for (let p = 1; ; p++) {
    const r = await fetch(`${SITE}/wp-json/wp/v2/${type}?per_page=100&page=${p}${extra}`, { headers: UA });
    if (!r.ok) break;
    const d = await r.json();
    if (!Array.isArray(d) || !d.length) break;
    all = all.concat(d);
  }
  return all;
}

/* ---------- URL-Umschreibung ---------- */
function localUrl(u) {
  if (!u) return u;
  u = u.trim().replace(/&amp;/g, '&');
  if (u.startsWith('//')) u = 'https:' + u;
  const m = u.match(/^(?:https?:\/\/(?:www\.)?flat-xp\.at)?\/wp-content\/uploads\/([^?#]+)/i);
  if (m) {
    const rel = decodeURIComponent(m[1]);
    images.add(rel);
    return '/uploads/' + rel.split('/').map(encodeURIComponent).join('/');
  }
  const p = u.match(/^https?:\/\/(?:www\.)?flat-xp\.at(\/[^#]*)?(#.*)?$/i);
  if (p) {
    let pathPart = (p[1] || '/').replace(/^\/Purpose\//i, '/');
    if (pathPart === '/home/') pathPart = '/home/';
    return pathPart + (p[2] || '');
  }
  return u;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const COL_WIDTH = {
  'fusion-one-full': '1-1', 'fusion-one-half': '1-2', 'fusion-one-third': '1-3', 'fusion-two-third': '2-3',
  'fusion-one-fourth': '1-4', 'fusion-three-fourth': '3-4', 'fusion-one-fifth': '1-5', 'fusion-two-fifth': '2-5',
  'fusion-three-fifth': '3-5', 'fusion-four-fifth': '4-5', 'fusion-one-sixth': '1-6', 'fusion-five-sixth': '5-6',
};

function cssVar(style, name) {
  const m = (style || '').match(new RegExp('--awb-' + name + ':\\s*([^;]+)'));
  return m ? m[1].trim() : null;
}

// nur harmlose Text-Styles übernehmen
function keepStyle(style, allowed = ['text-align', 'color', 'font-weight', 'font-style', 'text-decoration', 'text-transform']) {
  if (!style) return '';
  const out = style.split(';').map(s => s.trim()).filter(Boolean).filter(s => {
    const k = s.split(':')[0].trim().toLowerCase();
    return allowed.includes(k);
  });
  return out.length ? ` style="${attr(out.join(';'))}"` : '';
}

function imgSrc($el) {
  return $el.attr('data-orig-src') || $el.attr('data-src') || $el.attr('data-lazyload') || $el.attr('src');
}

function convert($, nodes) {
  let out = '';
  nodes.each((_, n) => { out += node($, n); });
  return out;
}

function kids($, el) { return convert($, $(el).contents()); }

function node($, n) {
  if (n.type === 'text') return esc(n.data);
  if (n.type !== 'tag') return '';
  const el = $(n);
  const tag = n.name.toLowerCase();
  const cls = (el.attr('class') || '');
  const has = c => cls.split(/\s+/).includes(c);

  if (['script', 'style', 'noscript', 'form', 'input', 'button', 'svg'].includes(tag)) return '';
  if (has('rich-snippet-hidden') || has('fusion-sep-clear') || has('fusion-clearfix') || has('fusion-column-inner-bg-image')) return '';
  if (/display:\s*none/.test(el.attr('style') || '')) return '';

  // Bereich / Zeile
  if (has('fusion-fullwidth')) {
    const st = el.attr('style') || '';
    const styles = [];
    const bg = cssVar(st, 'background-color'); if (bg) styles.push('background-color:' + bg);
    const bgi = cssVar(st, 'background-image');
    if (bgi) { const u = (bgi.match(/url\(["']?([^"')]+)/) || [])[1]; if (u) styles.push(`background-image:url('${localUrl(u)}')`); }
    for (const k of ['padding-top', 'padding-bottom']) { const v = cssVar(st, k); if (v && v !== '0px') styles.push(k + ':' + v); }
    const row = el.children('.fusion-builder-row').length ? el.children('.fusion-builder-row').first() : el;
    return `<div class="fx-section${bgi ? ' fx-section--bg' : ''}"${styles.length ? ` style="${attr(styles.join(';'))}"` : ''}><div class="fx-row">${kids($, row)}</div></div>`;
  }
  if (has('fusion-builder-row') || has('fusion-row')) return kids($, el);

  // Spalte
  if (has('fusion-layout-column')) {
    let w = '1-1';
    for (const k in COL_WIDTH) if (has(k)) w = COL_WIDTH[k];
    const wl = cssVar(el.attr('style'), 'width-large');
    if (wl && !Object.keys(COL_WIDTH).some(has)) {
      const pct = parseFloat(wl);
      w = pct > 90 ? '1-1' : pct > 70 ? '3-4' : pct > 60 ? '2-3' : pct > 45 ? '1-2' : pct > 30 ? '1-3' : pct > 22 ? '1-4' : '1-6';
    }
    const anchor = el.find('> .fusion-column-inner-bg a.fusion-column-anchor').attr('href');
    const wrapper = el.children('.fusion-column-wrapper').length ? el.children('.fusion-column-wrapper') : el;
    let inner = kids($, wrapper);
    const link = anchor ? `<a class="fx-col-link" href="${attr(localUrl(anchor))}" aria-label="Mehr"></a>` : '';
    const bg = cssVar(el.attr('style'), 'bg-color');
    return `<div class="fx-col w-${w}${anchor ? ' fx-col--linked' : ''}"${bg && bg !== 'rgba(255,255,255,0)' ? ` style="background-color:${attr(bg)}"` : ''}>${inner}${link}</div>`;
  }
  if (has('fusion-column-inner-bg')) return '';
  if (has('fusion-column-wrapper') || has('fusion-column-content-centered') || has('fusion-column-content')
    || has('fusion-text') || has('fusion-image-element') || has('imageframe-align-center')
    || has('fusion-content-tb') || has('post-content')) {
    const st = el.attr('style') || '';
    const ta = (st.match(/text-align:\s*(left|right|center)/) || [])[1];
    const k = kids($, el);
    return ta ? `<div style="text-align:${ta}">${k}</div>` : k;
  }

  if (has('fusion-separator')) return '<hr class="fx-sep">';
  if (has('fusion-title')) {
    return `<div class="fx-title${has('sep-underline') ? ' fx-title--underline' : ''}">${kids($, el)}</div>`;
  }
  // Revolution Slider -> eigener, schlanker Slider
  if (tag === 'rs-module-wrap' || tag === 'rs-module') {
    const slides = el.find('rs-slides').first().children('rs-slide');
    let items = '';
    const seen = new Set();
    slides.each((_, sl) => {
      const $sl = $(sl); const img = $sl.find('img').first();
      const src = img.attr('data-lazyload') || img.attr('src');
      if (!src || /dummy|transparent/.test(src) || seen.has(src)) return;
      seen.add(src);
      const cap = $sl.find('rs-layer').first().text().replace(/\s+/g, ' ').trim() || img.attr('alt') || '';
      items += `<figure class="fx-slide"><img src="${attr(localUrl(src))}" alt="${attr(img.attr('alt') || '')}"><figcaption>${esc(cap)}</figcaption></figure>`;
    });
    return items ? `<div class="fx-slider">${items}<div class="fx-dots"></div></div>` : '';
  }
  // Content-Boxen (Logos mit Titel)
  if (has('fusion-content-boxes')) {
    let items = '';
    el.find('.content-box-column').each((_, b) => {
      const $b = $(b); const a = $b.find('a.heading-link').first(); const img = $b.find('img').first();
      const t = $b.find('.content-box-heading').text().trim();
      const href = a.attr('href'); const ext = href && /^https?:/.test(localUrl(href));
      const inner = `${img.length ? `<img src="${attr(localUrl(imgSrc(img)))}" alt="" width="${attr(img.attr('width') || 56)}" height="${attr(img.attr('height') || 56)}" loading="lazy">` : ''}<span>${esc(t)}</span>`;
      items += href ? `<a class="fx-box" href="${attr(localUrl(href))}"${ext ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>` : `<div class="fx-box">${inner}</div>`;
    });
    return `<div class="fx-boxes">${items}</div>`;
  }
  // Blog-Element -> Platzhalter, wird vom Template mit News befüllt
  if (has('fusion-blog-shortcode')) return '<!--NEWS-->';
  if (tag === 'a' && has('fusion-button')) {
    return `<p class="fx-btn-wrap"><a class="fx-btn" href="${attr(localUrl(el.attr('href') || '#'))}"${el.attr('target') ? ' target="_blank" rel="noopener"' : ''}>${esc(el.text().trim())}</a></p>`;
  }
  if (has('fusion-button-wrapper')) return kids($, el);

  // WordPress- und Fusion-Galerien
  if (has('gallery') || has('fusion-gallery')) {
    const colsM = cls.match(/gallery-columns-(\d)/) || cls.match(/fusion-grid-(\d)/);
    const cols = colsM ? colsM[1] : '4';
    let items = '';
    el.find('.gallery-item, .fusion-grid-column, .fusion-gallery-column').each((_, it) => {
      const $it = $(it);
      const a = $it.find('a').first();
      const img = $it.find('img').first();
      if (!img.length) return;
      const thumb = localUrl(imgSrc(img));
      // Vollbild = Thumbnail ohne "-150x150"-Suffix
      const full = localUrl(a.attr('href') && /\.(jpe?g|png|gif|webp)$/i.test(a.attr('href'))
        ? a.attr('href') : imgSrc(img).replace(/-\d+x\d+(\.\w+)$/, '$1'));
      const cap = $it.find('.gallery-caption, .wp-caption-text').text().trim();
      items += `<figure><a href="${attr(full)}" class="lb" data-gallery="g"><img src="${attr(thumb)}" alt="${attr(img.attr('alt') || cap || '')}" loading="lazy"></a>${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`;
    });
    return `<div class="fx-gallery cols-${cols}">${items}</div>`;
  }

  if (has('fusion-imageframe') || has('wp-caption')) {
    const st = el.attr('style') || '';
    const styles = [];
    const b = st.match(/border:\s*([^;]+)/); if (b) styles.push('border:' + b[1]);
    const br = st.match(/border-radius:\s*([^;]+)/); if (br) styles.push('border-radius:' + br[1]);
    return `<span class="fx-img${has('hover-type-zoomin') ? ' zoom' : ''}"${styles.length ? ` style="${attr(styles.join(';'))}"` : ''}>${kids($, el)}</span>`;
  }

  if (tag === 'img') {
    const src = imgSrc(el);
    if (!src || /dummy\.png|transparent\.png|^data:/.test(src)) return '';
    const w = el.attr('width'), h = el.attr('height');
    const align = (cls.match(/align(left|right|center)/) || [])[1];
    return `<img src="${attr(localUrl(src))}" alt="${attr(el.attr('alt') || '')}"${w ? ` width="${attr(w)}"` : ''}${h ? ` height="${attr(h)}"` : ''}${align ? ` class="align${align}"` : ''} loading="lazy">`;
  }

  if (tag === 'a') {
    let href = el.attr('href') || '';
    if (!href || href === '#') return kids($, el);
    const isImg = /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(href);
    href = localUrl(href);
    const ext = /^https?:\/\//.test(href);
    return `<a href="${attr(href)}"${isImg ? ' class="lb"' : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${kids($, el)}</a>`;
  }

  if (tag === 'iframe') {
    const src = el.attr('src') || el.attr('data-orig-src') || '';
    if (/youtube|vimeo/.test(src)) return `<div class="fx-video"><iframe src="${attr(src)}" loading="lazy" allowfullscreen></iframe></div>`;
    return '';
  }

  if (tag === 'i' && /fa-|awb-icon|fusion-/.test(cls)) return '';

  const KEEP = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'br', 'table', 'thead',
    'tbody', 'tr', 'td', 'th', 'blockquote', 'figure', 'figcaption', 'sup', 'sub', 'hr'];
  if (KEEP.includes(tag)) {
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    let a = keepStyle(el.attr('style'));
    if (/has-text-align-center|aligncenter/.test(cls) && !a) a = ' style="text-align:center"';
    if ((tag === 'td' || tag === 'th') && el.attr('colspan')) a += ` colspan="${attr(el.attr('colspan'))}"`;
    const inner = kids($, el);
    if (tag === 'p' && !inner.replace(/&nbsp;|\s| /g, '')) return '';
    return `<${tag}${a}>${inner}</${tag}>`;
  }
  if (tag === 'span' || tag === 'font') {
    const a = keepStyle(el.attr('style'), ['color', 'font-weight', 'font-style', 'text-decoration']);
    const inner = kids($, el);
    return a ? `<span${a}>${inner}</span>` : inner;
  }
  // alles andere (div, section, …) auspacken
  return kids($, el);
}

function largestFromSrcset(img) {
  const ss = img.attr('srcset');
  if (!ss) return null;
  const parts = ss.split(',').map(s => s.trim().split(/\s+/)).map(([u, w]) => [u, parseInt(w) || 0]);
  parts.sort((a, b) => b[1] - a[1]);
  return parts[0] && parts[0][0];
}

function tidy(html) {
  return html
    .replace(/<div style="text-align:(\w+)">\s*<\/div>/g, '')
    .replace(/<(strong|em|span|h[1-6]|p)(\s[^>]*)?>(\s|&nbsp;| |<br>)*<\/\1>/g, '')
    .replace(/<(strong|em|span|h[1-6]|p)(\s[^>]*)?>(\s|&nbsp;| |<br>)*<\/\1>/g, '')
    .replace(/<div class="fx-title[^"]*">\s*<\/div>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decode(s) { return cheerio.load('<x>' + s + '</x>')('x').text(); }

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); }
  }));
}

(async () => {
  fs.mkdirSync(OUT_PAGES, { recursive: true });
  fs.mkdirSync(OUT_POSTS, { recursive: true });

  console.log('Lade Seiten …');
  const pages = (await getAll('pages')).filter(p => p.status === 'publish' && !SKIP_PAGES.has(p.slug));
  await pool(pages, 6, async p => {
    if (p.slug === 'home' && p.link === SITE + '/') return; // Intro-Seite (eigenes Template)
    const html = await get(p.link);
    const $ = cheerio.load(html);
    const content = $('#content .post-content').first().length ? $('#content .post-content').first() : $('#content').first();
    const body = tidy(convert($, content.contents()));
    const data = {
      slug: p.slug,
      title: decode(p.title.rendered),
      seoTitle: $('title').text().trim(),
      description: $('meta[name="description"]').attr('content') || '',
      modified: p.modified,
      html: body,
    };
    fs.writeFileSync(path.join(OUT_PAGES, p.slug + '.json'), JSON.stringify(data, null, 2));
    process.stdout.write('.');
  });

  console.log('\nLade Beiträge …');
  const posts = (await getAll('posts', '&_embed=wp:featuredmedia')).filter(p => p.status === 'publish');
  for (const p of posts) {
    const $ = cheerio.load('<div id="x">' + p.content.rendered + '</div>');
    const body = tidy(convert($, $('#x').contents()));
    const fm = p._embedded && p._embedded['wp:featuredmedia'] && p._embedded['wp:featuredmedia'][0];
    let image = null;
    if (fm && fm.source_url) {
      const sz = fm.media_details && fm.media_details.sizes;
      image = localUrl((sz && (sz.medium_large || sz.large || sz.full) || {}).source_url || fm.source_url);
    } else {
      const first = $('#x img').first();
      if (first.length) image = localUrl(imgSrc(first));
    }
    const $e = cheerio.load(p.excerpt.rendered);
    const data = {
      slug: p.slug,
      title: decode(p.title.rendered) || new Date(p.date).toLocaleDateString('de-AT'),
      date: p.date,
      modified: p.modified,
      categories: p.categories,
      image,
      excerpt: $e.text().replace(/\s+/g, ' ').replace(/\[…\]|\[&hellip;\]/g, '…').trim(),
      html: body,
    };
    fs.writeFileSync(path.join(OUT_POSTS, p.slug + '.json'), JSON.stringify(data, null, 2));
  }
  console.log(posts.length + ' Beiträge');

  // Bilder fürs Layout (Header, Hintergrund, Icons, Slider, Intro)
  [
    '2017/06/header-bg5-1.jpg', '2017/06/concrete_seamless-1.png', '2018/06/logo-with-label-star.png',
    '2017/06/23-1.png', '2017/06/15-1.png', '2017/06/18-1.png', '2017/06/21-1.png', '2017/06/20-1.png',
    '2020/08/KLEIN_Gruppenbild_flat_xp.jpg', '2017/06/logo-big.png',
    ...[1, 2, 3, 4, 5, 7, 8].map(n => `2017/09/main-slide-${n}.jpg`), '2017/09/main-slide-6-e1508948168602.jpg',
  ].forEach(i => images.add(i));

  console.log(`Lade ${images.size} Bilder …`);
  let ok = 0, fail = 0;
  await pool([...images], 8, async rel => {
    const dest = path.join(UPLOADS, rel);
    if (fs.existsSync(dest)) { ok++; return; }
    try {
      const buf = await get(`${SITE}/wp-content/uploads/${rel.split('/').map(encodeURIComponent).join('/')}`, 'buf');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      ok++;
    } catch (e) { fail++; console.warn('\n  fehlt:', rel, e.message); }
    if ((ok + fail) % 50 === 0) process.stdout.write(`${ok + fail} `);
  });
  console.log(`\nFertig: ${ok} Bilder ok, ${fail} fehlgeschlagen.`);
})();
