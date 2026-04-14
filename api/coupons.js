const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // GET — list active promotion codes with their coupons
  if (req.method === 'GET') {
    try {
      const promoCodes = await stripe.promotionCodes.list({ active: true, limit: 50, expand: ['data.coupon'] });
      const results = promoCodes.data.map(pc => ({
        id: pc.id,
        code: pc.code,
        active: pc.active,
        coupon_id: pc.coupon.id,
        coupon_name: pc.coupon.name || '',
        percent_off: pc.coupon.percent_off,
        amount_off: pc.coupon.amount_off,
        currency: pc.coupon.currency,
        duration: pc.coupon.duration,
        duration_in_months: pc.coupon.duration_in_months,
        max_redemptions: pc.max_redemptions,
        times_redeemed: pc.times_redeemed,
        expires_at: pc.expires_at,
        created: pc.created,
      }));
      res.status(200).json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // POST — create a coupon + promotion code
  if (req.method === 'POST') {
    const { code, name, discount_type, amount, percent, duration, duration_in_months, max_redemptions, expires_at } = req.body || {};

    if (!code) return res.status(400).json({ error: 'Promotion code is required' });
    if (!discount_type) return res.status(400).json({ error: 'Discount type is required' });

    try {
      // Build coupon params
      const couponParams = {
        name: name || code.toUpperCase(),
        duration: duration || 'once',
      };
      if (duration === 'repeating' && duration_in_months) {
        couponParams.duration_in_months = parseInt(duration_in_months);
      }
      if (discount_type === 'percent') {
        couponParams.percent_off = parseFloat(percent);
      } else {
        couponParams.amount_off = Math.round(parseFloat(amount) * 100);
        couponParams.currency = 'usd';
      }

      const coupon = await stripe.coupons.create(couponParams);

      // Build promotion code params
      const promoParams = { coupon: coupon.id, code: code.toUpperCase() };
      if (max_redemptions) promoParams.max_redemptions = parseInt(max_redemptions);
      if (expires_at) promoParams.expires_at = Math.floor(new Date(expires_at).getTime() / 1000);

      const promoCode = await stripe.promotionCodes.create(promoParams);

      res.status(200).json({
        id: promoCode.id,
        code: promoCode.code,
        coupon_id: coupon.id,
        coupon_name: coupon.name,
        percent_off: coupon.percent_off,
        amount_off: coupon.amount_off,
        currency: coupon.currency,
        duration: coupon.duration,
        max_redemptions: promoCode.max_redemptions,
        expires_at: promoCode.expires_at,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // DELETE — deactivate a promotion code
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Promotion code ID is required' });

    try {
      await stripe.promotionCodes.update(id, { active: false });
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
