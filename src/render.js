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

/** Liefert eine Liste aller Routen: { url, render() } */
function routes() {
  const c = loadContent();
  const { site, pages, posts } = c;
  const base = { site, fmtDate, fmtMonth, year: new Date().getFullYear() };
  const page = (url, tpl, data) => ({
    url,
    render: () => view('layout', { ...base, ...data, current: url, body: view(tpl, { ...base, ...data, current: url }) }),
  });
  const list = [];

  // Intro (Startseite mit Animation)
  list.push({ url: '/', render: () => view('intro', { ...base, title: 'Dual Purpose Flat Coated Retrievers aus Admont, Österreich - Flat XP' }) });

  // Inhaltsseiten
  for (const p of pages) {
    const url = `/${p.slug}/`;
    if (p.slug === 'home') {
      list.push(page(url, 'page', {
        title: p.seoTitle || p.title, description: p.description,
        html: p.html.replace('<!--NEWS-->', view('timeline', { ...base, posts: posts.slice(0, site.homeNewsCount) })),
      }));
    } else {
      list.push(page(url, 'page', { title: p.seoTitle || `${p.title} - Flat-XP`, description: p.description, html: eagerFirst(p.html) }));
    }
  }

  // News-Übersicht mit Seitennummerierung
  const pagesCount = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  for (let i = 1; i <= pagesCount; i++) {
    const url = i === 1 ? '/blog/' : `/blog/page/${i}/`;
    list.push(page(url, 'blog', {
      title: i === 1 ? 'News - Flat-XP' : `News – Seite ${i} - Flat-XP`,
      description: 'Neuigkeiten von Flat-XP – Flat Coated Retriever aus Admont',
      posts: posts.slice((i - 1) * POSTS_PER_PAGE, i * POSTS_PER_PAGE), pageNo: i, pagesCount,
    }));
  }

  // Einzelne Beiträge
  posts.forEach((p, i) => {
    list.push(page(`/${p.slug}/`, 'post', {
      title: `${p.title} - Flat-XP`, description: p.excerpt.slice(0, 160), post: p,
      newer: posts[i - 1], older: posts[i + 1],
    }));
  });

  // Galerie-Übersicht
  const galleries = site.galleries.map(slug => pages.find(p => p.slug === slug)).filter(Boolean)
    .map(p => ({ slug: p.slug, title: p.title, image: firstImage(p.html), count: (p.html.match(/<figure>/g) || []).length }));
  list.push(page('/galerien/', 'galerien', { title: 'Galerien - Flat-XP', description: 'Fotogalerien von Flat-XP', galleries }));

  // Kontakt
  list.push(page('/kontakt/', 'kontakt', { title: 'Kontakt - Flat-XP', description: 'Kontakt zu Flat-XP, Barbara Aumann, Admont' }));
  list.push(page('/kontakt/danke/', 'danke', { title: 'Danke - Flat-XP', description: '', noindex: true }));

  // 404
  list.push(page('/404.html', 'notfound', { title: 'Seite nicht gefunden - Flat-XP', description: '', noindex: true }));

  return list;
}

module.exports = { routes, loadContent };
