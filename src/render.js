/**
 * Gemeinsamer Renderer: wird von build.js (statische Seite für SiteGround)
 * und server.js (Node/Express) genutzt. Liefert für jede URL fertiges HTML.
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');
const POSTS_PER_PAGE = 12;
const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function loadContent() {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'site.json'), 'utf8'));
  const pages = readJsonDir(path.join(ROOT, 'content', 'pages'));
  const posts = readJsonDir(path.join(ROOT, 'content', 'posts'))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  // Beiträge ohne Auszug: Text aus dem Inhalt nehmen
  for (const p of posts) {
    // Titelbild nur verwenden, wenn die Datei existiert
    if (p.image && p.image.startsWith('/') && !fs.existsSync(path.join(ROOT, 'public', decodeURIComponent(p.image)))) p.image = null;
    if (!p.excerpt) {
      p.excerpt = p.html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim().slice(0, 300);
    }
  }
  return { site, pages, posts };
}

const fmtDate = d => { const x = new Date(d); return `${x.getDate()}. ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
const fmtMonth = d => { const x = new Date(d); return `${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };

function view(name, data) {
  return ejs.render(fs.readFileSync(path.join(VIEWS, name + '.ejs'), 'utf8'), data, {
    filename: path.join(VIEWS, name + '.ejs'),
  });
}

// Bilder im sichtbaren Bereich nicht verzögert laden
function eagerFirst(html, n = 4) {
  let i = 0;
  return html.replace(/ loading="lazy"/g, m => (i++ < n ? '' : m));
}

function firstImage(html) {
  const m = (html || '').match(/<img[^>]+src="([^"]+)"/);
  return m ? m[1] : null;
}

/* ---------- SEO-Helfer ---------- */
const cutText = (s, n = 158) => (s.length <= n ? s : s.slice(0, n).replace(/[\s,;:–-]+\S*$/, '') + ' …');
const abs = (site, u) => (/^https?:\/\//.test(u) ? u : site.url + u);
const plain = html => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// erstes "echtes" Foto (keine Icons/Logos) für Vorschaubilder
function shareImage(html) {
  const fb = (html || '').match(/<img[^>]+src="(https:\/\/firebasestorage\.googleapis\.com\/[^"]+)"/);
  for (const m of (html || '').matchAll(/<img[^>]+src="(\/uploads\/[^"]+)"[^>]*>/g)) {
    const w = (m[0].match(/width="(\d+)"/) || [])[1];
    if (/icon|logo|\/2017\/06\/\d+-1\.png/i.test(m[1]) || (w && +w < 150)) continue;
    const exists = u => fs.existsSync(path.join(ROOT, 'public', decodeURIComponent(u)));
    const full = m[1].replace(/-\d+x\d+(\.\w+)$/, '$1'); // möglichst Originalgröße
    if (full !== m[1] && exists(full)) return full;
    if (exists(m[1])) return m[1];
  }
  return fb ? fb[1].replace(/&amp;/g, '&') : null;
}

function business(site) {
  const m = /^(\d{4})\s+(.+?)\s+[–-]\s+(.+)$/.exec(site.address) || [];
  return {
    '@type': 'LocalBusiness',
    '@id': site.url + '/#zucht',
    name: 'Flat-XP – Flat Coated Retriever Zucht',
    alternateName: 'Flat-XP Dual Purpose',
    description: 'Dual Purpose Flat Coated Retriever Zucht in Admont, Steiermark – ÖKV-Gütesiegel, behördlich gemeldete Zucht.',
    url: site.url + '/home/',
    logo: site.url + '/uploads/2018/06/logo-with-label-star.png',
    image: site.url + '/uploads/2020/08/KLEIN_Gruppenbild_flat_xp.jpg',
    founder: { '@type': 'Person', name: site.owner },
    telephone: site.phoneLink,
    email: site.email,
    address: { '@type': 'PostalAddress', streetAddress: m[3], postalCode: m[1], addressLocality: m[2], addressRegion: 'Steiermark', addressCountry: 'AT' },
    areaServed: 'AT',
  };
}

const crumbs = (site, items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: site.url + it[1] })),
});

