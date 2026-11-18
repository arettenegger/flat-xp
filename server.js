/**
 * Node.js/Express-Server – für die lokale Entwicklung (npm run dev)
 * und für Hosting mit Node.js-Unterstützung (z. B. SiteGround Cloud/VPS).
 *
 * Kontaktformular-Versand per SMTP, Zugangsdaten über Umgebungsvariablen:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO
 */
const path = require('path');
const express = require('express');
const { routes } = require('./src/render');

const PORT = process.env.PORT || 3000;
const DEV = process.env.NODE_ENV !== 'production';
const app = express();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { maxAge: DEV ? 0 : '30d', index: false }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Alte WordPress-Pfade
app.get(/^\/wp-content\/uploads\/(.*)$/, (req, res) => res.redirect(301, '/uploads/' + req.params[0]));
app.get(/^\/Purpose\/(.*)$/i, (req, res) => res.redirect(301, '/' + req.params[0]));

let table = null;
function lookup(url) {
  if (DEV || !table) table = new Map(routes().map(r => [r.url, r]));
  return table.get(url);
}

app.post('/kontakt.php', async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.redirect(303, '/kontakt/danke/');
  if (!b.name || !b.nachricht || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '') || !b.dsgvo) {
    return res.status(400).send('Bitte Name, gültige E-Mail, Nachricht und Zustimmung angeben.');
  }
  const text = `Name: ${b.name}\nE-Mail: ${b.email}\nTelefon: ${b.telefon || ''}\nBetreff: ${b.betreff || ''}\n\n${b.nachricht}`;
  if (!process.env.SMTP_HOST) {
    console.log('--- Kontaktanfrage (kein SMTP konfiguriert) ---\n' + text);
    return res.redirect(303, '/kontakt/danke/');
  }
  try {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465), secure: +(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.sendMail({
      from: `Flat-XP Website <${process.env.SMTP_USER}>`, to: process.env.MAIL_TO || 'info@flat-xp.at',
      replyTo: b.email, subject: 'Anfrage über flat-xp.at' + (b.betreff ? ': ' + b.betreff : ''), text,
    });
    res.redirect(303, '/kontakt/danke/');
  } catch (e) {
    console.error(e);
    res.status(500).send('Die Nachricht konnte nicht gesendet werden. Bitte direkt an info@flat-xp.at schreiben.');
  }
});

app.get(/.*/, (req, res) => {
  let url = decodeURIComponent(req.path);
  if (!url.endsWith('/') && !/\.\w+$/.test(url)) return res.redirect(301, url + '/');
  const r = lookup(url);
  if (r) return res.type('html').send(r.render());
  res.status(404).type('html').send(lookup('/404.html').render());
});

app.listen(PORT, () => console.log(`Flat-XP läuft auf http://localhost:${PORT}`));
