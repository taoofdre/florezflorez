const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify GitHub token for auth
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  const token = authHeader.replace('Bearer ', '');
  const userRes = await fetch('https://api.github.com/user', {
    headers: { 'Authorization': 'token ' + token },
  });
  if (!userRes.ok) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const rates = await stripe.shippingRates.list({ active: true, limit: 20 });

    const result = rates.data.map(r => ({
      id: r.id,
      display_name: r.display_name,
      type: r.type,
      amount: r.fixed_amount ? r.fixed_amount.amount : null,
      currency: r.fixed_amount ? r.fixed_amount.currency : null,
    }));

    res.status(200).json({ rates: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
