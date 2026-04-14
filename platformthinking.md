# Platform Thinking — Florez Florez → SaaS Shopping Platform

## The Vision

Build a multi-tenant shopping platform powered by Stripe that charges merchants $5/month — dramatically cheaper than Shopify ($29/month) or Wix/Squarespace ($23-40/month). Merchants only pay the flat fee plus standard Stripe transaction fees (2.9% + $0.30). No platform markup on transactions beyond a small application fee.

Target: small makers, artisans, independent sellers who don't need the full Shopify feature set but want a real storefront.

---

## Architecture: Fork-Based Provisioning (Not Traditional Multi-Tenancy)

Instead of one database with tenant isolation, the platform is a **provisioner**. Each merchant gets their own isolated instance:

- Their own GitHub repo (fork of the template)
- Their own Vercel project
- Their own Stripe account (connected via Stripe Connect)
- Their own subdomain (or custom domain)

The platform's job is connecting these pieces together. After provisioning, the merchant's shop is self-contained. Their content lives in their GitHub, their store runs on Vercel, their money goes to their Stripe.

---

## What the Platform Needs to Build

### 1. The Platform App (separate from the shop template)
- Signup/onboarding: GitHub OAuth → fork repo → Stripe Connect → provision Vercel → assign URL
- Thin database — provisioning metadata only (not merchant content):
  ```
  merchants: {
    github_username,
    repo_name,
    vercel_project_id,
    stripe_account_id,
    subscription_status
  }
  ```
- Provisioning API: orchestrates GitHub fork, Vercel project creation, env var injection
- Billing: Stripe Billing on the platform's own Stripe account ($5/month subscriptions)
- Subdomain routing: merchant.yourplatform.com

### 2. The Shop Template (what gets forked — the current Florez Florez codebase, generalized)
- Decap CMS config reads repo from the fork's own settings
- Serverless functions use the platform's Stripe key + merchant's connected account ID
- All hardcoded references (repo names, domains) replaced with env vars

---

## Stripe Architecture — Critical Detail

**Do not store each merchant's Stripe secret key in their fork's env vars.**

Use Stripe Connect's `stripe-account` header pattern instead:

```javascript
// In every merchant's /api/checkout.js
const stripe = new Stripe(process.env.PLATFORM_STRIPE_KEY); // same key in every fork

const session = await stripe.checkout.sessions.create({
  // ...line_items, shipping, etc.
}, {
  stripeAccount: process.env.MERCHANT_STRIPE_ACCOUNT_ID, // e.g. acct_1ABC...
  application_fee_amount: Math.round(totalCents * 0.005), // 0.5% platform fee
});
```

This means:
- Every fork has the **same** platform Stripe key — update once, applies everywhere
- `MERCHANT_STRIPE_ACCOUNT_ID` is the only merchant-specific credential
- Money flows directly to the merchant's Stripe account
- Platform collects a small % application fee on every transaction (on top of $5/month)
- Merchant never touches API keys — they connect Stripe via OAuth during onboarding

This is how Shopify, Squarespace, and every serious platform handles Stripe.

---

## Key Challenges

### 1. Template Updates (hardest long-term problem)
When the template gets a bug fix or new feature, existing merchant forks don't automatically receive it. Options:
- Automated PRs from template → each fork via GitHub API
- Keep "core" JS/CSS loaded from a platform CDN (outside the fork)
- Accept slower update propagation early, solve properly later

### 2. Vercel Costs at Scale
Each merchant = one Vercel project. Model this early:
- Vercel Pro: ~$20/month for team account, usage-based beyond that
- Estimated ~$0.10–$0.40/month per low-traffic merchant project
- Margins are tight at small scale, improve as you grow
- At 500+ merchants: evaluate Vercel Enterprise or self-hosted deployment

### 3. Decap CMS OAuth Across Custom Domains
GitHub OAuth apps require pre-registered callback URLs — no wildcards supported. If a merchant uses `mystore.com`, the CMS OAuth flow breaks.

**Solution:** Route all OAuth callbacks through `auth.yourplatform.com` — a single proxy that all merchants use regardless of their custom domain. The storefront can be at any domain; the CMS is always accessed via the platform's auth proxy.

### 4. Provisioning Reliability
Forking a repo + creating a Vercel project + setting env vars + mapping a subdomain + completing Stripe Connect OAuth — all in sequence, with error handling and rollback if anything fails midway — is the hardest part of the MVP to get right. This IS the core product.

