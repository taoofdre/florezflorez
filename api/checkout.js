const Stripe = require('stripe');

const REPO = process.env.GITHUB_REPO || 'taoofdre/florezflorez';
const SPECIAL_SECTIONS = ['consulting', 'about'];

async function getContentFiles(pat) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/content/homepage.json`, {
      headers: { 'Authorization': 'token ' + pat, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return ['content/art.json', 'content/necklaces.json', 'content/rings.json'];
    const file = await res.json();
    const data = JSON.parse(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'));
    return (data.categories || [])
      .filter(c => !SPECIAL_SECTIONS.includes(c.slug))
      .map(c => 'content/' + c.slug + '.json');
  } catch (e) {
    return ['content/art.json', 'content/necklaces.json', 'content/rings.json'];
  }
}

async function getStockMap() {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return {};
  const contentFiles = await getContentFiles(pat);
  const map = {};
  await Promise.all(contentFiles.map(async (path) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
        headers: {
          'Authorization': 'token ' + pat,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      if (!res.ok) return;
      const file = await res.json();
      const data = JSON.parse(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'));
      for (const piece of (data.pieces || [])) {
        if (piece.stripe_price_id) {
          map[piece.stripe_price_id] = piece.stock;
        }
      }
    } catch (e) {}
  }));
  return map;
}

module.exports = async function handler(req, res) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || `https://${req.headers.host}`;

  let line_items;

  if (req.method === 'POST') {
    // Cart checkout: multiple items
    const { items } = req.body || {};
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Missing or empty items array' });
      return;
    }
    line_items = items.map(item => ({
      price: item.price_id,
      quantity: item.quantity || 1,
    }));
  } else {
    // Legacy single-item checkout (GET)
    const priceId = req.query.price_id;
    if (!priceId) {
      res.status(400).json({ error: 'Missing price_id' });
      return;
    }
    line_items = [{ price: priceId, quantity: 1 }];
  }

  // Validate stock before creating Stripe session
  try {
    const stockMap = await getStockMap();
    for (const li of line_items) {
      const stock = stockMap[li.price];
      if (typeof stock === 'number' && li.quantity > stock) {
        const msg = stock === 0
          ? 'Sorry, this item is sold out'
          : `Only ${stock} left in stock`;
        return res.status(400).json({ error: msg });
      }
    }
  } catch (e) {
    // Stock check failed — allow checkout rather than blocking
    console.error('Stock check error:', e.message);
  }

  try {
    // Look up prices to calculate order total for pixel tracking
    const prices = await Promise.all(
      line_items.map(li => stripe.prices.retrieve(li.price))
    );
    const totalCents = prices.reduce((sum, price, i) => {
      return sum + (price.unit_amount * (line_items[i].quantity || 1));
    }, 0);
    const total = (totalCents / 100).toFixed(2);

    const sessionParams = {
      mode: 'payment',
      line_items,
      shipping_address_collection: {
        allowed_countries: ['US'],
      },
      shipping_options: [
        { shipping_rate: 'shr_1TLE6gGZz3PbqlU6QUzZfFdG' },
      ],
      allow_promotion_codes: true,
      success_url: `${origin}/?checkout=success&total=${total}`,
      cancel_url: `${origin}/?checkout=cancel`,
    };

    // Auto-apply free shipping coupon on orders over $200
    if (totalCents > 20000) {
      sessionParams.discounts = [{ coupon: 'yfDilCGY' }];
      // discounts and allow_promotion_codes are mutually exclusive in Stripe
      delete sessionParams.allow_promotion_codes;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (req.method === 'POST') {
      res.status(200).json({ url: session.url });
    } else {
      res.redirect(303, session.url);
    }
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({
      error: 'Failed to create checkout session',
      detail: err.message,
      type: err.type || null
    });
  }
};
