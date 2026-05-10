// Embedded Stripe Checkout session creation, routed through Stripe Connect
// direct charges. The platform owns the API key (PLATFORM_STRIPE_SK); the
// merchant owns the connected Stripe account (MERCHANT_STRIPE_ACCOUNT_ID). All
// requests pass `{ stripeAccount }` so the session is created on — and money
// lands in — the merchant's account directly. The platform takes no
// application fee on top of Stripe's standard rates; ururu's revenue is the
// merchant's $5/mo or $50/yr subscription only.
//
// Both env vars are injected by the platform at provision time (or by the
// Stripe Connect callback once the merchant authorizes). If either is missing,
// we return 503 instead of falling back to a misrouted charge.
//
// Embedded mode: the client mounts a Stripe-hosted iframe at #checkout instead
// of redirecting. We return the session's client_secret + the publishable key
// + the connected stripeAccount so the client can call Stripe(pk,
// {stripeAccount}).initEmbeddedCheckout({clientSecret, ...}).
//
// USPS shipping: when settings.shipping.method === 'usps' we set a placeholder
// shipping_options entry and grant `update_shipping_details: server_only`, so
// the buyer's address change fires the client-side onShippingDetailsChange
// callback → /api/calculate-shipping-options → stripe.checkout.sessions.update.

const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
// ui_mode='embedded_page' (the variant that supports onShippingDetailsChange)
// was introduced in the dahlia API release. The installed stripe-node@14 pins
// 2023-10-16, which rejects the value, so we override Stripe-Version per-call
// without bumping the SDK (which would touch every other endpoint).
const STRIPE_API_VERSION = '2026-04-22.dahlia';

function loadSettings() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'content', 'settings.json'), 'utf8')
    );
  } catch {
    return {};
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const platformSecret = process.env.PLATFORM_STRIPE_SK;
  const platformPublishable = process.env.PLATFORM_STRIPE_PK;
  const merchantAccount = process.env.MERCHANT_STRIPE_ACCOUNT_ID;

  if (!platformSecret || !platformPublishable || !merchantAccount) {
    res.status(503).json({
      error: 'Checkout is not configured for this store yet.',
    });
    return;
  }

  const stripe = new Stripe(platformSecret);
  const opts = { stripeAccount: merchantAccount, apiVersion: STRIPE_API_VERSION };

  const origin =
    req.headers.origin ||
    req.headers.referer?.replace(/\/[^/]*$/, '') ||
    `https://${req.headers.host}`;

  const { items } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Missing or empty items array' });
    return;
  }

  const line_items = items.map((item) => ({
    price: item.price_id,
    quantity: item.quantity || 1,
  }));
  const sizeInfo = items
    .filter((item) => item.size)
    .map((item) => item.size + ' x' + (item.quantity || 1))
    .join(', ');

  try {
    const prices = await Promise.all(
      line_items.map((li) => stripe.prices.retrieve(li.price, opts))
    );
    const totalCents = prices.reduce(
      (sum, price, i) => sum + price.unit_amount * (line_items[i].quantity || 1),
      0
    );

    const settings = loadSettings();
    const shipping = settings.shipping || {};

    const sessionParams = {
      ui_mode: 'embedded_page',
      mode: 'payment',
      line_items,
      shipping_address_collection: { allowed_countries: ['US'] },
      allow_promotion_codes: true,
      return_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    };

    if (shipping.method === 'flat' && shipping.stripe_rate_id) {
      sessionParams.shipping_options = [
        { shipping_rate: shipping.stripe_rate_id },
      ];
      if (shipping.free_threshold && totalCents >= shipping.free_threshold * 100) {
        delete sessionParams.shipping_options;
      }
    } else if (shipping.method === 'usps') {
      // Placeholder rate Stripe shows briefly before the buyer enters their
      // address — replaced via /api/calculate-shipping-options once they do.
      sessionParams.shipping_options = [
        {
          shipping_rate_data: {
            display_name: 'Calculating shipping…',
            type: 'fixed_amount',
            fixed_amount: { amount: 0, currency: 'usd' },
          },
        },
      ];
      sessionParams.permissions = { update_shipping_details: 'server_only' };
    } else if (shipping.method === 'pickup') {
      delete sessionParams.shipping_address_collection;
    }

    if (sizeInfo) {
      sessionParams.metadata = { sizes: sizeInfo };
    }

    const session = await stripe.checkout.sessions.create(sessionParams, opts);

    res.status(200).json({
      client_secret: session.client_secret,
      session_id: session.id,
      publishable_key: platformPublishable,
      stripe_account: merchantAccount,
      // Surfaces the merchant's shipping mode so the client knows whether to
      // wire up onShippingDetailsChange. Stripe rejects that handler unless
      // permissions[update_shipping_details]=server_only is also set on the
      // session, which only happens in USPS mode above.
      shipping_method: shipping.method || null,
    });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({
      error: 'Failed to create checkout session',
      detail: err.message,
      type: err.type || null,
    });
  }
};
