/**
 * Node.js/Express-Server
 *  - lokal:     npm run dev   (rendert jede Seite frisch aus content/)
 *  - SiteGround: npm run build, dann npm start
 *                → liefert die fertige Seite aus dist/ (mit WebP-Bildern) aus;
 *                  fehlt dist/, wird wie lokal live gerendert.
 *
 * Kontaktformular-Versand per SMTP, Zugangsdaten über Umgebungsvariablen:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO
 */
const path = require('path');
const express = require('express');
const { routes } = require('./src/render');

const fs = require('fs');

const PORT = process.env.PORT || 3000;
// Entwicklungsmodus nur ausdrücklich (npm run dev); sonst gilt Produktion
const DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const DIST = path.join(__dirname, 'dist');
const STATIC = !DEV && fs.existsSync(path.join(DIST, 'index.html'));
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  // www.flat-xp.at → flat-xp.at
  if (/^www\.flat-xp\.at$/i.test(req.hostname)) return res.redirect(301, 'https://flat-xp.at' + req.originalUrl);
  next();
});

// Alte WordPress-Pfade
app.get(/^\/wp-content\/uploads\/(.*)$/, (req, res) => res.redirect(301, '/uploads/' + req.params[0]));
app.get(/^\/Purpose\/(.*)$/i, (req, res) => res.redirect(301, '/' + req.params[0]));
app.get(/^\/(feed|comments\/feed)\/?$/, (req, res) => res.redirect(301, '/blog/'));
app.get(/^\/(author|category|tag)\/.*$/, (req, res) => res.redirect(301, '/blog/'));
app.get(/^\/galerien\/[^/]+\/?$/, (req, res) => res.redirect(301, '/galerien/'));
app.all(/^\/(wp-admin|wp-login\.php|xmlrpc\.php|wp-json)/, (req, res) => res.sendStatus(410));

const cache = (res, file) => {
  if (/\.html$/.test(file)) res.set('Cache-Control', 'no-cache');
  else if (/\.(webp|jpe?g|png|gif|svg|woff2?)$/i.test(file)) res.set('Cache-Control', 'public, max-age=31536000');
  else res.set('Cache-Control', 'public, max-age=2592000');
};
// Verwaltung (/admin/) – arbeitet direkt mit der GitHub-API
app.get('/admin', (req, res, next) => (req.originalUrl === '/admin' ? res.redirect(301, '/admin/') : next()));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin'), { index: 'index.html' }));
if (STATIC) app.use(express.static(DIST, { index: 'index.html', dotfiles: 'ignore', setHeaders: cache }));
app.use(express.static(path.join(__dirname, 'public'), { index: false, setHeaders: DEV ? undefined : cache }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Nur lokal: Inhalte als Liste, damit die Verwaltung ohne GitHub getestet werden kann
if (DEV) {
  app.get('/__dev/content', (req, res) => {
    const out = {};
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (p.endsWith('.json')) out[path.relative(__dirname, p).replace(/\\/g, '/')] = fs.readFileSync(p, 'utf8');
    });
    walk(path.join(__dirname, 'content'));
    res.json(out);
  });
}

let table = null;
function lookup(url) {
  if (DEV || !table) table = new Map(routes().map(r => [r.url, r]));
  return table.get(url);
}

// Formular-Ziel ist bewusst keine Datei, sonst beantwortet SiteGrounds nginx die Anfrage selbst
app.post(['/kontakt/senden/', '/kontakt/senden', '/kontakt.php'], async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.redirect(303, '/kontakt/danke/');
  if (!b.name || !b.nachricht || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '') || !b.dsgvo) {
    return res.status(400).send('Bitte Name, gültige E-Mail, Nachricht und Zustimmung angeben.');
  }
  const text = `Name: ${b.name}\nE-Mail: ${b.email}\nTelefon: ${b.telefon || ''}\nBetreff: ${b.betreff || ''}\n\n${b.nachricht}`;
  // Versand: SMTP, falls in SiteGround hinterlegt – sonst über das Mailsystem des Servers (sendmail)
  const TO = process.env.MAIL_TO || 'info@flat-xp.at';
  const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'info@flat-xp.at';
  const SENDMAIL = ['/usr/sbin/sendmail', '/usr/bin/sendmail'].find(f => fs.existsSync(f));
  if (!process.env.SMTP_HOST && !SENDMAIL) {
    console.log('--- Kontaktanfrage (kein Mailversand möglich) ---\n' + text);
    return res.redirect(303, '/kontakt/danke/');
  }
  try {
    const nodemailer = require('nodemailer');
    const t = process.env.SMTP_HOST
      ? nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465), secure: +(process.env.SMTP_PORT || 465) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
      : nodemailer.createTransport({ sendmail: true, path: SENDMAIL, newline: 'unix' });
    await t.sendMail({
      from: `Flat-XP Website <${FROM}>`, to: TO,
      replyTo: { name: String(b.name).replace(/[<>"\r\n]/g, ''), address: b.email },
      subject: 'Anfrage über flat-xp.at' + (b.betreff ? ': ' + String(b.betreff).replace(/[\r\n]/g, ' ') : ''), text,
    });
    console.log('Kontaktanfrage gesendet an ' + TO + ' (' + (process.env.SMTP_HOST ? 'SMTP' : 'sendmail') + ')');
    res.redirect(303, '/kontakt/danke/');
  } catch (e) {
    console.error(e);
    res.status(500).send('Die Nachricht konnte nicht gesendet werden. Bitte direkt an info@flat-xp.at schreiben.');
  }
});

app.get(/.*/, (req, res) => {
  if (STATIC) {
    // dist/ hat jede Seite als Ordner/index.html; was hier ankommt, gibt es nicht
    if (!req.path.endsWith('/') && !/\.\w+$/.test(req.path)) return res.redirect(301, req.path + '/');
    return res.status(404).sendFile('404.html', { root: DIST }); // root nötig: SiteGround-Pfad enthält .nodeapp
  }
  let url = decodeURIComponent(req.path);
  if (!url.endsWith('/') && !/\.\w+$/.test(url)) return res.redirect(301, url + '/');
  const r = lookup(url);
  if (r) return res.type('html').send(r.render());
  res.status(404).type('html').send(lookup('/404.html').render());
});

// Fehler nie mit technischen Details anzeigen
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).type('text').send(err.status === 404 ? 'Seite nicht gefunden.' : 'Es ist ein Fehler aufgetreten.');
});

app.listen(PORT, () => console.log(`Flat-XP läuft auf http://localhost:${PORT}` + (STATIC ? ' (fertige Seite aus dist/)' : DEV ? ' (Entwicklung)' : ' (live gerendert)')));
