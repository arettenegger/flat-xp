/* =========================================================
   Flat-XP Verwaltung – SEO-Prüfung
   Google-Vorschau, Prüfliste und Punktzahl für Seiten und News.
   Stellt window.XP_SEO bereit (wird von admin.js verwendet).
   ========================================================= */
(function () {
  'use strict';

  const SITE = 'flat-xp.at';
  const TITLE_PX = 580;   // so breit zeigt Google den Titel ungefähr an
  const DESC_MIN = 110, DESC_MAX = 160;

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const plain = html => String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/[\s,;:–-]+\S*$/, '') + ' …');
  const norm = s => String(s || '').toLowerCase().normalize('NFC');
  const slugish = s => norm(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-');

  let ctx;
  function px(text, font) {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  const titlePx = t => px(t, '20px Arial');

  /** Was tatsächlich bei Google landet (gleiche Regeln wie src/render.js) */
  function effective(item) {
    const text = plain(item.html);
    if (item.kind === 'post') {
      return {
        title: item.seoTitle || `${item.title} – News | Flat-XP`,
        description: item.description || cut(item.excerpt || text, 158),
      };
    }
    return { title: item.seoTitle || `${item.title} | Flat-XP`, description: item.description || cut(text, 158) };
  }

  /**
   * item: { kind: 'page'|'post', title, seoTitle, description, keyword, slug, html, excerpt }
   * all:  Liste aller Einträge (für Doppelte), optional
   */
  function analyze(item, all) {
    const checks = [];
    const add = (state, text, weight = 1) => checks.push({ state, text, weight });
    const eff = effective(item);
    const html = String(item.html || '');
    const text = plain(html);
    const words = text ? text.split(/\s+/).length : 0;
    const isGallery = (html.match(/<figure>/g) || []).length >= 6;

    // Titel
    const tw = titlePx(eff.title);
    if (!item.seoTitle) add('warn', 'Kein eigener Google-Titel – es wird automatisch einer erzeugt.', 0.5);
    if (tw > TITLE_PX) add('bad', `Der Titel ist zu lang (${eff.title.length} Zeichen) und wird bei Google abgeschnitten.`);
    else if (eff.title.length < 30) add('warn', `Der Titel ist recht kurz (${eff.title.length} Zeichen). 40–60 Zeichen nutzen den Platz besser.`);
    else add('good', `Titellänge passt (${eff.title.length} Zeichen).`);

    // Beschreibung
    const dl = (item.description || '').length;
    if (!item.description) add(item.kind === 'post' ? 'warn' : 'bad', 'Keine eigene Beschreibung – Google nimmt dann den Textanfang.');
    else if (dl < DESC_MIN) add('warn', `Die Beschreibung ist kurz (${dl} Zeichen). Ideal sind ${DESC_MIN}–${DESC_MAX}.`);
    else if (dl > DESC_MAX) add('warn', `Die Beschreibung ist zu lang (${dl} Zeichen) und wird abgeschnitten.`);
    else add('good', `Beschreibungslänge passt (${dl} Zeichen).`);

    // Fokus-Keyword
    const kw = norm(item.keyword).trim();
    if (!kw) add('warn', 'Kein Fokus-Keyword gesetzt – z. B. „Flat Coated Retriever Welpen“.', 0.5);
    else {
      const inT = norm(eff.title).includes(kw);
      add(inT ? 'good' : 'bad', inT ? 'Fokus-Keyword steht im Titel.' : 'Fokus-Keyword fehlt im Titel.');
      const inD = norm(item.description).includes(kw);
      add(inD ? 'good' : 'warn', inD ? 'Fokus-Keyword steht in der Beschreibung.' : 'Fokus-Keyword fehlt in der Beschreibung.');
      const firstP = plain((html.match(/<p[^>]*>[\s\S]*?<\/p>/i) || [''])[0]) || text.slice(0, 300);
      const inP = norm(firstP).includes(kw);
      add(inP ? 'good' : 'warn', inP ? 'Fokus-Keyword steht am Textanfang.' : 'Fokus-Keyword kommt im ersten Absatz nicht vor.');
      const inH = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].some(m => norm(plain(m[1])).includes(kw));
      add(inH ? 'good' : 'warn', inH ? 'Fokus-Keyword steht in einer Überschrift.' : 'Fokus-Keyword in keiner Zwischenüberschrift.', 0.5);
      const inUrl = item.slug && slugish(item.slug).includes(slugish(kw).replace(/^-|-$/g, ''));
      if (item.kind === 'page') add(inUrl ? 'good' : 'warn', inUrl ? 'Fokus-Keyword steht in der Adresse.' : 'Fokus-Keyword nicht in der Adresse (bei bestehenden Seiten nicht ändern).', 0.3);
      const n = text ? (norm(text).split(kw).length - 1) : 0;
      const dens = words ? (n * kw.split(/\s+/).length / words) * 100 : 0;
      if (n === 0) add('bad', 'Fokus-Keyword kommt im Text gar nicht vor.');
      else if (dens > 3.5) add('warn', `Fokus-Keyword sehr häufig (${n}×, ${dens.toFixed(1)} %) – wirkt schnell unnatürlich.`);
      else add('good', `Fokus-Keyword kommt ${n}× im Text vor.`);
    }

    // Textlänge
    if (isGallery) add('good', 'Fotogalerie – wenig Text ist hier in Ordnung.', 0.3);
    else if (item.kind === 'post') {
      if (words < 25) add('bad', `Sehr kurzer Beitrag (${words} Wörter) – ein, zwei Sätze mehr helfen Google und Lesern.`, 0.6);
      else if (words < 100) add('warn', `Kurzer Beitrag (${words} Wörter).`, 0.4);
      else add('good', `Genug Text (${words} Wörter).`, 0.6);
    }
    else if (words < 80) add('bad', `Sehr wenig Text (${words} Wörter). Google bevorzugt Seiten mit Inhalt.`);
    else if (words < 250) add('warn', `Eher wenig Text (${words} Wörter). Ab etwa 300 Wörtern wird es besser.`, 0.7);
    else add('good', `Genug Text (${words} Wörter).`, 0.7);

    // Überschriften
    const hCount = (html.match(/<h[2-4][\s>]/gi) || []).length;
    if (!isGallery && words > 250 && !hCount) add('warn', 'Keine Zwischenüberschriften – längere Texte lieber mit H2/H3 gliedern.', 0.5);
    else if (hCount) add('good', `${hCount} Zwischenüberschrift(en) gliedern den Text.`, 0.3);

    // Bilder
    const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
    const noAlt = imgs.filter(t => !/\balt="[^"]+"/i.test(t)).length;
    if (imgs.length) {
      if (noAlt) add(noAlt > imgs.length / 2 ? 'bad' : 'warn', `${noAlt} von ${imgs.length} Bildern ohne Beschreibung (Alt-Text). Bild anklicken → „Beschreibung“.`, 0.7);
      else add('good', `Alle ${imgs.length} Bilder haben eine Beschreibung.`, 0.5);
    } else if (!isGallery) add('warn', 'Kein Bild – Seiten mit Fotos werden öfter geteilt und angeklickt.', 0.3);

    // Links
    const internal = (html.match(/href="\/[^"]*"/g) || []).length;
    if (!internal && words > 150) add('warn', 'Keine Links auf andere Seiten von flat-xp.at (z. B. zu Würfen oder Hündinnen).', 0.3);

    // Doppelte
    if (all && all.length) {
      const others = all.filter(o => !(o.kind === item.kind && o.slug === item.slug));
      const dupT = others.find(o => norm(effective(o).title) === norm(eff.title));
      if (dupT) add('bad', `Gleicher Google-Titel wie „${dupT.title}“.`);
      const dupD = item.description && others.find(o => o.description && norm(o.description) === norm(item.description));
      if (dupD) add('warn', `Gleiche Beschreibung wie „${dupD.title}“.`);
    }

    const total = checks.reduce((s, c) => s + c.weight, 0) || 1;
    const got = checks.reduce((s, c) => s + c.weight * (c.state === 'good' ? 1 : c.state === 'warn' ? 0.5 : 0), 0);
    const score = Math.round((got / total) * 100);
    const order = { bad: 0, warn: 1, good: 2 };
    checks.sort((a, b) => order[a.state] - order[b.state]);
    return { score, grade: score >= 80 ? 'good' : score >= 55 ? 'warn' : 'bad', checks, eff, words, titleOver: tw > TITLE_PX };
  }

  /** Google-Snippet-Vorschau */
  function preview(item, eff) {
    let t = eff.title;
    while (titlePx(t + ' …') > TITLE_PX && t.length > 10) t = t.slice(0, -1);
    if (t !== eff.title) t = t.replace(/\s+\S*$/, '') + ' …';
    const path = item.slug && item.slug !== 'home' ? ' › ' + esc(item.slug) : '';
    const date = item.kind === 'post' && item.date ? new Date(item.date).toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: 'numeric' }) + ' — ' : '';
    return `
      <div class="serp">
        <div class="serp-site"><span class="serp-ico">F</span><div><b>Flat-XP</b><small>https://${SITE}${path}</small></div></div>
        <div class="serp-title">${esc(t)}</div>
        <div class="serp-desc">${date ? `<span>${esc(date)}</span>` : ''}${esc(cut(eff.description, DESC_MAX))}</div>
      </div>`;
  }

  /** Bewertungs-Kreis */
  const badge = (r, big) => `<span class="seo-badge ${r.grade}${big ? ' big' : ''}" title="SEO-Punkte">${r.score}</span>`;

  /**
   * SEO-Box in ein Element rendern.
   * get(): liefert das aktuelle item; set(fields): schreibt seoTitle/description/keyword zurück
   */
  function panel(host, { get, set, all }) {
    const it = get();
    host.innerHTML = `
      <details class="card seo-panel" open>
        <summary><b>🔍 SEO – so erscheint die Seite bei Google</b> <span id="seoBadge"></span></summary>
        <div class="seo-grid">
          <div>
            <div id="seoPrev"></div>
            <label>Titel bei Google <span class="hint" id="seoTitleInfo"></span>
              <input id="seoTitle" value="${esc(it.seoTitle || '')}" placeholder="${esc(effective({ ...it, seoTitle: '' }).title)}">
              <span class="meter"><i id="seoTitleBar"></i></span>
            </label>
            <label>Beschreibung bei Google <span class="hint" id="seoDescInfo"></span>
              <textarea id="seoDesc" rows="3" placeholder="Kurz und einladend beschreiben, worum es geht – das ist der graue Text bei Google.">${esc(it.description || '')}</textarea>
              <span class="meter"><i id="seoDescBar"></i></span>
            </label>
            <label>Fokus-Keyword <span class="hint">(der Suchbegriff, für den diese Seite gefunden werden soll)</span>
              <input id="seoKw" value="${esc(it.keyword || '')}" placeholder="z. B. Flat Coated Retriever Welpen">
            </label>
            <button type="button" class="btn small" id="seoAuto">✨ Beschreibung aus dem Text vorschlagen</button>
          </div>
          <div>
            <h3 class="seo-h">Prüfliste</h3>
            <ul class="seo-checks" id="seoChecks"></ul>
          </div>
        </div>
      </details>`;

    const q = s => host.querySelector(s);
    const update = () => {
      const item = get();
      const r = analyze(item, all && all());
      q('#seoBadge').innerHTML = badge(r);
      q('#seoPrev').innerHTML = preview(item, r.eff);
      const tl = r.eff.title.length, tp = Math.round(titlePx(r.eff.title));
      q('#seoTitleInfo').textContent = `${tl} Zeichen`;
      const tb = q('#seoTitleBar'); tb.style.width = Math.min(100, tp / TITLE_PX * 100) + '%';
      tb.className = r.titleOver ? 'bad' : tl < 30 ? 'warn' : 'good';
      const dl = (item.description || '').length;
      q('#seoDescInfo').textContent = `${dl} / ${DESC_MAX} Zeichen`;
      const db = q('#seoDescBar'); db.style.width = Math.min(100, dl / DESC_MAX * 100) + '%';
      db.className = !dl ? 'bad' : dl < DESC_MIN || dl > DESC_MAX ? 'warn' : 'good';
      q('#seoChecks').innerHTML = r.checks.map(c => `<li class="${c.state}">${esc(c.text)}</li>`).join('');
    };
    const sync = () => { set({ seoTitle: q('#seoTitle').value.trim(), description: q('#seoDesc').value.trim(), keyword: q('#seoKw').value.trim() }); update(); };
    ['#seoTitle', '#seoDesc', '#seoKw'].forEach(s => q(s).addEventListener('input', sync));
    q('#seoAuto').onclick = () => {
      const item = get();
      const text = plain(item.html).replace(/^\S+\s*–\s*/, '');
      q('#seoDesc').value = cut(text, 155);
      sync();
      q('#seoDesc').focus();
    };
    update();
    return { update };
  }

  window.XP_SEO = { analyze, effective, preview, panel, badge, plain };
})();
