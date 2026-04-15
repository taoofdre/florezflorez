const Stripe = require('stripe');

const REPO = process.env.GITHUB_REPO || 'taoofdre/florezflorez';
const SPECIAL_SECTIONS = ['consulting', 'about'];

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: {
      'Authorization': 'token ' + process.env.GITHUB_PAT,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}`);
  return res.json();
}

async function ghPut(path, content, sha, message) {
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + process.env.GITHUB_PAT,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({ message, content: encoded, sha, branch: 'main' }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT ${path} → ${d.message || res.status}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return res.status(400).json({ error: 'Missing Stripe signature or STRIPE_WEBHOOK_SECRET env var' });
  }

  const rawBody = await getRawBody(req);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  if (!process.env.GITHUB_PAT) {
    console.error('GITHUB_PAT not configured — stock not updated');
    return res.status(200).json({ received: true });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
      expand: ['line_items'],
    });

    const lineItems = session.line_items?.data || [];
    if (!lineItems.length) return res.status(200).json({ received: true });

    // Build price ID → quantity sold map
    const sold = {};
    for (const item of lineItems) {
      sold[item.price.id] = (sold[item.price.id] || 0) + item.quantity;
    }

    // Load categories dynamically from homepage.json
    let contentFiles = ['content/art.json', 'content/necklaces.json', 'content/rings.json'];
    try {
      const hpFile = await ghGet('content/homepage.json');
      const hpData = JSON.parse(Buffer.from(hpFile.content.replace(/\n/g, ''), 'base64').toString('utf8'));
      if (hpData.categories && hpData.categories.length > 0) {
        contentFiles = hpData.categories
          .filter(c => !SPECIAL_SECTIONS.includes(c.slug))
          .map(c => 'content/' + c.slug + '.json');
      }
    } catch (e) {}

    for (const filePath of contentFiles) {
      try {
        const file = await ghGet(filePath);
        const decoded = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
        const data = JSON.parse(decoded);
        let changed = false;

        for (const piece of (data.pieces || [])) {
          const qty = sold[piece.stripe_price_id];
          if (qty && typeof piece.stock === 'number') {
            piece.stock = Math.max(0, piece.stock - qty);
            changed = true;
          }
        }

        if (changed) {
          await ghPut(filePath, JSON.stringify(data, null, 2) + '\n', file.sha, 'Update stock after sale');
        }
      } catch (err) {
        console.error(`Stock update failed for ${filePath}:`, err.message);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    // Return 200 so Stripe doesn't keep retrying — error is logged for investigation
    return res.status(200).json({ received: true });
  }
};
