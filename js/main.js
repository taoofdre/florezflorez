(() => {
  // ---- DOM refs ----
  const home = document.getElementById('home');
  const header = document.getElementById('header');
  const homeLogo = document.getElementById('home-logo');
  const headerLogo = document.getElementById('header-logo');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox.querySelector('.lightbox-img');
  const lightboxCounter = lightbox.querySelector('.lightbox-counter');
  const panels = document.querySelectorAll('.panel');
  const headerLinks = document.querySelectorAll('.header-link');
  const headerLinksWrap = document.getElementById('header-links');
  const hamburger = document.getElementById('hamburger');
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

      // Logo
      if (data.logo) {
        homeLogo.src = data.logo;
        headerLogo.src = data.logo;
      }

      // Panel backgrounds
      const map = {
        art: data.art_background,
        necklaces: data.necklaces_background,
        rings: data.rings_background,
        consulting: data.consulting_background
      };
      for (const [key, url] of Object.entries(map)) {
        if (url) {
          document.getElementById('panel-bg-' + key).style.backgroundImage = `url('${escapeAttr(url)}')`;
        }
      }
    } catch (e) {
      // Homepage data is optional
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

  // ---- Render: Store section (necklaces, rings) ----

  async function renderStore(jsonPath, navId, contentId, sectionId) {
    try {
      const data = await fetchJSON(jsonPath);
      const nav = document.getElementById(navId);
      const content = document.getElementById(contentId);

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

      setupScrollTracking(document.getElementById(sectionId));
    } catch (e) {
      console.error('Failed to load ' + sectionId + ' content:', e);
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
    homeLogo.style.display = 'none';
    setTimeout(() => { home.style.display = 'none'; }, 500);
    header.classList.add('visible');

    sections.forEach(s => s.classList.remove('active'));
    const target = document.getElementById('section-' + name);
    if (target) target.classList.add('active');

    headerLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.section === name);
    });

    activeSection = name;
    document.body.classList.remove('scroll-down');
    window.scrollTo(0, 0);
  }

  function goHome() {
    closeMenu();
    home.style.display = 'flex';
    homeLogo.style.display = '';
    requestAnimationFrame(() => { home.classList.remove('hidden'); });
    header.classList.remove('visible');

    sections.forEach(s => s.classList.remove('active'));
    headerLinks.forEach(l => l.classList.remove('active'));
    document.body.classList.remove('scroll-down');
    activeSection = null;
  }

  panels.forEach(panel => {
    panel.addEventListener('click', () => openSection(panel.dataset.section));
  });

  // Logo click -> go home
  headerLogo.addEventListener('click', () => {
    if (activeSection) goHome();
  });

  // Hamburger toggle
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    headerLinksWrap.classList.toggle('open');
  });

  function closeMenu() {
    hamburger.classList.remove('open');
    headerLinksWrap.classList.remove('open');
  }

  headerLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      closeMenu();
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

  // ---- Mobile scroll direction detection ----

  let lastScrollY = 0;
  let scrollTicking = false;

  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const isMobile = window.innerWidth <= 768;

      if (isMobile && activeSection) {
        if (currentY > lastScrollY && currentY > 60) {
          document.body.classList.add('scroll-down');
        } else {
          document.body.classList.remove('scroll-down');
        }
      }

      lastScrollY = currentY;
      scrollTicking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  // ---- Sidebar scroll tracking ----

  function setupScrollTracking(sectionEl) {
    const pieces = sectionEl.querySelectorAll('.art-piece');
    const navLinks = sectionEl.querySelectorAll('.art-nav-link');
    if (!pieces.length || !navLinks.length) return;

    const navContainer = sectionEl.querySelector('.art-nav');

    function setActive(id) {
      navLinks.forEach(link => {
        const isActive = link.getAttribute('href') === '#' + id;
        link.classList.toggle('active', isActive);
        // Scroll the nav bar to show the active link
        if (isActive && navContainer) {
          const linkLeft = link.offsetLeft;
          const linkWidth = link.offsetWidth;
          const containerWidth = navContainer.offsetWidth;
          const scrollTarget = linkLeft - (containerWidth / 2) + (linkWidth / 2);
          navContainer.scrollTo({ left: scrollTarget, behavior: 'smooth' });
        }
      });
    }

    // Track visibility of all pieces and always highlight the most visible
    const visibilityMap = new Map();

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          visibilityMap.set(entry.target.id, entry.intersectionRatio);
        } else {
          visibilityMap.delete(entry.target.id);
        }
      });

      let bestId = null;
      let bestRatio = 0;
      visibilityMap.forEach((ratio, id) => {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = id;
        }
      });

      if (bestId) setActive(bestId);
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });

    pieces.forEach(piece => observer.observe(piece));

    // Click on nav link: force active state and scroll precisely
    const contentEl = sectionEl.querySelector('.art-content');

    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const id = link.getAttribute('href').replace('#', '');
        setActive(id);

        const target = document.getElementById(id);
        if (!target) return;

        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
          // Mobile: page-level scroll, offset by header + sidebar
          const sidebar = sectionEl.querySelector('.art-sidebar');
          const sidebarHeight = sidebar ? sidebar.offsetHeight : 0;
          const offset = header.offsetHeight + sidebarHeight + 10;
          const targetTop = target.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo({ top: targetTop, behavior: 'smooth' });
        } else {
          // Desktop: scroll inside the content container
          const containerTop = contentEl.getBoundingClientRect().top;
          const targetTop = target.getBoundingClientRect().top;
          const scrollOffset = contentEl.scrollTop + (targetTop - containerTop);
          contentEl.scrollTo({ top: scrollOffset, behavior: 'smooth' });
        }
      });
    });
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
  renderStore('content/necklaces.json', 'necklaces-nav', 'necklaces-content', 'section-necklaces');
  renderStore('content/rings.json', 'rings-nav', 'rings-content', 'section-rings');
  renderConsulting();
})();
