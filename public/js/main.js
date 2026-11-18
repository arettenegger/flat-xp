/* Flat-XP – kleine Helfer: Menü, Slider, Lightbox, Nach-oben-Button */
(function () {
  'use strict';

  /* ---- Menü (sticky + mobil) ---- */
  var nav = document.querySelector('.main-nav');
  if (nav) {
    var toggle = nav.querySelector('.nav-toggle');
    if (toggle) toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
    nav.querySelectorAll('.has-sub > a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        a.parentNode.classList.toggle('open');
      });
    });
    var navTop = nav.offsetTop;
    var onScroll = function () {
      nav.classList.toggle('stuck', window.scrollY > navTop + 10);
      var t = document.querySelector('.to-top');
      if (t) t.classList.toggle('show', window.scrollY > 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  var top = document.querySelector('.to-top');
  if (top) top.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  /* ---- Einblenden beim Scrollen ---- */
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var targets = document.querySelectorAll('.fx-col, .tl-item, .post-card, .gallery-card, .fx-gallery figure');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    targets.forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) return; // schon sichtbar → nicht verstecken
      el.classList.add('reveal');
      el.style.transitionDelay = (i % 4) * 70 + 'ms';
      io.observe(el);
    });
  }

  /* ---- Slider ---- */
  document.querySelectorAll('.fx-slider').forEach(function (slider) {
    var slides = slider.querySelectorAll('.fx-slide');
    var dots = slider.querySelector('.fx-dots');
    if (!slides.length) return;
    var i = 0, timer;
    slides.forEach(function (_, n) {
      var b = document.createElement('button');
      b.setAttribute('aria-label', 'Bild ' + (n + 1));
      b.addEventListener('click', function () { show(n); restart(); });
      dots.appendChild(b);
    });
    function show(n) {
      slides[i].classList.remove('active'); dots.children[i].classList.remove('active');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('active'); dots.children[i].classList.add('active');
    }
    function restart() { clearInterval(timer); timer = setInterval(function () { show(i + 1); }, 5000); }
    slides[0].classList.add('active'); dots.children[0].classList.add('active');
    restart();
  });

  /* ---- Lightbox ---- */
  var links = Array.prototype.slice.call(document.querySelectorAll('a.lb'));
  if (!links.length) return;
  var box, img, count, idx = 0;
  function build() {
    box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<img alt=""><button class="lb-close" aria-label="Schließen">&times;</button>' +
      '<button class="lb-prev" aria-label="Zurück">&#8249;</button><button class="lb-next" aria-label="Weiter">&#8250;</button><span class="lb-count"></span>';
    img = box.querySelector('img'); count = box.querySelector('.lb-count');
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    box.querySelector('.lb-close').onclick = close;
    box.querySelector('.lb-prev').onclick = function () { open(idx - 1); };
    box.querySelector('.lb-next').onclick = function () { open(idx + 1); };
    document.body.appendChild(box);
  }
  function open(n) {
    if (!box) build();
    idx = (n + links.length) % links.length;
    img.src = links[idx].getAttribute('href');
    var inner = links[idx].querySelector('img');
    img.alt = inner ? inner.alt : '';
    count.textContent = (idx + 1) + ' / ' + links.length;
    box.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function close() { box.style.display = 'none'; document.body.style.overflow = ''; }
  links.forEach(function (a, n) {
    a.addEventListener('click', function (e) { e.preventDefault(); open(n); });
  });
  document.addEventListener('keydown', function (e) {
    if (!box || box.style.display === 'none') return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') open(idx - 1);
    if (e.key === 'ArrowRight') open(idx + 1);
  });
})();