/** Liefert eine Liste aller Routen: { url, render() } */
function routes() {
  const c = loadContent();
  const { site, pages, posts } = c;
  const base = { site, fmtDate, fmtMonth, year: new Date().getFullYear() };
  const DEFAULT_IMAGE = '/uploads/2020/08/KLEIN_Gruppenbild_flat_xp.jpg';
  const page = (url, tpl, data) => ({
    url,
    lastmod: data.lastmod,
    render: () => {
      const seo = {
        ogImage: abs(site, data.image || DEFAULT_IMAGE),
        ogType: data.ogType || 'website',
        jsonld: data.jsonld ? JSON.stringify({ '@context': 'https://schema.org', '@graph': [].concat(data.jsonld) }).replace(/</g, '\\u003c') : null,
      };
      return view('layout', { ...base, ...data, ...seo, current: url, body: view(tpl, { ...base, ...data, current: url }) });
    },
  });
  const list = [];

  // Intro (Startseite mit Animation)
  list.push({ url: '/', render: () => view('intro', { ...base, title: 'Flat-XP – Dual Purpose Flat Coated Retriever aus Admont, Österreich' }) });

  // Inhaltsseiten
  const wurfMenu = (site.menu.find(m => m.children) || { children: [] }).children;
  for (const p of pages) {
    const url = `/${p.slug}/`;
    const description = p.description || cutText(plain(p.html));
    const common = { title: p.seoTitle || `${p.title} | Flat-XP`, description, image: shareImage(p.html), lastmod: p.modified };
    if (p.slug === 'home') {
      list.push(page(url, 'page', {
        ...common, image: DEFAULT_IMAGE,
        jsonld: [{ '@type': 'WebSite', '@id': site.url + '/#website', url: site.url + '/', name: 'Flat-XP', inLanguage: 'de-AT', publisher: { '@id': site.url + '/#zucht' } }, business(site)],
        html: p.html.replace('<!--NEWS-->', view('timeline', { ...base, posts: posts.slice(0, site.homeNewsCount) })),
      }));
      continue;
    }
    const trail = [['Home', '/home/']];
    if (wurfMenu.some(w => w.url === url)) trail.push(['Würfe', url]);
    else if (site.galleries.includes(p.slug)) trail.push(['Galerien', '/galerien/']);
    trail.push([p.title, url]);
    list.push(page(url, 'page', { ...common, jsonld: [crumbs(site, trail)], html: eagerFirst(p.html) }));
  }

  // News-Übersicht mit Seitennummerierung
  const pagesCount = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  for (let i = 1; i <= pagesCount; i++) {
    const url = i === 1 ? '/blog/' : `/blog/page/${i}/`;
    list.push(page(url, 'blog', {
      title: i === 1 ? 'News aus unserer Zucht | Flat-XP Flat Coated Retriever' : `News – Seite ${i} | Flat-XP`,
      description: 'Neuigkeiten von Flat-XP: Würfe, Welpen, Prüfungen und Erlebnisse mit unseren Flat Coated Retrievern aus Admont.',
      posts: posts.slice((i - 1) * POSTS_PER_PAGE, i * POSTS_PER_PAGE), pageNo: i, pagesCount,
    }));
  }

  // Einzelne Beiträge
  posts.forEach((p, i) => {
    const url = `/${p.slug}/`;
    const image = p.image || shareImage(p.html);
    list.push(page(url, 'post', {
      title: `${p.title} – News | Flat-XP`, description: cutText(p.excerpt || plain(p.html)), post: p,
      image, ogType: 'article', lastmod: p.modified || p.date,
      newer: posts[i - 1], older: posts[i + 1],
      jsonld: [{
        '@type': 'BlogPosting', headline: p.title, datePublished: p.date, dateModified: p.modified || p.date,
        mainEntityOfPage: site.url + url, image: abs(site, image || DEFAULT_IMAGE),
        author: { '@type': 'Person', name: site.owner }, publisher: { '@id': site.url + '/#zucht' },
        description: cutText(p.excerpt || plain(p.html)),
      }, crumbs(site, [['Home', '/home/'], ['News', '/blog/'], [p.title, url]])],
    }));
  });

  // Galerie-Übersicht
  const galleries = site.galleries.map(slug => pages.find(p => p.slug === slug)).filter(Boolean)
    .map(p => ({ slug: p.slug, title: p.title, image: firstImage(p.html), count: (p.html.match(/<figure>/g) || []).length }));
  list.push(page('/galerien/', 'galerien', {
    title: 'Fotogalerien | Flat-XP Flat Coated Retriever', description: 'Fotogalerien von Flat-XP: Welpen, Training, Welpentreffen und Ausstellungen unserer Flat Coated Retriever aus Admont.',
    image: galleries[0] && galleries[0].image ? galleries[0].image.replace(/-\d+x\d+(\.\w+)$/, '$1') : null, galleries,
  }));

  // Kontakt
  list.push(page('/kontakt/', 'kontakt', {
    title: 'Kontakt | Flat-XP Flat Coated Retriever Admont',
    description: `Kontakt zu Flat-XP – ${site.owner}, ${site.address}. Anfragen zu Welpen, Würfen und Deckrüden.`,
    jsonld: [business(site), crumbs(site, [['Home', '/home/'], ['Kontakt', '/kontakt/']])],
  }));
  list.push(page('/kontakt/danke/', 'danke', { title: 'Danke | Flat-XP', description: '', noindex: true }));

  // 404
  list.push(page('/404.html', 'notfound', { title: 'Seite nicht gefunden | Flat-XP', description: '', noindex: true }));

  return list;
}

module.exports = { routes, loadContent };
