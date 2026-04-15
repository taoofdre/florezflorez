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

  const cartToggle = document.getElementById('cart-toggle');
  const cartBadge = document.getElementById('cart-badge');
  const cartPanel = document.getElementById('cart-panel');
  const cartOverlay = document.getElementById('cart-overlay');
  const cartItemsEl = document.getElementById('cart-items');
  const cartEmpty = document.getElementById('cart-empty');
  const cartFooter = document.getElementById('cart-footer');
  const cartCheckoutBtn = document.getElementById('cart-checkout-btn');
  const cartCloseBtn = document.getElementById('cart-close');

  // ---- State ----
  let activeSection = null;
  let activeObserver = null;
  let instagramDmUrl = 'https://ig.me/m/florezflorez.studio';
  const dataCache = {};

  // ---- Settings (pixel ID, Instagram URL) ----
  const settingsPromise = fetch('/content/settings.json?t=' + Date.now())
    .then(r => r.ok ? r.json() : {})
    .catch(() => ({}));

  settingsPromise.then(settings => {
    if (settings.meta_pixel_id && typeof fbq === 'function') {
      fbq('init', settings.meta_pixel_id);
      fbq('track', 'PageView');
    }
    const igLink = document.getElementById('instagram-dm-link');
    if (igLink && settings.instagram_dm_url) {
      igLink.href = settings.instagram_dm_url;
    }
    if (settings.instagram_dm_url) {
      instagramDmUrl = settings.instagram_dm_url;
    }
  });

  // ---- Cart state ----
  let cart = JSON.parse(localStorage.getItem('ff_cart') || '[]');
  const stockByPriceId = {};

  function saveCart() {
    localStorage.setItem('ff_cart', JSON.stringify(cart));
    updateCartUI();
  }

  function addToCart(item) {
    const stock = stockByPriceId[item.price_id];
    const existing = cart.find(c => c.price_id === item.price_id);
    const currentQty = existing ? existing.quantity : 0;
    if (typeof stock === 'number' && currentQty >= stock) return;
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({ ...item, quantity: 1 });
    }
    if (typeof fbq === 'function') {
      fbq('track', 'AddToCart', {
        content_ids: [item.price_id],
        content_name: item.title,
        content_type: 'product',
        value: parsePrice(item.price_display),
        currency: 'USD'
      });
    }
    saveCart();
    openCart();
  }

  function removeFromCart(priceId) {
    cart = cart.filter(c => c.price_id !== priceId);
    saveCart();
  }

  function updateQuantity(priceId, delta) {
    const item = cart.find(c => c.price_id === priceId);
    if (!item) return;
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      removeFromCart(priceId);
      return;
    }
    const stock = stockByPriceId[priceId];
    if (typeof stock === 'number' && newQty > stock) return;
    item.quantity = newQty;
    saveCart();
  }

  function updateCartUI() {
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    cartBadge.textContent = count;
    cartBadge.style.display = count > 0 ? '' : 'none';

    cartItemsEl.innerHTML = '';
    if (cart.length === 0) {
      cartEmpty.style.display = '';
      cartFooter.style.display = 'none';
      cartItemsEl.appendChild(cartEmpty);
      const note = document.createElement('div');
      note.className = 'cart-shipping-note';
      note.innerHTML = '<p>Shipping to USA only</p><p>Arrives in 3\u20134 days</p><p>Free shipping on orders over $200</p>';
      cartItemsEl.appendChild(note);
      return;
    }

    cartEmpty.style.display = 'none';
    cartFooter.style.display = '';

    cart.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cart-item';

      const img = document.createElement('img');
      img.className = 'cart-item-img';
      img.src = item.image || '/images/placeholder.svg';
      img.alt = item.title;
      row.appendChild(img);

      const info = document.createElement('div');
      info.className = 'cart-item-info';

      const title = document.createElement('div');
      title.className = 'cart-item-title';
      title.textContent = item.title;
      info.appendChild(title);

      const price = document.createElement('div');
      price.className = 'cart-item-price';
      price.textContent = formatPrice(item.price_display);
      info.appendChild(price);

      const controls = document.createElement('div');
      controls.className = 'cart-item-controls';

      const minusBtn = document.createElement('button');
      minusBtn.className = 'cart-qty-btn';
      minusBtn.textContent = '-';
      minusBtn.addEventListener('click', () => updateQuantity(item.price_id, -1));
      controls.appendChild(minusBtn);

      const qty = document.createElement('span');
      qty.className = 'cart-qty';
      qty.textContent = item.quantity;
      controls.appendChild(qty);

      const plusBtn = document.createElement('button');
      plusBtn.className = 'cart-qty-btn';
      plusBtn.textContent = '+';
      const stock = stockByPriceId[item.price_id];
      if (typeof stock === 'number' && item.quantity >= stock) {
        plusBtn.disabled = true;
        plusBtn.style.opacity = '0.3';
        plusBtn.style.cursor = 'default';
      }
      plusBtn.addEventListener('click', () => updateQuantity(item.price_id, 1));
      controls.appendChild(plusBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'cart-item-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => removeFromCart(item.price_id));

      info.appendChild(controls);
      info.appendChild(removeBtn);
      row.appendChild(info);
      cartItemsEl.appendChild(row);
    });
  }

  function openCart() {
    cartPanel.classList.add('open');
    cartOverlay.classList.add('open');
  }

  function closeCart() {
    cartPanel.classList.remove('open');
    cartOverlay.classList.remove('open');
  }

  cartToggle.addEventListener('click', () => {
    if (cartPanel.classList.contains('open')) {
      closeCart();
    } else {
      openCart();
    }
  });
  cartCloseBtn.addEventListener('click', closeCart);
  cartOverlay.addEventListener('click', closeCart);

  cartCheckoutBtn.addEventListener('click', async () => {
    if (cart.length === 0) return;
    if (typeof fbq === 'function') {
      const totalValue = cart.reduce((sum, item) => sum + parsePrice(item.price_display) * item.quantity, 0);
      fbq('track', 'InitiateCheckout', {
        content_ids: cart.map(item => item.price_id),
        content_type: 'product',
        num_items: cart.reduce((sum, item) => sum + item.quantity, 0),
        value: totalValue,
        currency: 'USD'
      });
    }
    cartCheckoutBtn.textContent = 'PROCESSING...';
    cartCheckoutBtn.disabled = true;

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(item => ({
            price_id: item.price_id,
            quantity: item.quantity,
          })),
        }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Checkout failed');
      }
    } catch (err) {
      alert('Checkout error: ' + err.message);
      cartCheckoutBtn.textContent = 'CHECKOUT';
      cartCheckoutBtn.disabled = false;
    }
  });

  // Clear cart and show thank you screen on successful checkout return
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'success') {
    const orderTotal = parseFloat(params.get('total') || '0');
    settingsPromise.then(() => {
      if (typeof fbq === 'function') fbq('track', 'Purchase', {
        content_ids: cart.map(item => item.price_id),
        content_type: 'product',
        num_items: cart.reduce((sum, item) => sum + item.quantity, 0),
        value: orderTotal,
        currency: 'USD'
      });
    });
    cart = [];
    saveCart();
    window.history.replaceState(null, '', window.location.pathname);
    const thankYouOverlay = document.getElementById('thankyou-overlay');
    thankYouOverlay.style.display = 'flex';
    document.getElementById('thankyou-close').addEventListener('click', () => {
      thankYouOverlay.style.display = 'none';
    });
  }

  updateCartUI();

  // ---- Lightbox ----
  let lbImages = [];
  let lbIndex = 0;

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
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxPrev();
    if (e.key === 'ArrowRight') lightboxNext();
  });
  let lbTouchStartX = 0;
  lightbox.addEventListener('touchstart', (e) => { lbTouchStartX = e.changedTouches[0].screenX; }, { passive: true });
  lightbox.addEventListener('touchend', (e) => {
    const diff = lbTouchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) lightboxNext();
      else lightboxPrev();
    }
  });

  // ---- Helpers ----

  function text(el, str) { el.textContent = str; }

  function escapeAttr(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  async function fetchJSON(path) {
    const res = await fetch(path + '?t=' + Date.now());
    if (!res.ok) throw new Error('Failed to load ' + path);
    return res.json();
  }

  let CATEGORY_NAMES = {};
  let productCategories = [];

  // ---- Data loading ----

  async function loadAllData() {
    // Load categories from homepage.json
    try {
      const homepage = await fetchJSON('/content/homepage.json');
      if (homepage.categories) {
        homepage.categories.forEach(cat => {
          // Skip non-product sections
          if (cat.slug === 'consulting' || cat.slug === 'about') return;
          CATEGORY_NAMES[cat.slug] = cat.label.charAt(0) + cat.label.slice(1).toLowerCase();
          productCategories.push(cat.slug);
        });
      }
    } catch (e) {
      // Fallback
      CATEGORY_NAMES = { art: 'Art', necklaces: 'Necklaces', rings: 'Rings' };
      productCategories = ['art', 'necklaces', 'rings'];
    }

    // Ensure section elements exist for each product category
    productCategories.forEach(slug => {
      if (!document.getElementById('section-' + slug)) {
        const section = document.createElement('section');
        section.id = 'section-' + slug;
        section.className = 'section';
        section.innerHTML = '<div class="art-layout"><aside class="art-sidebar"><ul class="art-nav" id="' + slug + '-nav"></ul></aside><main class="art-content" id="' + slug + '-content"></main></div>';
        document.body.insertBefore(section, document.getElementById('cart-panel'));
      }
    });

    // Load all product category JSON files
    const results = await Promise.all(
      productCategories.map(slug =>
        fetchJSON('/content/' + slug + '.json').catch(() => ({ pieces: [] }))
      )
    );

    productCategories.forEach((slug, i) => {
      dataCache[slug] = results[i];
      (results[i].pieces || []).forEach(piece => {
        if (piece.stripe_price_id) {
          stockByPriceId[piece.stripe_price_id] = piece.stock;
        }
      });
    });
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
        dot.setAttribute('aria-label', 'Image ' + (i + 1));
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

      let touchStartX = 0;
      carousel.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
      carousel.addEventListener('touchend', (e) => {
        const diff = touchStartX - e.changedTouches[0].screenX;
        if (Math.abs(diff) > 50) {
          if (diff > 0) goTo(current + 1);
          else goTo(current - 1);
        }
      });
    }

    return carousel;
  }

  // ---- Build helpers ----

  function buildBuyActions(piece) {
    const wrap = document.createElement('div');
    wrap.className = 'buy-actions';

    const isSoldOut = typeof piece.stock === 'number' && piece.stock === 0;

    if (piece.for_sale && piece.stripe_price_id) {
      if (isSoldOut) {
        const btn = document.createElement('button');
        btn.className = 'buy-btn buy-btn-disabled';
        btn.disabled = true;
        text(btn, 'Sold Out');
        wrap.appendChild(btn);
      } else {
        const btn = document.createElement('button');
        btn.className = 'buy-btn';
        text(btn, 'Add to Cart');
        btn.addEventListener('click', () => addToCart({
          price_id: piece.stripe_price_id,
          title: piece.title,
          price_display: piece.price_display,
          image: piece.images && piece.images.length > 0 ? piece.images[0].src : '',
        }));
        wrap.appendChild(btn);
      }
    }

    const contactBtn = document.createElement('a');
    contactBtn.className = 'contact-btn';
    contactBtn.href = instagramDmUrl;
    contactBtn.target = '_blank';
    contactBtn.rel = 'noopener';
    text(contactBtn, 'Contact us for options');
    wrap.appendChild(contactBtn);

    return wrap;
  }

  // ---- Render: Homepage ----

  async function renderHomepage() {
    let gradientColors = [['#834d9b', '#d04ed6'], ['#1CD8D2', '#93EDC7'], ['#ee9ca7', '#ffdde1'], ['#2193b0', '#6dd5ed']];
    try {
      const data = await fetchJSON('/content/homepage.json');
      if (data.logo) {
        homeLogo.src = data.logo;
        headerLogo.src = data.logo;
      }
      if (data.gradients && data.gradients.length > 0) gradientColors = data.gradients;
    } catch (e) {}

    new Granim({
      element: '#home-gradient',
      direction: 'diagonal',
      isPausedWhenNotInView: true,
      stateTransitionSpeed: 300,
      states: {
        'default-state': {
          gradients: gradientColors,
          transitionSpeed: 6000
        }
      }
    });
  }

  // ---- Render: Category listing ----

  function renderCategoryView(sectionId, pieces, categorySlug) {
    const section = document.getElementById(sectionId);
    const artLayout = section.querySelector('.art-layout');
    const sidebar = artLayout.querySelector('.art-sidebar');
    const content = artLayout.querySelector('.art-content');

    // Remove product view if present
    section.classList.remove('product-view');
    document.body.classList.remove('product-open');
    const existingProduct = section.querySelector('.product-page');
    if (existingProduct) existingProduct.remove();

    artLayout.style.display = '';
    sidebar.innerHTML = '';
    content.innerHTML = '';
    content.scrollTop = 0;

    // Nav links
    const nav = document.createElement('ul');
    nav.className = 'art-nav';

    pieces.forEach(piece => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '/' + categorySlug + '/' + piece.id;
      a.className = 'art-nav-link';
      text(a, piece.title);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigate('/' + categorySlug + '/' + piece.id);
      });
      li.appendChild(a);
      nav.appendChild(li);
    });

    sidebar.appendChild(nav);

    // Single images
    pieces.forEach(piece => {
      const article = document.createElement('article');
      article.id = piece.id;
      article.className = 'art-piece';

      if (piece.images && piece.images.length > 0) {
        const link = document.createElement('a');
        link.href = '/' + categorySlug + '/' + piece.id;
        link.className = 'product-image-link';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          navigate('/' + categorySlug + '/' + piece.id);
        });

        const img = document.createElement('img');
        img.src = piece.images[0].src;
        img.alt = piece.images[0].alt;
        img.className = 'art-image';
        img.loading = 'lazy';
        link.appendChild(img);
        article.appendChild(link);
      }

      content.appendChild(article);
    });

    // Scroll tracking
    setupScrollTracking(section, categorySlug);
  }

  // ---- Render: Product page ----

  function parsePrice(display) { return parseFloat((display || '').replace(/[^0-9.]/g, '')) || 0; }
  function formatPrice(display) { const v = (display || '').replace(/[^0-9.]/g, ''); return v ? '$' + v : ''; }

  function renderProductView(sectionId, piece, categorySlug) {
    window.scrollTo(0, 0);

    if (typeof fbq === 'function') {
      fbq('track', 'ViewContent', {
        content_ids: [piece.id],
        content_name: piece.title,
        content_type: 'product',
        content_category: categorySlug,
        value: parsePrice(piece.price_display),
        currency: 'USD'
      });
    }

    const section = document.getElementById(sectionId);
    const artLayout = section.querySelector('.art-layout');

    // Disconnect scroll tracking
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }

    // Hide category layout
    artLayout.style.display = 'none';

    // Remove existing product view
    let productPage = section.querySelector('.product-page');
    if (productPage) productPage.remove();

    section.classList.add('product-view');
    document.body.classList.add('product-open');

    // Build product page
    productPage = document.createElement('div');
    productPage.className = 'product-page';

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'product-sidebar';

    const back = document.createElement('a');
    back.className = 'product-back';
    back.href = '/' + categorySlug;
    back.innerHTML = '&#8592; ' + escapeAttr(CATEGORY_NAMES[categorySlug] || categorySlug);
    back.addEventListener('click', (e) => { e.preventDefault(); navigate('/' + categorySlug); });
    sidebar.appendChild(back);

    const titleEl = document.createElement('h2');
    titleEl.className = 'product-title';
    text(titleEl, piece.title);
    sidebar.appendChild(titleEl);

    const descEl = document.createElement('p');
    descEl.className = 'product-description';
    text(descEl, piece.description);
    sidebar.appendChild(descEl);

    sidebar.appendChild(buildBuyActions(piece));

    productPage.appendChild(sidebar);

    // Media (carousel)
    const media = document.createElement('div');
    media.className = 'product-media';

    if (piece.images && piece.images.length > 0) {
      media.appendChild(buildCarousel(piece.images));
    }

    // Mobile header: title + price on same line (hidden on desktop)
    const mobileHeader = document.createElement('div');
    mobileHeader.className = 'product-header-mobile';
    const mobileTitle = document.createElement('h2');
    mobileTitle.className = 'product-title-mobile';
    text(mobileTitle, piece.title);
    mobileHeader.appendChild(mobileTitle);
    if (piece.for_sale && piece.price_display) {
      const mobilePrice = document.createElement('span');
      mobilePrice.className = 'product-price-mobile';
      text(mobilePrice, formatPrice(piece.price_display));
      mobileHeader.appendChild(mobilePrice);
    }
    media.insertBefore(mobileHeader, media.firstChild);

    // Mobile description (below carousel, hidden on desktop)
    const mobileDesc = document.createElement('p');
    mobileDesc.className = 'product-description-mobile';
    text(mobileDesc, piece.description);
    media.appendChild(mobileDesc);

    // Mobile buy actions (below description, hidden on desktop)
    const mobileBuy = buildBuyActions(piece);
    mobileBuy.classList.add('buy-actions-mobile');
    media.appendChild(mobileBuy);

    productPage.appendChild(media);
    section.appendChild(productPage);
  }

  // ---- Render: Consulting ----

  async function renderConsulting() {
    try {
      const data = await fetchJSON('/content/consulting.json');
      const textEl = document.getElementById('consulting-text');
      const bgEl = document.getElementById('consulting-bg');

      const h2 = document.createElement('h2');
      text(h2, data.heading);
      textEl.appendChild(h2);

      const p = document.createElement('p');
      text(p, data.message);
      textEl.appendChild(p);

      if (data.background_image) {
        bgEl.style.backgroundImage = "url('" + escapeAttr(data.background_image) + "')";
      }
    } catch (e) {
      console.error('Failed to load consulting content:', e);
    }
  }

  async function renderAbout() {
    // About section is static HTML (policy links)
  }

  // ---- Section management ----

  function showSection(name) {
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
    closeCart();
  }

  function goHome() {
    closeMenu();
    closeCart();
    home.style.display = 'flex';
    homeLogo.style.display = '';
    requestAnimationFrame(() => { home.classList.remove('hidden'); });
    header.classList.remove('visible');

    sections.forEach(s => s.classList.remove('active'));
    headerLinks.forEach(l => l.classList.remove('active'));
    document.body.classList.remove('scroll-down');
    document.body.classList.remove('product-open');
    activeSection = null;

    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
  }

  function closeMenu() {
    hamburger.classList.remove('open');
    headerLinksWrap.classList.remove('open');
  }

  // ---- Router ----

  function navigate(path, push) {
    if (push !== false) history.pushState(null, '', path);

    const clean = path.replace(/^\//, '').replace(/\/$/, '');

    if (!clean) {
      goHome();
      return;
    }

    const parts = clean.split('/');
    const category = parts[0];
    const productId = parts[1] || null;

    // Product sections
    const sectionId = 'section-' + category;
    if (!document.getElementById(sectionId)) return;

    showSection(category);

    if (productId && dataCache[category]) {
      const piece = dataCache[category].pieces.find(p => p.id === productId);
      if (piece) {
        renderProductView(sectionId, piece, category);
        return;
      }
    }

    if (dataCache[category]) {
      renderCategoryView(sectionId, dataCache[category].pieces, category);
    }
  }

  // ---- Event listeners ----

  panels.forEach(panel => {
    panel.addEventListener('click', () => {
      navigate('/' + panel.dataset.section);
    });
  });

  headerLogo.addEventListener('click', () => {
    if (activeSection) navigate('/');
  });

  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    headerLinksWrap.classList.toggle('open');
  });

  headerLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      closeMenu();
      const name = link.dataset.section;
      if (name === activeSection && !document.querySelector('.product-view')) {
        navigate('/');
      } else {
        navigate('/' + name);
      }
    });
  });

  window.addEventListener('popstate', () => {
    navigate(window.location.pathname, false);
  });

  // ---- Scroll tracking ----

  function setupScrollTracking(sectionEl, categorySlug) {
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }

    const pieces = sectionEl.querySelectorAll('.art-piece');
    const navLinks = sectionEl.querySelectorAll('.art-nav-link');
    if (!pieces.length || !navLinks.length) return;

    const navContainer = sectionEl.querySelector('.art-nav');

    function setActive(id) {
      navLinks.forEach(link => {
        const href = link.getAttribute('href');
        const linkId = href.split('/').pop();
        const isActive = linkId === id;
        link.classList.toggle('active', isActive);
        if (isActive && navContainer) {
          const linkLeft = link.offsetLeft;
          const linkWidth = link.offsetWidth;
          const containerWidth = navContainer.offsetWidth;
          const scrollTarget = linkLeft - (containerWidth / 2) + (linkWidth / 2);
          navContainer.scrollTo({ left: scrollTarget, behavior: 'smooth' });
        }
      });
    }

    const visibilityMap = new Map();

    activeObserver = new IntersectionObserver((entries) => {
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

    pieces.forEach(piece => activeObserver.observe(piece));
  }

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

  // ---- Init ----

  renderHomepage();

  Promise.all([
    loadAllData(),
    renderConsulting(),
    renderAbout()
  ]).then(() => {
    // Route based on current path
    const path = window.location.pathname;
    if (path && path !== '/') {
      navigate(path, false);
    }
  });
})();
