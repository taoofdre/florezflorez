(() => {
  // ---- DOM refs ----
  const home = document.getElementById('home');
  const header = document.getElementById('header');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox.querySelector('.lightbox-img');
  const lightboxCounter = lightbox.querySelector('.lightbox-counter');
  const panels = document.querySelectorAll('.panel');
  const headerLinks = document.querySelectorAll('.header-link');
  const sections = document.querySelectorAll('.section');

  let activeSection = null;

  // ---- Lightbox state ----
  let lbImages = [];
  let lbIndex = 0;

  // ---- Helpers ----

  function text(el, str) { el.textContent = str; }

  function escapeAttr(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ---- Data fetching ----

  async function fetchJSON(path) {
    const res = await fetch(path + '?t=' + Date.now());
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  // ---- Carousel builder ----

  function buildCarousel(images) {
    const carousel = document.createElement('div');
    carousel.className = 'carousel';

    const track = document.createElement('div');
    track.className = 'carousel-track';

    images.forEach((img, i) => {
      const slide = document.createElement('div');
      slide.className = 'carousel-slide' + (i === 0 ? ' active' : '');
      const imgEl = document.createElement('img');
      imgEl.src = img.src;
      imgEl.alt = img.alt;
      imgEl.className = 'art-image';
      imgEl.loading = 'lazy';
      slide.appendChild(imgEl);
      track.appendChild(slide);

      // Click to open lightbox at this slide
      slide.addEventListener('click', () => {
        openLightbox(images, i);
      });
    });

    carousel.appendChild(track);

    if (images.length > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'carousel-prev';
      prevBtn.innerHTML = '&#8249;';
      prevBtn.setAttribute('aria-label', 'Previous image');

      const nextBtn = document.createElement('button');
      nextBtn.className = 'carousel-next';
      nextBtn.innerHTML = '&#8250;';
      nextBtn.setAttribute('aria-label', 'Next image');

      const dots = document.createElement('div');
      dots.className = 'carousel-dots';
      images.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Image ${i + 1}`);
        dots.appendChild(dot);
      });

      carousel.appendChild(prevBtn);
      carousel.appendChild(nextBtn);
      carousel.appendChild(dots);

      let current = 0;

      function goTo(index) {
        const slides = track.querySelectorAll('.carousel-slide');
        const dotEls = dots.querySelectorAll('.carousel-dot');
        slides[current].classList.remove('active');
        dotEls[current].classList.remove('active');
        current = (index + images.length) % images.length;
        slides[current].classList.add('active');
        dotEls[current].classList.add('active');
      }

      prevBtn.addEventListener('click', (e) => { e.stopPropagation(); goTo(current - 1); });
      nextBtn.addEventListener('click', (e) => { e.stopPropagation(); goTo(current + 1); });
      dots.querySelectorAll('.carousel-dot').forEach((dot, i) => {
        dot.addEventListener('click', (e) => { e.stopPropagation(); goTo(i); });
      });

      // Touch/swipe support
      let touchStartX = 0;
      let touchEndX = 0;
      carousel.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
      carousel.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 50) {
          if (diff > 0) goTo(current + 1);
          else goTo(current - 1);
        }
      });
    }

    return carousel;
  }

  // ---- Render: Homepage backgrounds ----

  async function renderHomepage() {
    try {
      const data = await fetchJSON('content/homepage.json');
      const map = {
        art: data.art_background,
        jewelry: data.jewelry_background,
        consulting: data.consulting_background
      };
      for (const [key, url] of Object.entries(map)) {
        if (url) {
          document.getElementById('panel-bg-' + key).style.backgroundImage = `url('${escapeAttr(url)}')`;
        }
      }
    } catch (e) {
      // Homepage backgrounds are optional
    }
  }

  // ---- Render: Art ----

  async function renderArt() {
    try {
      const data = await fetchJSON('content/art.json');
      const nav = document.getElementById('art-nav');
      const content = document.getElementById('art-content');

      data.pieces.forEach(piece => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + piece.id;
        a.className = 'art-nav-link';
        text(a, piece.title);
        li.appendChild(a);
        nav.appendChild(li);

        const article = document.createElement('article');
        article.id = piece.id;
        article.className = 'art-piece';

        article.appendChild(buildCarousel(piece.images));

        const desc = document.createElement('p');
        desc.className = 'art-description';
        text(desc, piece.description);
        article.appendChild(desc);

        content.appendChild(article);
      });

      setupScrollTracking(document.getElementById('section-art'));
    } catch (e) {
      console.error('Failed to load art content:', e);
    }
  }

  // ---- Render: Jewelry ----

  async function renderJewelry() {
    try {
      const data = await fetchJSON('content/jewelry.json');
      const nav = document.getElementById('jewelry-nav');
      const content = document.getElementById('jewelry-content');

      data.pieces.forEach(piece => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + piece.id;
        a.className = 'art-nav-link';
        text(a, piece.title);
        li.appendChild(a);
        nav.appendChild(li);

        const article = document.createElement('article');
        article.id = piece.id;
        article.className = 'art-piece';

        article.appendChild(buildCarousel(piece.images));

        const desc = document.createElement('p');
        desc.className = 'art-description';
        text(desc, piece.description);
        article.appendChild(desc);

        const buyRow = document.createElement('div');
        buyRow.className = 'buy-row';

        const price = document.createElement('span');
        price.className = 'buy-price';
        text(price, piece.price_display);
        buyRow.appendChild(price);

        if (piece.stripe_price_id) {
          const btn = document.createElement('button');
          btn.className = 'buy-btn';
          text(btn, 'Purchase');
          btn.addEventListener('click', () => stripeCheckout(piece.stripe_price_id));
          buyRow.appendChild(btn);
        }

        article.appendChild(buyRow);
        content.appendChild(article);
      });

      setupScrollTracking(document.getElementById('section-jewelry'));
    } catch (e) {
      console.error('Failed to load jewelry content:', e);
    }
  }

  // ---- Render: Consulting ----

  async function renderConsulting() {
    try {
      const data = await fetchJSON('content/consulting.json');
      const textEl = document.getElementById('consulting-text');
      const bgEl = document.getElementById('consulting-bg');

      const h2 = document.createElement('h2');
      text(h2, data.heading);
      textEl.appendChild(h2);

      const p = document.createElement('p');
      text(p, data.message);
      textEl.appendChild(p);

      if (data.background_image) {
        bgEl.style.backgroundImage = `url('${escapeAttr(data.background_image)}')`;
      }
    } catch (e) {
      console.error('Failed to load consulting content:', e);
    }
  }

  // ---- Stripe Checkout ----

  function stripeCheckout(priceId) {
    const checkoutUrl = `/api/checkout?price_id=${encodeURIComponent(priceId)}`;
    window.location.href = checkoutUrl;
  }

  // ---- Navigation ----

  function openSection(name) {
    home.classList.add('hidden');
    setTimeout(() => { home.style.display = 'none'; }, 500);
    header.classList.add('visible');

    sections.forEach(s => s.classList.remove('active'));
    const target = document.getElementById('section-' + name);
    if (target) target.classList.add('active');

    headerLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.section === name);
    });

    activeSection = name;
    window.scrollTo(0, 0);
  }

  function goHome() {
    home.style.display = 'flex';
    requestAnimationFrame(() => { home.classList.remove('hidden'); });
    header.classList.remove('visible');
    sections.forEach(s => s.classList.remove('active'));
    headerLinks.forEach(l => l.classList.remove('active'));
    activeSection = null;
  }

  panels.forEach(panel => {
    panel.addEventListener('click', () => openSection(panel.dataset.section));
  });

  headerLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const name = link.dataset.section;
      if (name === activeSection) {
        goHome();
      } else {
        sections.forEach(s => s.classList.remove('active'));
        const target = document.getElementById('section-' + name);
        if (target) target.classList.add('active');
        headerLinks.forEach(l => l.classList.toggle('active', l.dataset.section === name));
        activeSection = name;
        window.scrollTo(0, 0);
      }
    });
  });

  // ---- Sidebar scroll tracking ----

  function setupScrollTracking(sectionEl) {
    const pieces = sectionEl.querySelectorAll('.art-piece');
    const navLinks = sectionEl.querySelectorAll('.art-nav-link');
    if (!pieces.length || !navLinks.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px' });

    pieces.forEach(piece => observer.observe(piece));
  }

  // ---- Lightbox ----

  function openLightbox(images, index) {
    lbImages = images;
    lbIndex = index;
    showLightboxImage();
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function showLightboxImage() {
    lightboxImg.src = lbImages[lbIndex].src;
    lightboxImg.alt = lbImages[lbIndex].alt;
    text(lightboxCounter, (lbIndex + 1) + ' / ' + lbImages.length);

    // Show/hide nav buttons
    const prevBtn = lightbox.querySelector('.lightbox-prev');
    const nextBtn = lightbox.querySelector('.lightbox-next');
    const showNav = lbImages.length > 1;
    prevBtn.style.display = showNav ? '' : 'none';
    nextBtn.style.display = showNav ? '' : 'none';
    lightboxCounter.style.display = showNav ? '' : 'none';
  }

  function lightboxPrev() {
    lbIndex = (lbIndex - 1 + lbImages.length) % lbImages.length;
    showLightboxImage();
  }

  function lightboxNext() {
    lbIndex = (lbIndex + 1) % lbImages.length;
    showLightboxImage();
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  lightbox.querySelector('.lightbox-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });

  lightbox.querySelector('.lightbox-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    lightboxPrev();
  });

  lightbox.querySelector('.lightbox-next').addEventListener('click', (e) => {
    e.stopPropagation();
    lightboxNext();
  });

  // Click background to close (but not on the image or buttons)
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  // Keyboard nav
  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxPrev();
    if (e.key === 'ArrowRight') lightboxNext();
  });

  // Lightbox swipe
  let lbTouchStartX = 0;
  lightbox.addEventListener('touchstart', (e) => { lbTouchStartX = e.changedTouches[0].screenX; }, { passive: true });
  lightbox.addEventListener('touchend', (e) => {
    const diff = lbTouchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) lightboxNext();
      else lightboxPrev();
    }
  });

  // ---- Init ----

  renderHomepage();
  renderArt();
  renderJewelry();
  renderConsulting();
})();
