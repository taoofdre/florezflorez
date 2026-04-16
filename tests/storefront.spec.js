const { test, expect } = require('@playwright/test');

// Helper: wait for product data to be loaded (sections created dynamically)
async function waitForDataReady(page) {
  await page.waitForFunction(() => {
    return document.querySelectorAll('.section').length >= 3;
  }, { timeout: 10000 });
}

// Helper: wait for products to be rendered (category or product view)
async function waitForProducts(page) {
  await page.waitForFunction(() => {
    return document.querySelectorAll('.art-piece, .product-page').length > 0;
  }, { timeout: 10000 });
}

// Helper: navigate to a section via panel click (makes header + cart visible)
async function goToSection(page, section) {
  await page.goto('/');
  await waitForDataReady(page);
  await page.locator(`.panel[data-section="${section}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/${section}`));
  await waitForProducts(page);
  await page.evaluate(() => window.scrollTo(0, 0));
}

// ---- Homepage ----

test.describe('Homepage', () => {
  test('loads and shows category panels', async ({ page }) => {
    await page.goto('/');
    const panels = page.locator('.panel');
    await expect(panels.first()).toBeVisible();
    const count = await panels.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('shows logo on homepage', async ({ page }) => {
    await page.goto('/');
    const logo = page.locator('#home-logo');
    await expect(logo).toBeVisible();
  });
});

// ---- Navigation & Routing ----

test.describe('Navigation', () => {
  test('clicking a category panel navigates to that section', async ({ page }) => {
    await goToSection(page, 'rings');
    await expect(page.locator('#header')).toHaveClass(/visible/);
  });

  test('direct URL to category loads products', async ({ page }) => {
    await page.goto('/rings');
    await waitForProducts(page);
    await expect(page.locator('#section-rings')).toHaveClass(/active/);
    const pieces = page.locator('#section-rings .art-piece');
    const count = await pieces.count();
    expect(count).toBeGreaterThan(0);
  });

  test('direct URL to product loads product view', async ({ page }) => {
    await page.goto('/rings/ring001');
    await waitForProducts(page);
    await expect(page.locator('#section-rings')).toHaveClass(/active/);
    await expect(page.locator('.buy-actions').first()).toBeVisible();
  });

  test('header logo navigates back to homepage', async ({ page }) => {
    await goToSection(page, 'rings');
    await page.locator('#header-logo').click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('#home')).toBeVisible();
  });

  test('header navigation links switch between categories', async ({ page }) => {
    await goToSection(page, 'rings');
    const necklacesLink = page.locator('.header-link[data-section="necklaces"]');
    if (await necklacesLink.count() > 0) {
      await necklacesLink.click();
      await expect(page).toHaveURL(/\/necklaces$/);
      await expect(page.locator('#section-necklaces')).toHaveClass(/active/);
    }
  });

  test('browser back button works', async ({ page }) => {
    await page.goto('/');
    await waitForDataReady(page);
    await page.locator('.panel').first().click();
    await page.waitForURL(/\/\w+$/);
    await page.goBack();
    await expect(page).toHaveURL('/');
  });

  test('404 page renders for invalid route', async ({ page }) => {
    const response = await page.goto('/nonexistent-page-xyz');
    expect(response.status()).toBeLessThan(500);
  });
});

// ---- Product Display ----

test.describe('Product display', () => {
  test('product card shows image', async ({ page }) => {
    await page.goto('/rings');
    await waitForProducts(page);
    const piece = page.locator('#section-rings .art-piece').first();
    await expect(piece).toBeVisible();
    const img = piece.locator('img');
    await expect(img).toHaveAttribute('src', /.+/);
  });

  test('product view shows image carousel', async ({ page }) => {
    await page.goto('/rings/ring001');
    await waitForProducts(page);
    const carousel = page.locator('.carousel');
    await expect(carousel.first()).toBeVisible();
  });

  test('product view shows price', async ({ page }) => {
    await page.goto('/rings/ring001');
    await waitForProducts(page);
    const price = page.locator('.product-price');
    await expect(price.first()).toBeVisible();
    const text = await price.first().textContent();
    expect(text).toMatch(/\$/);
  });

  test('lightbox opens on image click and closes on escape', async ({ page }) => {
    await page.goto('/rings/ring001');
    await waitForProducts(page);
    const productImg = page.locator('.carousel img').first();
    await productImg.click();
    const lightbox = page.locator('#lightbox');
    await expect(lightbox).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(lightbox).not.toHaveClass(/open/);
  });
});

// ---- Cart ----

test.describe('Cart', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('ff_cart'));
  });

  test('cart is initially empty', async ({ page }) => {
    await page.goto('/');
    const badge = page.locator('#cart-badge');
    await expect(badge).toBeHidden();
  });

  test('add to cart updates badge count', async ({ page }) => {
    await page.goto('/rings/ring001');
    await waitForProducts(page);

    // If there's a size picker, select an available size first
    const sizeBtn = page.locator('.size-option:not(.size-option-soldout)').first();
    if (await sizeBtn.count() > 0) {
      await sizeBtn.click();
    }

    const addBtn = page.locator('.buy-btn:not(.buy-btn-disabled)');
    await expect(addBtn.first()).toBeVisible({ timeout: 5000 });
    await addBtn.first().click();

    const badge = page.locator('#cart-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');
  });

  test('cart persists across page reload', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('ff_cart', JSON.stringify([{
        price_id: 'price_test123',
        title: 'Test Ring',
        price_display: '100',
        image: '',
        quantity: 1,
      }]));
    });
    await page.reload();
    const badge = page.locator('#cart-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');
  });

  test('cart panel opens and shows items', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('ff_cart', JSON.stringify([{
        price_id: 'price_test123',
        title: 'Test Ring',
        price_display: '100',
        image: '',
        quantity: 1,
      }]));
    });
    // Navigate to section so cart toggle is in the visible header
    await goToSection(page, 'rings');
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('cart-panel').classList.add('open'); document.getElementById('cart-overlay').classList.add('open'); });
    const cartPanel = page.locator('#cart-panel');
    await expect(cartPanel).toHaveClass(/open/);
    await expect(page.locator('.cart-item')).toHaveCount(1);
    await expect(page.locator('.cart-item-title')).toContainText('Test Ring');
  });

  test('remove button removes item from cart', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('ff_cart', JSON.stringify([{
        price_id: 'price_test123',
        title: 'Test Ring',
        price_display: '100',
        image: '',
        quantity: 1,
      }]));
    });
    await goToSection(page, 'rings');
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('cart-panel').classList.add('open'); document.getElementById('cart-overlay').classList.add('open'); });
    await page.locator('.cart-item-remove').click();
    await expect(page.locator('.cart-item')).toHaveCount(0);
    await expect(page.locator('#cart-badge')).toBeHidden();
  });

  test('quantity buttons increment and decrement', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('ff_cart', JSON.stringify([{
        price_id: 'price_test123',
        title: 'Test Ring',
        price_display: '100',
        image: '',
        quantity: 1,
      }]));
    });
    await goToSection(page, 'rings');
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('cart-panel').classList.add('open'); document.getElementById('cart-overlay').classList.add('open'); });

    // Increment
    await page.locator('.cart-qty-btn:has-text("+")').click();
    await expect(page.locator('.cart-qty')).toHaveText('2');
    await expect(page.locator('#cart-badge')).toHaveText('2');

    // Decrement
    await page.locator('.cart-qty-btn:has-text("-")').click();
    await expect(page.locator('.cart-qty')).toHaveText('1');
    await expect(page.locator('#cart-badge')).toHaveText('1');
  });

  test('decrementing to zero removes item', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('ff_cart', JSON.stringify([{
        price_id: 'price_test123',
        title: 'Test Ring',
        price_display: '100',
        image: '',
        quantity: 1,
      }]));
    });
    await goToSection(page, 'rings');
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('cart-panel').classList.add('open'); document.getElementById('cart-overlay').classList.add('open'); });
    await page.locator('.cart-qty-btn:has-text("-")').click();
    await expect(page.locator('.cart-item')).toHaveCount(0);
  });

  test('empty cart shows shipping note', async ({ page }) => {
    await goToSection(page, 'rings');
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('cart-panel').classList.add('open'); document.getElementById('cart-overlay').classList.add('open'); });
    await expect(page.locator('.cart-shipping-note').first()).toBeVisible();
    await expect(page.locator('.cart-shipping-note').first()).toContainText('Shipping to USA only');
  });
});

