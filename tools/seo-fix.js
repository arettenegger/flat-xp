/**
 * Einmalige SEO-Bereinigung der importierten Seiten:
 * saubere Seitentitel und Google-Beschreibungen (danach in der Verwaltung pflegbar).
 *   node tools/seo-fix.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'content', 'pages');
const site = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'site.json'), 'utf8'));
const BRAND = 'Flat-XP';
const REGION = 'Flat Coated Retriever aus Admont';

const NAMES = {
  'daisy-3': 'Daisy – Darling Desdemona Flat-XP',
  'anna-2': 'Anna Karenina Flat-XP',
  'undine-2': 'Undine vom Retrieverzwinger',
  'duke-ellington-flat-xp-2': 'Duke Ellington Flat-XP',
  'dustin-flat-xp-2': 'Dustin Flat-XP',
  'ally-mcbeal': 'Ally McBeal Flat-XP',
  'lilith': 'Lilith – Wonderful Thunderbird to Flat-XP',
  'deckruden': 'Deckrüden',
  'datenschutz': 'Datenschutzerklärung',
  'impressum': 'Impressum',
  'die-huendinnen': 'Unsere Hündinnen',
  'unvergessen': 'Unvergessen – unsere Hunde in Erinnerung',
  'wurfplanung': 'Wurfplanung',
};

const DESC = {
  'home': 'Flat-XP – Dual Purpose Flat Coated Retriever aus Admont in der Steiermark. Zucht mit ÖKV-Gütesiegel: jagdlich geführt, familienfreundlich, gesund. Würfe, Hunde & News.',
  'die-huendinnen': 'Die Zuchthündinnen von Flat-XP: Flat Coated Retriever aus jagdlicher Leistungszucht mit Show-Erfolgen – Ahnentafel, Gesundheit und Fotos.',
  'deckruden': 'Die Deckrüden von Flat-XP: Flat Coated Retriever mit Arbeits- und Showqualität – Gesundheitsergebnisse, Ahnentafel und Fotos.',
  'unvergessen': 'In Erinnerung an unsere Flat Coated Retriever, die uns begleitet und Flat-XP geprägt haben.',
  'impressum': 'Impressum von Flat-XP – Barbara Aumann, Flat Coated Retriever Zucht in Admont, Steiermark.',
  'datenschutz': 'Datenschutzerklärung der Website flat-xp.at.',
  'bisherige-wuerfe-bei-flat-xp': 'Alle bisherigen Würfe der Flat Coated Retriever Zucht Flat-XP aus Admont im Überblick.',
};

function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–')
    .replace(/[●•]/g, ',').replace(/\s+/g, ' ').trim();
}
function cut(s, n = 155) {
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/[\s,;:–-]+\S*$/, '') + ' …';
}

let n = 0;
for (const f of fs.readdirSync(DIR)) {
  const file = path.join(DIR, f);
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = p.slug;
  const name = NAMES[s] || p.title;
  const wurf = /^([a-z])-wurf$/.exec(s);
  const gallery = site.galleries.includes(s);

  if (s === 'home') p.seoTitle = `${BRAND} – Dual Purpose ${REGION}`;
  else if (wurf) p.seoTitle = `${wurf[1].toUpperCase()}-Wurf – Flat Coated Retriever Welpen | ${BRAND}`;
  else if (gallery) p.seoTitle = `${name} – Fotogalerie | ${BRAND}`;
  else p.seoTitle = `${name} | ${BRAND} ${REGION.replace(' aus ', ' ')}`;

  if (DESC[s]) p.description = DESC[s];
  else if (wurf) {
    const L = wurf[1].toUpperCase();
    p.description = cut(`Der ${L}-Wurf von Flat-XP: Elterntiere, Welpen und Fotos unserer Flat Coated Retriever aus Admont. ${text(p.html).replace(new RegExp(`^(Unser )?${L}-Wurf\\s*`, 'i'), '')}`);
  } else if (gallery) {
    p.description = `Fotogalerie „${p.title}“ von Flat-XP – Dual Purpose Flat Coated Retriever aus Admont, Steiermark.`;
  } else {
    p.description = cut(`${name}: ${text(p.html).replace(new RegExp('^' + p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '')}`);
  }
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
  n++;
}
console.log(`${n} Seiten bereinigt.`);
