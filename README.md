# flat-xp.at – Neubau ohne WordPress

Nachbau der bisherigen WordPress-/Avada-Seite **flat-xp.at** als Node.js-Projekt.
Design, Texte, Bilder und URLs entsprechen dem Original.

**Ablauf:** Code liegt auf GitHub → GitHub baut die fertige Website → SiteGround holt sie sich.

```
 Änderung pushen ──► GitHub Action: npm run build ──► Branch "deploy" ──► SiteGround: git pull
   (Branch main)                                      (fertige HTML-Seiten)    (public_html)
```

Auf SiteGround läuft dadurch **kein Node.js und kein WordPress**: nur fertige HTML-Dateien und ein
kleines PHP-Skript fürs Kontaktformular. Das ist schnell, braucht keine Updates und bietet kaum Angriffsfläche.

---

## Projektaufbau

| Ordner / Datei | Inhalt |
|---|---|
| `content/site.json` | Menü, Kontaktdaten, Liste der Galerien, Anzahl News auf der Startseite |
| `content/pages/*.json` | alle Seiten (Hündinnen, Deckrüde, Würfe, Galerien, Impressum …) |
| `content/posts/*.json` | alle News-Beiträge |
| `views/*.ejs` | Templates (Layout, Startseite/Intro, News, Kontakt …) |
| `public/` | CSS, JavaScript, Schriften (lokal, DSGVO-konform) und alle Bilder (`public/uploads`) |
| `src/render.js` | erzeugt aus Inhalt und Templates die Seiten |
| `build.js` | schreibt die komplette Website nach `dist/` |
| `server.js` | Express-Server für die lokale Entwicklung bzw. Node-Hosting |
| `deploy/siteground/` | `.htaccess` (Weiterleitungen, HTTPS, Caching) und `kontakt.php` (Formular-Mailer) |
| `public/admin/` | Verwaltung (News, Seiten, Einstellungen) |
| `tools/images.js` | WebP-Erzeugung beim Build |
| `tools/import.js` | einmaliger Import aus der alten WordPress-Seite |
| `.github/workflows/deploy.yml` | automatischer Build und Deployment |

## Verwaltung (Inhalte pflegen)

Unter **https://flat-xp.at/admin/** gibt es eine Verwaltung für News, Seiten und Einstellungen.
Sie arbeitet direkt mit GitHub: Jedes „Speichern & veröffentlichen“ ist ein Commit, danach baut
GitHub die Seite neu und SiteGround übernimmt sie.

**Was geht:**
- **News:** neu anlegen, bearbeiten, löschen. Mit Titelbild, Bildern und Fotogalerien.
- **Seiten:** Der Editor zeigt die Seite im echten Design. Du klickst in den Text und schreibst.
  - Ein Klick auf ein Bild öffnet Ersetzen, Größe, Ausrichtung, Beschreibung und Löschen.
  - Ein Klick in eine Galerie öffnet Fotos hinzufügen und Spaltenanzahl.
  - Neue Seite aus Vorlage, z. B. „I-Wurf“ als Kopie vom H-Wurf; wird auf Wunsch gleich ins Würfe-Menü eingetragen.
  - Titel und Beschreibung für Google sind pro Seite einstellbar.
- **Einstellungen:** Kontaktdaten, Würfe-Menü (Reihenfolge, „Aktuell keine Würfe geplant“), Galerie-Übersicht.
- **Bilder:** Hochgeladene Fotos werden schon im Browser auf 1600 px verkleinert.

**Anmeldung – einmalig einen Zugangsschlüssel erstellen:**
1. github.com → Profilbild → *Settings* → *Developer settings* → *Personal access tokens* → *Fine-grained tokens* → *Generate new token*
2. Repository access: *Only select repositories* → `flat-xp`
3. Permissions: **Contents: Read and write**, **Actions: Read-only**
4. Token kopieren und in der Verwaltung einfügen (Häkchen „angemeldet bleiben“ nur auf eigenen Geräten).

Wer keinen Schlüssel hat, kann nichts ändern – die Verwaltungsseite selbst enthält keine Zugangsdaten.
Einen verlorenen Schlüssel einfach auf GitHub löschen.

## Bilder & Geschwindigkeit

`npm run build` erzeugt automatisch zu jedem Bild eine verkleinerte **WebP-Version** (max. 1600 px)
und verwendet diese auf der Website. Die Bilder wurden dadurch um rund 70 % kleiner (45,9 MB → 13,3 MB).
Die Originale bleiben für alte Links und Social-Media-Vorschauen erhalten.
Ergebnisse werden in `.cache/img` zwischengespeichert, auch in der GitHub Action.

## SEO

- Jede Seite hat einen sauberen Titel, eine Beschreibung und ein Vorschaubild für Facebook, WhatsApp usw. (Open Graph).
- Strukturierte Daten (schema.org):
  - Startseite und Kontakt: Zucht als `LocalBusiness` mit Adresse in Admont.
  - News: `BlogPosting`.
  - Alle Seiten: Brotkrumen-Navigation.
- `sitemap.xml` mit Änderungsdatum, `robots.txt` sperrt `/admin/`.
- Titel und Beschreibungen lassen sich in der Verwaltung pro Seite ändern.

## Lokal arbeiten

```bash
npm install
npm run dev        # http://localhost:3000, Änderungen an Inhalten sofort sichtbar
npm run build      # fertige Seite nach dist/
npm run preview    # dist/ testen auf http://localhost:4000
```

### Neuen News-Beitrag anlegen

Eine Datei `content/posts/<adresse>.json` anlegen, z. B. `content/posts/24-12-2026.json`:

```json
{
  "slug": "24-12-2026",
  "title": "24.12.2026",
  "date": "2026-12-24T10:00:00",
  "image": "/uploads/2026/12/weihnachten.jpg",
  "excerpt": "",
  "html": "<p>Frohe Weihnachten an alle Flat-XP-Freunde!</p><p><img src=\"/uploads/2026/12/weihnachten.jpg\" alt=\"\"></p>"
}
```

Bild nach `public/uploads/2026/12/` kopieren, committen, pushen – fertig.
Der Beitrag erscheint automatisch auf der Startseite (Timeline) und unter „News“.

### Seite ändern

Den Text in `content/pages/<seite>.json` (Feld `html`) bearbeiten. Das Menü steht in `content/site.json`.

---

## Einrichtung GitHub

1. Auf GitHub ein neues Repository anlegen (z. B. `flat-xp.at`, privat).
2. Hier im Projekt:
   ```bash
   git remote add origin https://github.com/<BENUTZER>/flat-xp.at.git
   git push -u origin main
   ```
3. Unter **Actions** startet „Build & Deploy“ automatisch. Danach gibt es den Branch **`deploy`**
   mit der fertigen Website.

## Betrieb auf SiteGround (aktuell: Node.js-Projekt)

SiteGround → *Node.js* → Bereitstellung über **GitHub**, Branch **main**, automatische Bereitstellung aktiv.
Framework *Express*, Node 22, Build-Befehl `npm run build`, Start `npm start` (`server.js`).
Der Server liefert die fertige Seite aus `dist/` aus (mit WebP), das Kontaktformular sendet an
`/kontakt/senden/` und verschickt per SMTP. Umgebungsvariablen in SiteGround:
`SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASS`, `MAIL_TO` (info@flat-xp.at).
Ohne SMTP-Werte werden Anfragen nur ins Server-Protokoll geschrieben.

## Alternative: statisch auf SiteGround (ohne Node.js)

Nur falls das Node.js-Projekt einmal nicht genutzt werden soll. Dann zusätzlich
`deploy/siteground/kontakt.php` nach `dist/` kopieren und im Formular (`views/kontakt.ejs`)
`action="/kontakt.php"` setzen.

> Funktioniert mit jedem SiteGround-Tarif (StartUp, GrowBig, GoGeek, Cloud). Node.js wird dort nicht gebraucht.

**1. SSH-Schlüssel auf SiteGround anlegen**
Site Tools → *Entwickler* → *SSH-Schlüssel-Manager* → Schlüssel erzeugen und den **öffentlichen** Schlüssel kopieren.

**2. Schlüssel bei GitHub hinterlegen** – entfällt, solange das Repo öffentlich ist
(es enthält keine Zugangsdaten). Wird es privat: GitHub-Repo → *Settings* → *Deploy keys* →
*Add deploy key* → öffentlichen Schlüssel einfügen, **ohne** Schreibrecht, und unten `git@github.com:` statt `https://` verwenden.

**3. Per SSH auf SiteGround verbinden** (Port 18765) und die Seite holen:

```bash
cd ~/www/flat-xp.at
mv public_html public_html_wordpress_alt        # alte WordPress-Seite als Sicherung behalten
git clone --branch deploy --single-branch https://github.com/arettenegger/flat-xp.git public_html
```

Die Seite ist sofort online. Vor der Domain-Umstellung lässt sie sich über die
SiteGround-Testadresse prüfen (die Weiterleitung auf https://flat-xp.at greift nur auf der echten Domain).

**4. Automatisch aktualisieren** – einen der beiden Wege wählen:

- **Einfach (Cronjob):** Site Tools → *Entwickler* → *Cron-Jobs*, alle 10 Minuten:
  ```bash
  cd ~/www/flat-xp.at/public_html && git fetch -q origin deploy && git reset -q --hard origin/deploy
  ```
- **Sofort nach jedem Push:** im GitHub-Repo unter *Settings → Secrets and variables → Actions* anlegen:
  `SG_HOST` (SSH-Host von SiteGround), `SG_USER` (SSH-Benutzer), `SG_SSH_KEY` (privater Schlüssel eines
  zweiten SiteGround-SSH-Schlüssels), `SG_PATH` (`/home/<benutzer>/www/flat-xp.at/public_html`).
  Die GitHub Action aktualisiert SiteGround dann direkt.

**5. Kontaktformular:** läuft über `kontakt.php` (PHP `mail()`), Empfänger `info@flat-xp.at`.
Damit Mails nicht im Spam landen, in SiteGround die E-Mail-Adresse `website@flat-xp.at` anlegen
(sie dient als Absender) oder `$FROM` in `deploy/siteground/kontakt.php` anpassen.

**6. Nach dem Umstieg:** WordPress-Datenbank und alten Ordner erst löschen, wenn alles passt.
Alte Links (`/wp-content/uploads/...`, `/feed/`, `/Purpose/...`) werden per `.htaccess` weitergeleitet.

---

## Alternative: als echte Node.js-App betreiben

Für Hosting mit Node.js (SiteGround Cloud/VPS, Hostinger, Render …):

```bash
npm ci --omit=dev
NODE_ENV=production PORT=3000 node server.js
```

Kontaktformular dann über SMTP: Umgebungsvariablen `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_TO`.

## Bekannte Punkte

- **Datenschutzerklärung** wurde 1:1 übernommen und erwähnt noch WordPress, Cookies (Borlabs) usw.
  Die neue Seite setzt **keine Cookies**, lädt **keine externen Schriften** und braucht **kein Cookie-Banner**.
  Die Erklärung sollte entsprechend angepasst werden.
- Einige Bilder/PDFs waren schon auf der alten Seite defekt (404) und fehlen daher auch hier
  (`npm run build && node tools/check-links.js` listet sie auf).
- Die Kommentarfunktion der alten News wurde nicht übernommen (es gab keine Kommentare).