---

## Why This Model Works

The key insight: **the platform is a provisioner, not a host of content.** This sidesteps almost all hard multi-tenancy problems:

- No shared database for merchant content (each repo is isolated)
- No content isolation bugs
- Merchant truly owns their data (it's in their GitHub)
- Decap CMS works naturally per-fork
- No complex tenant-aware query logic

The platform's database only stores provisioning metadata — a fraction of what a traditional multi-tenant SaaS requires.

---

## Unit Economics (rough)

| Revenue | |
|---|---|
| Subscription | $5.00/merchant/month |
| Transaction fee (0.5% on $1,000 GMV) | ~$5.00/merchant/month |
| **Total per merchant** | **~$10/month** |

| Costs | |
|---|---|
| Vercel (est. per merchant) | ~$0.25/month |
| Stripe Connect fees | negligible |
| Platform infrastructure | amortized |
| **Net margin** | **high at scale** |

---

## Dynamic Shipping with USPS

### How It Works

Use the USPS API to calculate real shipping rates after the customer enters their address during Stripe Checkout. This replaces flat-rate shipping with accurate, per-order pricing based on package weight, dimensions, and destination.

**Flow using Stripe's `onShippingDetailsChange` callback:**

1. Customer starts checkout, enters their shipping address
2. Stripe fires `onShippingDetailsChange` with the address
3. Your callback calls the USPS rate API with package details + destination zip
4. Return the calculated shipping options to Stripe for the customer to see

```javascript
onShippingDetailsChange(address) {
  const uspsRate = await getUSPSRate(address, packageDetails);

  if (cartTotal >= 20000) { // $200 in cents
    return {
      shippingOptions: [
        { name: "Free Shipping", amount: 0 }
      ]
    };
  }

  return {
    shippingOptions: [
      { name: `USPS ${uspsRate.service}`, amount: uspsRate.price }
    ]
  };
}
```

### Free Shipping on Orders Over $200

The free shipping decision happens inside the same `onShippingDetailsChange` callback, before the customer ever sees shipping options:

- **Cart >= $200** → return a single option: "Free Shipping" at $0. The platform absorbs the real USPS cost.
- **Cart < $200** → return the real USPS rates for the customer to pay.

Even when shipping is free, you still need the customer's address to fulfill the order. You can also still calculate the real USPS cost internally for margin tracking — just don't charge the customer for it.

**Important margin consideration:** Unlike a flat $10 coupon, free shipping means absorbing whatever USPS returns — could be $8 or $22 depending on weight and destination. Consider capping it (e.g., free shipping up to $15, customer pays the difference) to protect margins on heavy or distant orders.

### Platform Implications (Stripe Connect)

In the multi-tenant model, each merchant configures their own:
- Product weights and dimensions
- Free shipping threshold (if any)
- Whether to offer free shipping at all

The USPS rate call and free shipping logic live in the merchant's checkout serverless function. The platform template provides the wiring; merchants customize the thresholds via env vars or CMS config.

---

## Build Order

1. **Generalize the template** — remove hardcoded repo names, domains, credentials. Everything merchant-specific becomes an env var.
2. **Stripe Connect onboarding** — OAuth flow, store `stripe_account_id`, update checkout to use `stripe-account` header.
3. **Provisioning API** — GitHub fork + Vercel project creation + env var injection.
4. **Platform landing page + signup flow.**
5. **Subdomain routing.**
6. **Custom domain support** with OAuth proxy for Decap CMS.
7. **Template update mechanism.**

---

## Relationship to Current Florez Florez Site

The current site is the template. Finish it cleanly with the platform in mind:
- Replace hardcoded values with env vars
- The Decap → Stripe sync complexity (currently being worked on) becomes trivial on the platform — Stripe calls happen against the merchant's connected account, price IDs live in their repo's JSON

Florez Florez itself becomes merchant #1 on the platform once it launches.

---

## Stack Recommendation

| Layer | Technology |
|---|---|
| Shop template | Vanilla JS + Decap CMS (current) |
| Hosting per merchant | Vercel (one project per fork) |
| Content per merchant | GitHub (one repo per fork) |
| Payments | Stripe Connect (Standard accounts) |
| Platform database | Supabase (Postgres — just for provisioning metadata) |
| Platform app | Next.js or similar |
| Auth proxy for CMS | Single Vercel function at auth.platform.com |
| Merchant billing | Stripe Billing (platform's own Stripe account) |