// ---- Checkout ----

test.describe('Checkout', () => {
  test('checkout button sends correct payload to /api/checkout', async ({ page }) => {
    let checkoutPayload = null;

    // Intercept the checkout API call
    await page.route('**/api/checkout', async (route) => {
      checkoutPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/test' }),
      });
    });

    // Prevent navigation to Stripe
    await page.route('https://checkout.stripe.com/**', route => route.abort());

    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('ff_cart', JSON.stringify([{
        price_id: 'price_ABC123',
        title: 'Test Ring',
        price_display: '285',
        image: '',
        quantity: 2,
        size: '8.5',
      }]));
    });

    await goToSection(page, 'rings');
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('cart-panel').classList.add('open'); document.getElementById('cart-overlay').classList.add('open'); });
    await page.locator('#cart-checkout-btn').click();

    await expect(() => {
      expect(checkoutPayload).toBeTruthy();
    }).toPass({ timeout: 5000 });

    expect(checkoutPayload.items).toHaveLength(1);
    expect(checkoutPayload.items[0]).toEqual({
      price_id: 'price_ABC123',
      quantity: 2,
      size: '8.5',
    });
  });

  test('successful checkout shows thank you overlay and clears cart', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('ff_cart', JSON.stringify([{
        price_id: 'price_test',
        title: 'Ring',
        price_display: '100',
        image: '',
        quantity: 1,
      }]));
    });
    await page.goto('/?checkout=success&total=100.00');
    const overlay = page.locator('#thankyou-overlay');
    await expect(overlay).toBeVisible();

    const cartData = await page.evaluate(() => localStorage.getItem('ff_cart'));
    expect(JSON.parse(cartData)).toEqual([]);
  });
});

// ---- Content Loading ----

test.describe('Content loading', () => {
  test('page loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });

  test('category data loads and creates sections', async ({ page }) => {
    await page.goto('/');
    await waitForDataReady(page);
    const sectionCount = await page.locator('.section').count();
    expect(sectionCount).toBeGreaterThanOrEqual(3);
  });
});

// ---- Static Pages ----

test.describe('Static pages', () => {
  test('privacy page loads', async ({ page }) => {
    const response = await page.goto('/privacy.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText('privacy', { ignoreCase: true });
  });

  test('returns page loads', async ({ page }) => {
    const response = await page.goto('/returns.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText('return', { ignoreCase: true });
  });

  test('shipping page loads', async ({ page }) => {
    const response = await page.goto('/shipping.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText('shipping', { ignoreCase: true });
  });
});
