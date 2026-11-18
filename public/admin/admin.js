/* =========================================================
   Flat-XP Verwaltung
   Anmeldung über Firebase (E-Mail/Passwort). Inhalte liest und
   schreibt der Server (/admin/api/github) im GitHub-Repository –
   der GitHub-Schlüssel liegt nur auf dem Server. Bilder landen in
   Firebase Storage. Jede Änderung ist ein Commit → neue Website.
   ========================================================= */
(function () {
  'use strict';

  const REPO = 'arettenegger/flat-xp';
  const BRANCH = 'main';
  const API = '/admin/api/github';
  const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  const S = {
    site: null, siteSha: null,
    pages: [],   // { path, data }
    posts: [],   // { path, data }
    uploads: new Map(), // Webpfad (/uploads/…) -> { path, b64, url }  (noch nicht gespeichert bzw. noch nicht online)
    dirty: false,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = d => { const x = new Date(d); return isNaN(x) ? '' : `${x.getDate()}. ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
  const pad = n => String(n).padStart(2, '0');

  /* ---------------- UI-Helfer ---------------- */
  function loading(on, text) {
    $('#loading').hidden = !on;
    if (text) $('#loadingText').textContent = text;
  }
  let toastTimer;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 8000 : 4000);
  }
  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  function confirmLeave() {
    if (!S.dirty) return true;
    if (!confirm('Es gibt ungespeicherte Änderungen. Trotzdem verlassen?')) return false;
    S.dirty = false;
    return true;
  }

  /* ---------------- Base64 / UTF-8 ---------------- */
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const textToB64 = s => bytesToB64(new TextEncoder().encode(s));
  const b64ToText = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));

  /* ---------------- GitHub-API ---------------- */
  async function gh(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + await window.XP_FB.token(),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!r.ok) {
      let msg = r.status + ' ' + r.statusText;
      try { const j = await r.json(); if (j.message) msg = j.message; } catch (e) { /* egal */ }
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return r.status === 204 ? null : r.json();
  }

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; await fn(items[k], k); }
    }));
  }

  async function loadAll() {
    loading(true, 'Lade Inhalte von GitHub …');
    const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
    const tree = await gh(`/repos/${REPO}/git/trees/${ref.object.sha}?recursive=1`);
    const files = tree.tree.filter(t => t.type === 'blob' && /^content\/.+\.json$/.test(t.path));
    const pages = [], posts = [];
    let done = 0;
    await pool(files, 10, async f => {
      const blob = await gh(`/repos/${REPO}/git/blobs/${f.sha}`);
      const data = JSON.parse(b64ToText(blob.content));
      if (f.path === 'content/site.json') { S.site = data; }
      else if (f.path.startsWith('content/pages/')) pages.push({ path: f.path, data });
      else if (f.path.startsWith('content/posts/')) posts.push({ path: f.path, data });
      done++;
      if (done % 10 === 0) $('#loadingText').textContent = `Lade Inhalte … ${done}/${files.length}`;
    });
    S.pages = pages.sort((a, b) => a.data.title.localeCompare(b.data.title, 'de'));
    S.posts = posts.sort((a, b) => new Date(b.data.date) - new Date(a.data.date));
    loading(false);
  }

  /**
   * Mehrere Dateien in EINEM Commit schreiben/löschen.
   * changes: [{ path, b64 }]  (b64 = null → Datei löschen)
   */
  async function commit(changes, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
      const head = await gh(`/repos/${REPO}/git/commits/${ref.object.sha}`);
      const entries = [];
      for (const c of changes) {
        if (c.b64 == null) { entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null }); continue; }
        const blob = await gh(`/repos/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: c.b64, encoding: 'base64' }) });
        entries.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const tree = await gh(`/repos/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree: entries }) });
      const c = await gh(`/repos/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: message + '\n\n(über die Flat-XP Verwaltung)', tree: tree.sha, parents: [ref.object.sha] }) });
      try {
        await gh(`/repos/${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
        watchDeploy();
        return;
      } catch (e) {
        if (attempt === 1 || e.status !== 422) throw e; // 422 = jemand hat gleichzeitig gespeichert → nochmal
      }
    }
  }

  const jsonFile = (path, data) => ({ path, b64: textToB64(JSON.stringify(data, null, 2)) });

  /* ---------------- Veröffentlichungs-Status ---------------- */
  let deployTimer;
  async function deployStatus() {
    try {
      const r = await gh(`/repos/${REPO}/actions/runs?branch=${BRANCH}&per_page=1`);
      const run = r.workflow_runs && r.workflow_runs[0];
      if (!run) return null;
      const box = $('#deployStatus');
      const when = new Date(run.updated_at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });
      if (run.status !== 'completed') box.innerHTML = '⏳ <b>Wird veröffentlicht …</b><br>Bitte 1–2 Minuten warten.';
      else if (run.conclusion === 'success') box.innerHTML = `✅ <b>Veröffentlicht</b><br>${when}<br><span>SiteGround übernimmt es innerhalb weniger Minuten.</span>`;
      else box.innerHTML = `⚠️ <b>Fehler beim Veröffentlichen</b><br><a href="${run.html_url}" target="_blank" rel="noopener">Details</a>`;
      return run;
    } catch (e) { return null; } // Token ohne Actions-Recht → einfach nichts anzeigen
  }
  function watchDeploy() {
    clearInterval(deployTimer);
    let n = 0;
    setTimeout(deployStatus, 4000);
    deployTimer = setInterval(async () => {
      const run = await deployStatus();
      if (++n > 40 || (n > 2 && run && run.status === 'completed')) clearInterval(deployTimer);
    }, 10000);
  }

  /* ---------------- Bilder ---------------- */
  function slugify(s) {
    return String(s).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'bild';
  }

  /** Bild verkleinern (und optional quadratisch zuschneiden), als JPEG vormerken. */
  async function prepareImage(file, { max = 1600, square = 0, suffix = '' } = {}) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0, w, h;
    if (square) {
      const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; w = h = square;
    } else {
      const k = Math.min(1, max / Math.max(sw, sh)); w = Math.round(sw * k); h = Math.round(sh * k);
    }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    const d = new Date();
    const base = slugify(file.name.replace(/\.[^.]+$/, ''));
    // direkt in Firebase Storage hochladen; die Adresse ist sofort öffentlich gültig
    const path = `uploads/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${base}-${Date.now().toString(36)}${suffix}.jpg`;
    const prev = $('#loadingText').textContent;
    $('#loadingText').textContent = 'Lade Bild hoch …';
    const was = $('#loading').hidden; $('#loading').hidden = false;
    try {
      const web = await window.XP_FB.upload(path, blob);
      return { web, url: web, w, h };
    } catch (e) {
      toast('Bild-Upload fehlgeschlagen: ' + e.message, true);
      throw e;
    } finally { $('#loading').hidden = was; $('#loadingText').textContent = prev; }
  }

  function pickFiles(multiple) {
    return new Promise(resolve => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = 'image/*'; i.multiple = !!multiple;
      i.onchange = () => resolve(Array.from(i.files || []));
      i.click();
    });
  }

  // für die Anzeige im Editor: Webpfad → Blob-URL (Bild ist evtl. noch nicht online)
  const displaySrc = web => (S.uploads.has(web) ? S.uploads.get(web).url : web);
  function toDisplay(html) {
    let out = html;
    for (const [web, u] of S.uploads) out = out.split(`"${web}"`).join(`"${u.url}"`);
    return out;
  }
  /** Blob-URLs zurück in Webpfade, und alle noch nicht gespeicherten Bilder, die vorkommen, als Dateien liefern */
  function fromDisplay(html) {
    const files = [];
    let out = html;
    for (const [web, u] of S.uploads) {
      if (out.includes(u.url)) out = out.split(u.url).join(web);
      if (!u.saved && out.includes(`"${web}"`)) files.push({ path: u.path, b64: u.b64, web });
    }
    return { html: out, files };
  }
  const markSaved = files => files.forEach(f => { const u = S.uploads.get(f.web); if (u) u.saved = true; });

  /* ---------------- HTML aufräumen ---------------- */
  function cleanHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    d.querySelectorAll('script, style, meta, link').forEach(n => n.remove());
    d.querySelectorAll('*').forEach(n => {
      n.removeAttribute('contenteditable');
      n.classList.remove('xp-sel');
      if (n.getAttribute('class') === '') n.removeAttribute('class');
      [...n.attributes].forEach(a => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); });
    });
    return d.innerHTML.replace(/<p>(\s|<br>)*<\/p>/g, '').trim();
  }
  const plainExcerpt = html => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 300);

  /* =========================================================
     WYSIWYG-Editor (zeigt den Inhalt im echten Website-Design)
     ========================================================= */
  function createEditor(host, html, opts = {}) {
    host.innerHTML = `
      <div class="editor-wrap">
        <div>
          <div class="toolbar">
            <button data-cmd="formatBlock" data-val="H2" title="Überschrift">H2</button>
            <button data-cmd="formatBlock" data-val="H3" title="Zwischenüberschrift">H3</button>
            <button data-cmd="formatBlock" data-val="P" title="Normaler Text">¶</button>
            <span class="sep"></span>
            <button data-cmd="bold" title="Fett"><b>F</b></button>
            <button data-cmd="italic" title="Kursiv"><i>K</i></button>
            <button data-cmd="underline" title="Unterstrichen"><u>U</u></button>
            <span class="sep"></span>
            <button data-cmd="justifyLeft" title="Linksbündig">⬅</button>
            <button data-cmd="justifyCenter" title="Zentriert">↔</button>
            <button data-cmd="justifyRight" title="Rechtsbündig">➡</button>
            <span class="sep"></span>
            <button data-cmd="insertUnorderedList" title="Aufzählung">• Liste</button>
            <button data-act="link" title="Link einfügen">🔗 Link</button>
            <button data-cmd="unlink" title="Link entfernen">⛓️‍💥</button>
            <span class="sep"></span>
            <button data-act="image" title="Bild einfügen">🖼️ Bild</button>
            <button data-act="gallery" title="Fotogalerie einfügen">🗂️ Galerie</button>
            <button data-cmd="insertHorizontalRule" title="Trennlinie">―</button>
            <span class="sep"></span>
            <button data-cmd="undo" title="Rückgängig">↶</button>
            <button data-cmd="redo" title="Wiederholen">↷</button>
            <button data-cmd="removeFormat" title="Formatierung entfernen">⌫ Format</button>
          </div>
          <iframe class="frame" title="Inhalt bearbeiten"></iframe>
        </div>
        <div class="panel" id="ctx">
          <h3>Tipps</h3>
          <p class="hint">Einfach in den Text klicken und schreiben – so sieht es auch auf der Website aus.</p>
          <p class="hint">Auf ein <b>Bild klicken</b>, um es zu ersetzen, zu verkleinern oder zu löschen.</p>
          <p class="hint">In eine <b>Galerie klicken</b>, um Fotos hinzuzufügen.</p>
          <p class="hint">Text aus Word/E-Mail wird ohne Formatierung eingefügt.</p>
        </div>
      </div>`;

    const frame = $('iframe', host);
    const ctx = $('#ctx', host);
    const ctxDefault = ctx.innerHTML;
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="/css/style.css">
      <style>
        body{background:#f2f2f2 url(/uploads/2017/06/concrete_seamless-1.png)}
        #ed{outline:none;min-height:60vh;padding-top:20px;padding-bottom:60px}
        #ed img{cursor:pointer}
        #ed .xp-sel{outline:3px solid #346533;outline-offset:2px}
        #ed .fx-gallery{min-height:60px;outline:1px dashed #9ab89a;outline-offset:6px}
        #ed .fx-col-link{display:none}
        #ed a{cursor:text}
      </style></head>
      <body><main class="site-main"><div class="content${opts.narrow ? ' narrow' : ''}" id="ed" contenteditable="true">${toDisplay(html)}</div></main></body></html>`;

    let doc, ed, selImg = null;
    const changed = () => { S.dirty = true; if (opts.onChange) { clearTimeout(changed.t); changed.t = setTimeout(opts.onChange, 400); } };

    frame.addEventListener('load', () => {
      doc = frame.contentDocument;
      ed = doc.getElementById('ed');
      doc.execCommand('defaultParagraphSeparator', false, 'p');
      ed.addEventListener('input', changed);
      if (opts.onChange) setTimeout(opts.onChange, 50);
      // Lightbox-/Links im Editor nicht öffnen
      ed.addEventListener('click', e => {
        const a = e.target.closest('a'); if (a) e.preventDefault();
        const img = e.target.closest('img');
        if (img) selectImage(img); else { deselect(); const g = e.target.closest('.fx-gallery'); if (g) galleryPanel(g); }
      });
      // Einfügen nur als reiner Text
      ed.addEventListener('paste', e => {
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (!text) return;
        e.preventDefault();
        const html = text.split(/\r?\n\s*\r?\n/).map(p => '<p>' + esc(p).replace(/\r?\n/g, '<br>') + '</p>').join('');
        doc.execCommand('insertHTML', false, html);
      });
      ed.addEventListener('keydown', e => {
        if (selImg && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeImage(); }
      });
    });

    function exec(cmd, val) {
      ed.focus();
      doc.execCommand('styleWithCSS', false, /^justify/.test(cmd));
      doc.execCommand(cmd, false, val);
      changed();
    }

    $$('.toolbar button', host).forEach(b => {
      b.addEventListener('mousedown', e => e.preventDefault()); // Auswahl im Editor behalten
      b.addEventListener('click', async () => {
        if (!doc) return;
        if (b.dataset.cmd) return exec(b.dataset.cmd, b.dataset.val);
        if (b.dataset.act === 'link') {
          const url = prompt('Adresse des Links (z. B. https://… oder /h-wurf/):', 'https://');
          if (url && url !== 'https://') exec('createLink', url);
        }
        if (b.dataset.act === 'image') {
          const [f] = await pickFiles(false); if (!f) return;
          loading(true, 'Bild wird vorbereitet …');
          try {
            const img = await prepareImage(f);
            ed.focus();
            exec('insertHTML', `<p style="text-align:center"><a href="${img.web}" class="lb"><img src="${img.url}" alt="" width="${Math.min(600, img.w)}"></a></p><p><br></p>`);
          } finally { loading(false); }
        }
        if (b.dataset.act === 'gallery') {
          const files = await pickFiles(true); if (!files.length) return;
          const items = await galleryItems(files);
          ed.focus();
          exec('insertHTML', `<div class="fx-gallery cols-4">${items}</div><p><br></p>`);
        }
      });
    });

    async function galleryItems(files) {
      let html = '';
      for (let i = 0; i < files.length; i++) {
        loading(true, `Foto ${i + 1} von ${files.length} wird vorbereitet …`);
        try {
          const full = await prepareImage(files[i]);
          const thumb = await prepareImage(files[i], { square: 300, suffix: '-thumb' });
          html += `<figure><a href="${full.web}" class="lb" data-gallery="g"><img src="${thumb.url}" alt="" loading="lazy"></a></figure>`;
        } catch (e) { toast('Foto konnte nicht gelesen werden: ' + files[i].name, true); }
      }
      loading(false);
      return html;
    }

    function deselect() {
      if (selImg) selImg.classList.remove('xp-sel');
      selImg = null;
      ctx.innerHTML = ctxDefault;
    }

    function selectImage(img) {
      deselect();
      selImg = img;
      img.classList.add('xp-sel');
      const inGallery = img.closest('.fx-gallery');
      ctx.innerHTML = `
        <h3>${inGallery ? 'Galerie-Foto' : 'Bild'}</h3>
        <img class="preview" src="${esc(img.src)}" alt="">
        ${inGallery ? '' : `
        <label>Größe</label>
        <div class="seg">
          <button class="btn" data-w="300">Klein</button>
          <button class="btn" data-w="600">Mittel</button>
          <button class="btn" data-w="">Groß</button>
        </div>
        <label>Ausrichtung</label>
        <div class="seg">
          <button class="btn" data-al="left">Links</button>
          <button class="btn" data-al="center">Mitte</button>
          <button class="btn" data-al="right">Rechts</button>
        </div>`}
        <label>Beschreibung (für Google &amp; Barrierefreiheit)
          <input id="alt" value="${esc(img.getAttribute('alt') || '')}">
        </label>
        <button class="btn" id="replace">Bild ersetzen …</button>
        ${inGallery ? '<button class="btn" id="addMore">Weitere Fotos zur Galerie …</button>' : ''}
        <button class="btn danger" id="remove">${inGallery ? 'Foto aus Galerie entfernen' : 'Bild entfernen'}</button>`;
      $('#alt', ctx).addEventListener('input', e => { img.setAttribute('alt', e.target.value); changed(); });
      $$('[data-w]', ctx).forEach(b => b.onclick = () => {
        img.removeAttribute('height');
        if (b.dataset.w) img.setAttribute('width', b.dataset.w); else img.removeAttribute('width');
        changed();
      });
      $$('[data-al]', ctx).forEach(b => b.onclick = () => {
        const block = img.closest('p, div, figure') || img.parentNode;
        if (block && block !== ed && !block.classList.contains('fx-col')) block.style.textAlign = b.dataset.al;
        img.classList.remove('alignleft', 'alignright', 'aligncenter');
        changed();
      });
      $('#replace', ctx).onclick = async () => {
        const [f] = await pickFiles(false); if (!f) return;
        loading(true, 'Bild wird vorbereitet …');
        try {
          if (inGallery) {
            const full = await prepareImage(f);
            const thumb = await prepareImage(f, { square: 300, suffix: '-thumb' });
            img.src = thumb.url;
            const a = img.closest('a'); if (a) a.setAttribute('href', full.web);
          } else {
            const nimg = await prepareImage(f);
            img.src = nimg.url;
            img.removeAttribute('height');
            const a = img.closest('a.lb'); if (a) a.setAttribute('href', nimg.web);
          }
          changed(); selectImage(img);
        } finally { loading(false); }
      };
      const add = $('#addMore', ctx);
      if (add) add.onclick = async () => {
        const files = await pickFiles(true); if (!files.length) return;
        inGallery.insertAdjacentHTML('beforeend', await galleryItems(files));
        changed();
      };
      $('#remove', ctx).onclick = removeImage;
    }

    function removeImage() {
      if (!selImg) return;
      const fig = selImg.closest('figure');
      const a = selImg.closest('a');
      (fig || a || selImg).remove();
      selImg = null;
      ctx.innerHTML = ctxDefault;
      changed();
    }

    function galleryPanel(g) {
      ctx.innerHTML = `
        <h3>Galerie</h3>
        <p class="hint">${g.querySelectorAll('figure').length} Fotos</p>
        <label>Spalten
          <select id="cols">${[2, 3, 4, 5, 6].map(n => `<option ${g.classList.contains('cols-' + n) ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <button class="btn" id="gAdd">Fotos hinzufügen …</button>
        <button class="btn danger" id="gDel">Ganze Galerie löschen</button>`;
      $('#cols', ctx).onchange = e => {
        g.className = g.className.replace(/cols-\d/, '').trim() + ' cols-' + e.target.value;
        changed();
      };
      $('#gAdd', ctx).onclick = async () => {
        const files = await pickFiles(true); if (!files.length) return;
        g.insertAdjacentHTML('beforeend', await galleryItems(files));
        changed(); galleryPanel(g);
      };
      $('#gDel', ctx).onclick = () => {
        if (confirm('Die ganze Galerie mit allen Fotos aus dieser Seite entfernen?')) { g.remove(); ctx.innerHTML = ctxDefault; changed(); }
      };
    }

    return {
      peek() { return ed ? ed.innerHTML : html; },
      getHtml() {
        if (!ed) return null;
        if (selImg) selImg.classList.remove('xp-sel');
        return cleanHtml(ed.innerHTML);
      },
    };
  }

  /* =========================================================
     Ansichten
     ========================================================= */
  const view = () => $('#view');

  function route() {
    const h = location.hash.replace(/^#/, '') || 'news';
    const [name, arg] = h.split('/');
    $$('.side nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
    window.scrollTo(0, 0);
    if (name === 'news') return newsList();
    if (name === 'news-edit') return newsEdit(arg ? decodeURIComponent(arg) : null);
    if (name === 'seiten') return pagesList();
    if (name === 'seite') return pageEdit(decodeURIComponent(arg));
    if (name === 'einstellungen') return settings();
    if (name === 'seo') return seoOverview();
    newsList();
  }
  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (!confirmLeave()) { history.replaceState(null, '', lastHash || '#news'); return; }
    lastHash = location.hash;
    route();
  });
  const go = h => { S.dirty = false; location.hash = h; };

  /* ---------- News-Liste ---------- */
  function newsList() {
    view().innerHTML = `
      <div class="head">
        <div><h1>News</h1><p>${S.posts.length} Beiträge · die neuesten ${S.site.homeNewsCount} erscheinen auf der Startseite</p></div>
        <div class="actions"><a class="btn primary" href="#news-edit">＋ Neuer Beitrag</a></div>
      </div>
      <input class="search" type="search" placeholder="Suchen …" id="q">
      <div class="list" id="list"></div>`;
    const render = q => {
      q = (q || '').toLowerCase();
      $('#list').innerHTML = S.posts
        .filter(p => !q || (p.data.title + ' ' + p.data.html).toLowerCase().includes(q))
        .map(p => `
          <div class="row" data-slug="${esc(p.data.slug)}">
            ${p.data.image ? `<img src="${esc(displaySrc(p.data.image))}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
            <div class="t"><b>${esc(p.data.title)}</b><small>${fmtDate(p.data.date)} · ${esc(plainExcerpt(p.data.html).slice(0, 90))}</small></div>
          </div>`).join('') || '<div class="row">Nichts gefunden.</div>';
      $$('#list .row[data-slug]').forEach(r => r.onclick = () => go('news-edit/' + encodeURIComponent(r.dataset.slug)));
    };
    render();
    $('#q').addEventListener('input', e => render(e.target.value));
  }

  /* ---------- News bearbeiten / neu ---------- */
  function newsEdit(slug) {
    const existing = slug ? S.posts.find(p => p.data.slug === slug) : null;
    if (slug && !existing) return go('news');
    const now = new Date();
    const p = existing ? { ...existing.data } : {
      slug: '', title: `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`,
      date: now.toISOString().slice(0, 19), image: null, excerpt: '', html: '<p>Hier den Text schreiben …</p>', categories: [1],
    };
    let cover = p.image;

    view().innerHTML = `
      <div class="head">
        <div><a href="#news">← Alle News</a><h1>${existing ? 'Beitrag bearbeiten' : 'Neuer Beitrag'}</h1></div>
        <div class="actions">
          ${existing ? `<a class="btn" href="/${esc(p.slug)}/" target="_blank" rel="noopener">Online ansehen ↗</a><button class="btn danger" id="del">Löschen</button>` : ''}
          <button class="btn primary" id="save">💾 Speichern &amp; veröffentlichen</button>
        </div>
      </div>
      <div class="card">
        <div class="grid3">
          <label>Überschrift<input id="title" value="${esc(p.title)}"></label>
          <label>Datum<input id="date" type="date" value="${esc(p.date.slice(0, 10))}"></label>
          <label>Titelbild <span class="hint">(für Übersicht)</span>
            <div class="cover"><img id="coverImg" src="${cover ? esc(displaySrc(cover)) : ''}" alt="" ${cover ? '' : 'hidden'}>
              <div><button class="btn small" id="coverPick">Wählen …</button> <button class="btn small danger" id="coverDel" ${cover ? '' : 'hidden'}>Entfernen</button></div>
            </div>
          </label>
        </div>
      </div>
      <div id="seoBox"></div>
      <div id="ed"></div>`;

    const seoState = { seoTitle: p.seoTitle || '', description: p.description || '', keyword: p.keyword || '' };
    let editor;
    const seo = XP_SEO.panel($('#seoBox'), {
      get: () => ({ kind: 'post', title: $('#title').value.trim(), slug: p.slug, date: $('#date').value, html: editor ? editor.peek() : p.html, ...seoState }),
      set: f => { Object.assign(seoState, f); S.dirty = true; },
      all: seoItems,
    });
    editor = createEditor($('#ed'), p.html, { narrow: true, onChange: () => seo.update() });
    ['title', 'date'].forEach(id => $('#' + id).addEventListener('input', () => { S.dirty = true; seo.update(); }));

    $('#coverPick').onclick = async () => {
      const [f] = await pickFiles(false); if (!f) return;
      loading(true, 'Bild wird vorbereitet …');
      try {
        const img = await prepareImage(f, { max: 1200 });
        cover = img.web;
        $('#coverImg').src = img.url; $('#coverImg').hidden = false; $('#coverDel').hidden = false;
        S.dirty = true;
      } finally { loading(false); }
    };
    $('#coverDel').onclick = () => { cover = null; $('#coverImg').hidden = true; $('#coverDel').hidden = true; S.dirty = true; };

    $('#save').onclick = async () => {
      const raw = editor.getHtml();
      if (raw == null) return;
      const title = $('#title').value.trim();
      const date = $('#date').value;
      if (!title || !date) return toast('Bitte Überschrift und Datum angeben.', true);
      const { html, files } = fromDisplay(raw);
      const time = existing && existing.data.date.slice(0, 10) === date ? existing.data.date.slice(10) : 'T12:00:00';
      const data = { ...p, ...seoState, title, date: date + time, image: cover || null, excerpt: '', html, modified: new Date().toISOString().slice(0, 19) };
      if (!existing) {
        const [y, m, d] = date.split('-');
        let base = `${d}-${m}-${y}`, s = base, n = 2;
        const taken = new Set([...S.posts.map(x => x.data.slug), ...S.pages.map(x => x.data.slug), 'home', 'blog', 'galerien', 'kontakt', 'admin', 'uploads']);
        while (taken.has(s)) s = `${base}-${n++}`;
        data.slug = s;
      }
      if (cover && S.uploads.has(cover) && !S.uploads.get(cover).saved) files.push({ path: S.uploads.get(cover).path, b64: S.uploads.get(cover).b64, web: cover });
      const path = existing ? existing.path : `content/posts/${data.slug}.json`;
      loading(true, 'Speichere …');
      try {
        await commit([...files, jsonFile(path, data)], `News ${existing ? 'geändert' : 'neu'}: ${title}`);
        markSaved(files);
        if (existing) existing.data = data; else S.posts.push({ path, data });
        S.posts.sort((a, b) => new Date(b.data.date) - new Date(a.data.date));
        S.dirty = false;
        toast('Gespeichert ✔ – in wenigen Minuten online.');
        if (!existing) go('news-edit/' + encodeURIComponent(data.slug));
      } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, true); }
      finally { loading(false); }
    };

    if (existing) $('#del').onclick = async () => {
      if (!confirm(`Beitrag „${p.title}“ wirklich löschen?`)) return;
      loading(true, 'Lösche …');
      try {
        await commit([{ path: existing.path, b64: null }], `News gelöscht: ${p.title}`);
        S.posts = S.posts.filter(x => x !== existing);
        toast('Beitrag gelöscht.');
        go('news');
      } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, true); }
      finally { loading(false); }
    };
  }

  /* ---------- Seiten-Liste ---------- */
  function pageGroup(p) {
    const s = p.data.slug;
    if (s === 'home') return '1 Startseite';
    if (/-wurf$/.test(s) || s === 'wurfplanung' || s === 'bisherige-wuerfe-bei-flat-xp') return '2 Würfe';
    if (S.site.galleries.includes(s)) return '4 Galerien';
    if (['impressum', 'datenschutz'].includes(s)) return '5 Rechtliches';
    return '3 Hunde & Sonstiges';
  }

  function pagesList() {
    const groups = {};
    S.pages.forEach(p => { (groups[pageGroup(p)] = groups[pageGroup(p)] || []).push(p); });
    view().innerHTML = `
      <div class="head">
        <div><h1>Seiten</h1><p>${S.pages.length} Seiten</p></div>
        <div class="actions"><button class="btn primary" id="newPage">＋ Neue Seite</button></div>
      </div>
      <input class="search" type="search" placeholder="Suchen …" id="q">
      <div class="list" id="list"></div>`;
    const render = q => {
      q = (q || '').toLowerCase();
      $('#list').innerHTML = Object.keys(groups).sort().map(g => {
        const rows = groups[g].filter(p => !q || (p.data.title + ' ' + p.data.slug).toLowerCase().includes(q));
        if (!rows.length) return '';
        return `<div class="group">${g.slice(2)}</div>` + rows.map(p => `
          <div class="row" data-slug="${esc(p.data.slug)}">
            <div class="t"><b>${esc(p.data.title)}</b><small>/${esc(p.data.slug)}/</small></div>
          </div>`).join('');
      }).join('');
      $$('#list .row[data-slug]').forEach(r => r.onclick = () => go('seite/' + encodeURIComponent(r.dataset.slug)));
    };
    render();
    $('#q').addEventListener('input', e => render(e.target.value));
    $('#newPage').onclick = newPageDialog;
  }

  function newPageDialog() {
    view().innerHTML = `
      <div class="head"><div><a href="#seiten">← Alle Seiten</a><h1>Neue Seite</h1></div></div>
      <div class="card">
        <label>Titel der Seite<input id="t" placeholder="z. B. I-Wurf"></label>
        <label>Adresse<input id="s" placeholder="i-wurf"><span class="hint">Wird zu flat-xp.at/<b id="sv">…</b>/</span></label>
        <label>Vorlage
          <select id="tpl">
            <option value="">Leere Seite</option>
            ${S.pages.map(p => `<option value="${esc(p.data.slug)}" ${p.data.slug === 'h-wurf' ? 'selected' : ''}>Kopie von: ${esc(p.data.title)} (/${esc(p.data.slug)}/)</option>`).join('')}
          </select>
        </label>
        <label class="check"><input type="checkbox" id="menu" checked> Im Menü unter „WÜRFE“ ganz oben eintragen</label>
        <label class="check"><input type="checkbox" id="gal"> In die Galerie-Übersicht aufnehmen</label>
        <p><button class="btn primary" id="create">Seite anlegen</button></p>
      </div>`;
    const t = $('#t'), s = $('#s');
    let manual = false;
    t.oninput = () => { if (!manual) s.value = slugify(t.value); $('#sv').textContent = s.value || '…'; };
    s.oninput = () => { manual = true; s.value = slugify(s.value); $('#sv').textContent = s.value || '…'; };
    $('#create').onclick = async () => {
      const title = t.value.trim(), slug = slugify(s.value || title);
      if (!title) return toast('Bitte einen Titel angeben.', true);
      const taken = new Set([...S.posts.map(x => x.data.slug), ...S.pages.map(x => x.data.slug), 'home', 'blog', 'galerien', 'kontakt', 'admin', 'uploads', 'css', 'js', 'fonts']);
      if (taken.has(slug)) return toast('Diese Adresse gibt es schon.', true);
      const tpl = S.pages.find(p => p.data.slug === $('#tpl').value);
      const data = {
        slug, title, seoTitle: `${title} - Flat-XP`, description: '',
        modified: new Date().toISOString().slice(0, 19),
        html: tpl ? tpl.data.html : `<div class="fx-section"><div class="fx-row"><div class="fx-col w-1-1"><h1 style="text-align: center">${esc(title)}</h1><hr class="fx-sep"><p>Text …</p></div></div></div>`,
      };
      const site = JSON.parse(JSON.stringify(S.site));
      if ($('#menu').checked) {
        const w = site.menu.find(m => m.children);
        if (w) { const idx = w.children[0] && w.children[0].url === '#' ? 1 : 0; w.children.splice(idx, 0, { title, url: `/${slug}/` }); }
      }
      if ($('#gal').checked) site.galleries.push(slug);
      const changes = [jsonFile(`content/pages/${slug}.json`, data)];
      if (JSON.stringify(site) !== JSON.stringify(S.site)) changes.push(jsonFile('content/site.json', site));
      loading(true, 'Lege Seite an …');
      try {
        await commit(changes, `Neue Seite: ${title}`);
        S.pages.push({ path: `content/pages/${slug}.json`, data });
        S.site = site;
        toast('Seite angelegt – jetzt Inhalt anpassen.');
        go('seite/' + encodeURIComponent(slug));
      } catch (e) { toast('Anlegen fehlgeschlagen: ' + e.message, true); }
      finally { loading(false); }
    };
  }

  /* ---------- Seite bearbeiten ---------- */
  function pageEdit(slug) {
    const page = S.pages.find(p => p.data.slug === slug);
    if (!page) return go('seiten');
    const p = page.data;
    const protectedPage = ['home', 'impressum', 'datenschutz'].includes(slug);
    view().innerHTML = `
      <div class="head">
        <div><a href="#seiten">← Alle Seiten</a><h1>${esc(p.title)}</h1></div>
        <div class="actions">
          <a class="btn" href="/${esc(slug)}/" target="_blank" rel="noopener">Online ansehen ↗</a>
          ${protectedPage ? '' : '<button class="btn danger" id="del">Löschen</button>'}
          <button class="btn primary" id="save">💾 Speichern &amp; veröffentlichen</button>
        </div>
      </div>
      <div class="card"><label style="margin:0">Name der Seite <span class="hint">(Überschrift in Menü und Übersicht)</span><input id="title" value="${esc(p.title)}"></label></div>
      <div id="seoBox"></div>
      ${slug === 'home' ? '<p class="hint">Hinweis: Der grau gestrichelte NEWS-Bereich wird automatisch mit den neuesten Beiträgen befüllt.</p>' : ''}
      <div id="ed"></div>`;
    const html = p.html.replace('<!--NEWS-->', '<div class="news-placeholder" contenteditable="false" style="border:2px dashed #aaa;padding:30px;text-align:center;color:#777">📰 Hier erscheinen automatisch die neuesten News</div>');
    const seoState = { seoTitle: p.seoTitle || '', description: p.description || '', keyword: p.keyword || '' };
    let editor;
    const seo = XP_SEO.panel($('#seoBox'), {
      get: () => ({ kind: 'page', title: $('#title').value.trim() || p.title, slug, html: editor ? editor.peek() : p.html, ...seoState }),
      set: f => { Object.assign(seoState, f); S.dirty = true; },
      all: seoItems,
    });
    editor = createEditor($('#ed'), html, { onChange: () => seo.update() });
    $('#title').addEventListener('input', () => { S.dirty = true; seo.update(); });

    $('#save').onclick = async () => {
      const raw = editor.getHtml();
      if (raw == null) return;
      let { html: out, files } = fromDisplay(raw);
      out = out.replace(/<div class="news-placeholder"[^>]*>[\s\S]*?<\/div>/, '<!--NEWS-->');
      const data = { ...p, ...seoState, title: $('#title').value.trim() || p.title, html: out, modified: new Date().toISOString().slice(0, 19) };
      loading(true, 'Speichere …');
      try {
        await commit([...files, jsonFile(page.path, data)], `Seite geändert: ${data.title}`);
        markSaved(files);
        page.data = data;
        S.dirty = false;
        toast('Gespeichert ✔ – in wenigen Minuten online.');
      } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, true); }
      finally { loading(false); }
    };

    const del = $('#del');
    if (del) del.onclick = async () => {
      if (!confirm(`Seite „${p.title}“ wirklich löschen? Sie wird auch aus Menü und Galerie-Übersicht entfernt.`)) return;
      const site = JSON.parse(JSON.stringify(S.site));
      site.menu.forEach(m => { if (m.children) m.children = m.children.filter(c => c.url !== `/${slug}/`); });
      site.menu = site.menu.filter(m => m.url !== `/${slug}/`);
      site.galleries = site.galleries.filter(g => g !== slug);
      const changes = [{ path: page.path, b64: null }];
      if (JSON.stringify(site) !== JSON.stringify(S.site)) changes.push(jsonFile('content/site.json', site));
      loading(true, 'Lösche …');
      try {
        await commit(changes, `Seite gelöscht: ${p.title}`);
        S.pages = S.pages.filter(x => x !== page);
        S.site = site;
        toast('Seite gelöscht.');
        go('seiten');
      } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, true); }
      finally { loading(false); }
    };
  }

  /* ---------- Bilder-Umzug nach Firebase Storage ---------- */
  const UPLOAD_RE = /\/uploads\/[^"'\s)<>]+?\.(?:jpe?g|png|gif)/gi;
  function localImages() {
    const set = new Set();
    for (const x of [...S.pages, ...S.posts]) {
      const t = (x.data.html || '') + ' ' + (x.data.image || '');
      for (const m of t.matchAll(UPLOAD_RE)) set.add(m[0]);
    }
    return [...set];
  }

  /** Bild laden, auf max. 1600 px verkleinern und als WebP kodieren (falls kleiner) */
  async function toWebp(blob) {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const out = await new Promise(r => c.toBlob(r, 'image/webp', 0.8));
      if (out && out.type === 'image/webp' && out.size < blob.size) return out;
    } catch (e) { /* dann Original */ }
    return null;
  }

  async function migrateImages(log, bar) {
    const list = localImages();
    const map = new Map();
    const failed = [];
    let done = 0;
    await pool(list, 4, async web => {
      const rel = decodeURIComponent(web).replace(/^\//, '');
      try {
        const r = await fetch(web);
        if (!r.ok) { failed.push(web + ' (fehlt)'); return; }
        const orig = await r.blob();
        const webp = await toWebp(orig);
        const path = webp ? rel.replace(/\.[^.]+$/, '.webp') : rel;
        const url = (await window.XP_FB.existing(path)) || await window.XP_FB.upload(path, webp || orig);
        map.set(web, url);
        try { const d = decodeURIComponent(web); if (d !== web) map.set(d, url); } catch (e) { /* egal */ }
        const enc = web.split('/').map(p => encodeURIComponent(decodeURIComponent(p))).join('/');
        if (enc !== web) map.set(enc, url);
      } catch (e) { failed.push(web + ' (' + e.message + ')'); }
      done++;
      bar.style.width = (done / list.length * 100) + '%';
      log(`Bilder: ${done} / ${list.length} …`);
    });
    // Inhalte umschreiben (längste Pfade zuerst, damit nichts halb ersetzt wird)
    const keys = [...map.keys()].sort((a, b) => b.length - a.length);
    const swap = t => { let o = t; for (const k of keys) if (o.includes(k)) o = o.split(k).join(map.get(k)); return o; };
    const changes = [];
    for (const x of [...S.pages, ...S.posts]) {
      const html = swap(x.data.html || '');
      const image = x.data.image ? swap(x.data.image) : x.data.image;
      if (html !== x.data.html || image !== x.data.image) {
        x.next = { ...x.data, html, image };
        changes.push(x);
      }
    }
    return { list, map, failed, changes };
  }

  /* ---------- SEO ---------- */
  const seoItems = () => [
    ...S.pages.map(x => ({ kind: 'page', ...x.data })),
    ...S.posts.map(x => ({ kind: 'post', ...x.data })),
  ];

  function seoOverview() {
    const all = seoItems();
    const rows = all.map(it => ({ it, r: XP_SEO.analyze(it, all) })).sort((a, b) => a.r.score - b.r.score);
    const avg = Math.round(rows.reduce((s, x) => s + x.r.score, 0) / (rows.length || 1));
    const count = g => rows.filter(x => x.r.grade === g).length;
    view().innerHTML = `
      <div class="head">
        <div><h1>SEO-Übersicht</h1><p>Alle Seiten und News mit Bewertung – die schwächsten zuerst. Anklicken zum Verbessern.</p></div>
      </div>
      <div class="seo-stats">
        <div class="card">${XP_SEO.badge({ score: avg, grade: avg >= 80 ? 'good' : avg >= 55 ? 'warn' : 'bad' }, true)}<span>Durchschnitt</span></div>
        <div class="card"><b class="good">${count('good')}</b><span>gut</span></div>
        <div class="card"><b class="warn">${count('warn')}</b><span>verbesserbar</span></div>
        <div class="card"><b class="bad">${count('bad')}</b><span>schwach</span></div>
      </div>
      <div class="seo-filter">
        <select id="sf"><option value="">Seiten und News</option><option value="page">Nur Seiten</option><option value="post">Nur News</option></select>
        <select id="sg"><option value="">Jede Bewertung</option><option value="bad">schwach</option><option value="warn">verbesserbar</option><option value="good">gut</option></select>
        <input class="search" type="search" placeholder="Suchen …" id="q">
      </div>
      <div class="list" id="list"></div>`;
    const render = () => {
      const f = $('#sf').value, g = $('#sg').value, q = $('#q').value.toLowerCase();
      $('#list').innerHTML = rows
        .filter(x => (!f || x.it.kind === f) && (!g || x.r.grade === g) && (!q || x.it.title.toLowerCase().includes(q)))
        .map(x => {
          const top = x.r.checks.filter(c => c.state !== 'good').slice(0, 2).map(c => esc(c.text)).join(' · ') || 'Alles in Ordnung';
          const href = x.it.kind === 'post' ? '#news-edit/' + encodeURIComponent(x.it.slug) : '#seite/' + encodeURIComponent(x.it.slug);
          return `<a class="row seo-row" href="${href}">${XP_SEO.badge(x.r)}
            <div class="t"><b>${esc(x.it.title)} <span class="tag">${x.it.kind === 'post' ? 'News' : 'Seite'}</span></b>
            <small>${esc(x.r.eff.title)}</small><small class="issues">${top}</small></div></a>`;
        }).join('') || '<div class="row">Nichts gefunden.</div>';
    };
    ['#sf', '#sg', '#q'].forEach(sel => $(sel).addEventListener('input', render));
    render();
  }

  /* ---------- Einstellungen ---------- */
  function settings() {
    const site = JSON.parse(JSON.stringify(S.site));
    const wurf = site.menu.find(m => m.children);
    view().innerHTML = `
      <div class="head">
        <div><h1>Einstellungen</h1><p>Kontaktdaten, Würfe-Menü, Galerie-Übersicht</p></div>
        <div class="actions"><button class="btn primary" id="save">💾 Speichern &amp; veröffentlichen</button></div>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Kontaktdaten <span class="hint">(Fußzeile &amp; Kontaktseite)</span></h2>
        <div class="grid2">
          <label>Name<input data-k="owner" value="${esc(site.owner)}"></label>
          <label>Adresse<input data-k="address" value="${esc(site.address)}"></label>
          <label>Telefon (Anzeige)<input data-k="phone" value="${esc(site.phone)}"></label>
          <label>Telefon (zum Anrufen, ohne Leerzeichen)<input data-k="phoneLink" value="${esc(site.phoneLink)}"></label>
          <label>E-Mail<input data-k="email" value="${esc(site.email)}"></label>
          <label>Anzahl News auf der Startseite<input data-k="homeNewsCount" type="number" min="1" max="30" value="${esc(site.homeNewsCount)}"></label>
        </div>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Menü „WÜRFE“</h2>
        <p class="hint">Reihenfolge wie im Menü. Adresse „#“ = nur Text, nicht anklickbar (z. B. „Aktuell keine Würfe geplant“).</p>
        <div id="wurf"></div>
        <button class="btn small" id="wAdd">＋ Eintrag</button>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Galerie-Übersicht</h2>
        <p class="hint">Welche Seiten unter „Galerien“ gezeigt werden, in dieser Reihenfolge.</p>
        <div id="gals"></div>
        <div class="menu-row"><select id="gNew"><option value="">Seite hinzufügen …</option>${S.pages.map(p => `<option value="${esc(p.data.slug)}">${esc(p.data.title)}</option>`).join('')}</select></div>
      </div>
      <div class="card" id="migCard">
        <h2 style="margin-top:0">Bilder nach Firebase Storage umziehen</h2>
        <p class="hint">Lädt alle Bilder aus News und Seiten (verkleinert, als WebP) in den Bucket und stellt die Inhalte auf die neuen Adressen um – in einem einzigen Speichervorgang.
          Logo, Kopfbild und Hintergründe bleiben auf der Website. Bereits umgezogene Bilder werden übersprungen, der Vorgang kann also jederzeit wiederholt werden.</p>
        <p id="migInfo"></p>
        <button class="btn" id="migGo">☁️ Umzug starten</button>
        <div class="mig-bar" hidden><i id="migBar"></i></div>
        <p class="hint" id="migLog"></p>
      </div>`;

    $$('[data-k]').forEach(i => i.addEventListener('input', () => {
      site[i.dataset.k] = i.type === 'number' ? Math.max(1, parseInt(i.value, 10) || 6) : i.value;
      S.dirty = true;
    }));

    const migLeft = localImages().length;
    $('#migInfo').innerHTML = migLeft ? `<b>${migLeft}</b> Bilder liegen noch auf der Website.` : '✅ Alle Bilder aus News und Seiten liegen in Firebase Storage.';
    if (!migLeft) $('#migGo').hidden = true;
    $('#migGo').onclick = async () => {
      if (S.dirty && !confirm('Es gibt ungespeicherte Änderungen in den Einstellungen. Trotzdem fortfahren?')) return;
      if (!confirm(`${migLeft} Bilder werden nach Firebase Storage hochgeladen und alle Seiten und News umgestellt. Das dauert einige Minuten – das Fenster bitte offen lassen. Starten?`)) return;
      const btn = $('#migGo'); btn.disabled = true;
      const log = t => { $('#migLog').textContent = t; };
      $('.mig-bar').hidden = false;
      S.dirty = true; // Warnung beim Schließen des Fensters
      try {
        const r = await migrateImages(log, $('#migBar'));
        if (!r.changes.length) { log('Keine Inhalte zu ändern.'); return; }
        log(`Speichere ${r.changes.length} Seiten/News …`);
        await commit(r.changes.map(x => jsonFile(x.path, x.next)), `Bilder nach Firebase Storage umgezogen (${r.map.size} Adressen)`);
        r.changes.forEach(x => { x.data = x.next; delete x.next; });
        S.dirty = false;
        log(`✅ Fertig: ${r.list.length - r.failed.length} Bilder umgezogen, ${r.changes.length} Seiten/News umgestellt.` + (r.failed.length ? ` Nicht möglich (${r.failed.length}): ${r.failed.slice(0, 8).join(', ')}${r.failed.length > 8 ? ' …' : ''}` : ''));
        toast('Bilder-Umzug gespeichert ✔ – in wenigen Minuten online.');
        $('#migInfo').textContent = '';
      } catch (e) {
        S.dirty = false;
        log('❌ Abgebrochen: ' + e.message + ' – einfach erneut starten, bereits hochgeladene Bilder werden übersprungen.');
      } finally { btn.disabled = false; }
    };

    const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; S.dirty = true; };
    const ops = (i) => `<div class="ops"><button class="btn small" data-up="${i}" title="nach oben">↑</button><button class="btn small" data-down="${i}" title="nach unten">↓</button><button class="btn small danger" data-rm="${i}" title="entfernen">✕</button></div>`;

    function renderWurf() {
      $('#wurf').innerHTML = wurf.children.map((c, i) => `
        <div class="menu-row">
          <input data-i="${i}" data-f="title" value="${esc(c.title)}" placeholder="Text">
          <select data-i="${i}" data-f="url">
            <option value="#" ${c.url === '#' ? 'selected' : ''}># (nur Text)</option>
            ${S.pages.map(p => `<option value="/${esc(p.data.slug)}/" ${c.url === '/' + p.data.slug + '/' ? 'selected' : ''}>${esc(p.data.title)} (/${esc(p.data.slug)}/)</option>`).join('')}
          </select>
          ${ops(i)}
        </div>`).join('');
      $$('#wurf [data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { wurf.children[el.dataset.i][el.dataset.f] = el.value; S.dirty = true; }));
      $$('#wurf [data-up]').forEach(b => b.onclick = () => { move(wurf.children, +b.dataset.up, -1); renderWurf(); });
      $$('#wurf [data-down]').forEach(b => b.onclick = () => { move(wurf.children, +b.dataset.down, 1); renderWurf(); });
      $$('#wurf [data-rm]').forEach(b => b.onclick = () => { wurf.children.splice(+b.dataset.rm, 1); S.dirty = true; renderWurf(); });
    }
    function renderGals() {
      $('#gals').innerHTML = site.galleries.map((g, i) => {
        const p = S.pages.find(x => x.data.slug === g);
        return `<div class="menu-row"><span>${esc(p ? p.data.title : g)}</span><span class="hint">/${esc(g)}/</span>${ops(i)}</div>`;
      }).join('');
      $$('#gals [data-up]').forEach(b => b.onclick = () => { move(site.galleries, +b.dataset.up, -1); renderGals(); });
      $$('#gals [data-down]').forEach(b => b.onclick = () => { move(site.galleries, +b.dataset.down, 1); renderGals(); });
      $$('#gals [data-rm]').forEach(b => b.onclick = () => { site.galleries.splice(+b.dataset.rm, 1); S.dirty = true; renderGals(); });
    }
    if (wurf) renderWurf();
    renderGals();
    $('#wAdd').onclick = () => { wurf.children.push({ title: 'Neuer Eintrag', url: '#' }); S.dirty = true; renderWurf(); };
    $('#gNew').onchange = e => {
      if (e.target.value && !site.galleries.includes(e.target.value)) { site.galleries.push(e.target.value); S.dirty = true; renderGals(); }
      e.target.value = '';
    };

    $('#save').onclick = async () => {
      loading(true, 'Speichere …');
      try {
        await commit([jsonFile('content/site.json', site)], 'Einstellungen geändert');
        S.site = site;
        S.dirty = false;
        toast('Gespeichert ✔ – in wenigen Minuten online.');
      } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, true); }
      finally { loading(false); }
    };
  }

  /* =========================================================
     Start / Anmeldung
     ========================================================= */
  async function start() {
    $('#login').hidden = true;
    try {
      await loadAll();
    } catch (e) {
      loading(false);
      if (e.status === 401 || e.status === 403) return showLogin(e.message || 'Kein Zugriff.');
      return showLogin('Fehler beim Laden: ' + e.message);
    }
    $('#app').hidden = false;
    deployStatus();
    route();
  }

  function showLogin(err) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginErr').textContent = err || '';
    loading(false);
  }

  const FB_ERR = {
    'auth/invalid-credential': 'E-Mail oder Passwort falsch.',
    'auth/invalid-email': 'Die E-Mail-Adresse ist ungültig.',
    'auth/user-disabled': 'Dieses Konto ist gesperrt.',
    'auth/too-many-requests': 'Zu viele Versuche – bitte später erneut probieren.',
    'auth/network-request-failed': 'Keine Verbindung zu Firebase.',
  };

  function init() {
    if (!window.XP_FB.ready) return showLogin('Firebase ist noch nicht eingerichtet (public/admin/firebase-config.js).');
    let started = false;
    window.XP_FB.onUser(u => {
      if (u && !started) { started = true; start(); }
      else if (!u) { started = false; showLogin(); }
    });
  }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    loading(true, 'Melde an …');
    try {
      await window.XP_FB.login($('#email').value.trim(), $('#password').value, $('#remember').checked);
      $('#password').value = '';
    } catch (err) {
      loading(false);
      $('#loginErr').textContent = FB_ERR[err.code] || 'Anmeldung fehlgeschlagen: ' + err.message;
    }
  });
  $('#forgot').addEventListener('click', async () => {
    const email = $('#email').value.trim();
    if (!email) { $('#loginErr').textContent = 'Bitte zuerst die E-Mail-Adresse eingeben.'; return; }
    try { await window.XP_FB.resetPassword(email); $('#loginErr').textContent = 'Falls das Konto existiert, wurde eine E-Mail zum Zurücksetzen verschickt.'; }
    catch (err) { $('#loginErr').textContent = FB_ERR[err.code] || err.message; }
  });
  $('#logout').addEventListener('click', () => { if (confirmLeave()) window.XP_FB.logout(); });

  if (window.XP_FB) init(); else window.addEventListener('xp-fb-ready', init, { once: true });
})();
