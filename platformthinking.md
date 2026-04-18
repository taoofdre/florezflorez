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

## Analytics & Ad Performance — Platform Strategy

### Why Not Self-Hosted Web Analytics

Self-hosted analytics platforms (Umami, Plausible, Ackee) all require a real database — analytics is high-frequency write data that can't live in git. Offering this as a platform feature means scaling another resource per tenant:

- A shared Umami/Postgres instance works at small scale but grows with every merchant's traffic. 100 merchants × 1,000 pageviews/day = 100K writes/day. Free database tiers get exhausted quickly, and a paid database adds operational cost that erodes margins at $5/month pricing.
- Per-merchant databases are not viable at this price point.
- Self-hosted analytics also adds operational burden (backups, uptime, storage monitoring) for something that isn't the platform's core value.

**Decision: skip self-hosted web analytics.** It doesn't fit the economics.

### Consolidated Ad Performance Dashboard (the better play)

Instead of general web analytics, surface **ad campaign performance data** from the platforms merchants are already using to drive traffic. The target merchants are small makers running Instagram, TikTok, and Google ads — they want to know "is my ad working?" not "what's my bounce rate?"

**Supported platforms:**
- **Meta** — Marketing API (free, OAuth connect, read campaign spend/reach/clicks/purchases/ROAS)
- **Google** — Google Ads API (free, developer token required, read campaign performance)
- **TikTok** — TikTok Marketing API (free, OAuth connect, read campaign metrics)
- **Reddit** — Reddit Ads API (free, more limited but growing)

**How it works:**
1. During onboarding, merchants connect their ad accounts via OAuth (similar to Stripe Connect flow)
2. The CMS admin page calls each platform's API on demand to pull performance metrics
3. Display a unified dashboard: spend, clicks, add-to-carts, purchases, and ROAS — side by side across all platforms
4. **No database needed** — all data is read from the ad platform APIs on page load, not stored locally

**Cost to the platform:** Zero per merchant. All ad platform APIs are free to read. Data lives on Meta/Google/TikTok/Reddit's servers.

**Why this is a differentiator:** Shopify doesn't consolidate ad data in their admin — merchants have to check Meta Ads Manager, Google Ads, and TikTok Ads separately. A clean, unified view of "I spent $200 this month across three platforms, here's where my 15 purchases came from" is something no small-merchant tool does well today.

### Ad Creation — On-Platform, Not In Our Admin

All four ad platforms offer APIs for programmatic campaign creation. However, building a unified ad creator is not viable as an early feature:

- Each platform's ad creation is a product unto itself — audience targeting, bid strategies, creative formats, and placement options differ wildly across platforms
- Merchants already know how to create ads on-platform (boosting an Instagram post, setting up a TikTok ad)
- The real unmet need is understanding performance across platforms, not creating ads from a different UI

**v1:** Read-only consolidated dashboard. Pull metrics, show them cleanly, no database.
**Future (v2/v3):** Consider simple "boost this product" flows that create basic campaigns with sensible defaults on Meta/TikTok — but only after validating merchant demand.

---

## Affiliate Program

### How It Works

Merchants create affiliate links (e.g., `mystore.com?ref=creator123`) and set a revenue share percentage per creator. Creators share the link, and when a purchase happens, the affiliate's cut is paid out automatically via Stripe.

**Flow:**
1. Merchant creates an affiliate link in the CMS admin — generates a unique `ref` code, sets commission rate
2. Creator connects their Stripe account via Stripe Connect Express (lightweight onboarding, Stripe handles tax forms)
3. Customer clicks the affiliate link — the `ref` param is stored in a cookie or localStorage
4. At checkout, the `ref` value is passed as metadata on the Stripe session
5. After successful purchase, Stripe transfers the affiliate's cut to their connected account

### No-Database Approach (Recommended for v1)

Affiliate metadata (ref codes, creator names, commission rates) lives in JSON in the merchant's repo — same git-based pattern as product content. Conversion tracking leans entirely on Stripe:

- Every checkout session includes the `ref` code in its metadata
- The admin dashboard queries Stripe's API for sessions with affiliate metadata
- Shows: conversions, revenue, and payout amount per affiliate
- Payouts happen via Stripe transfers API after successful charges

**What this gives you:** Link generation, automatic payouts, conversion tracking, per-affiliate revenue dashboards — all without a database.

**What you lose:** Click-through rates. Without a database to log click events, you only see conversions, not clicks. For most small merchants this is fine — they care about "how much revenue did this creator drive?" not click-through rates. If click tracking becomes important later, a minimal Supabase table (one row per click) would add it cheaply.

### Stripe Implementation

Creators onboard as Stripe Connect Express accounts (same pattern as merchant onboarding). After a referred purchase:

```javascript
await stripe.transfers.create({
  amount: Math.round(orderTotal * affiliatePercent),
  currency: 'usd',
  destination: affiliateStripeAccountId,
}, {
  stripeAccount: merchantStripeAccountId
});
```

### Tax Reporting (1099s)

Stripe handles all 1099 issuance and IRS filing for Connect accounts. The platform does not issue any 1099s itself.

- **Store owners:** Stripe issues 1099-K forms for sales revenue to any merchant exceeding IRS thresholds ($600/year)
- **Affiliate creators:** Stripe tracks transfers made via `stripe.transfers.create()` and includes them in 1099 reporting automatically
- **Requirement:** Use Express or Standard Connect account types (not Custom). Custom accounts shift the tax reporting burden to the platform. Express is the right choice for both merchants and affiliates — lightest onboarding, Stripe collects W-9/tax info, Stripe handles all compliance.

### Why This Is a Differentiator

Shopify merchants need third-party affiliate apps ($30-49/month). Offering built-in affiliate tracking with automatic tax reporting at $5/month total is a strong selling point for the creator-economy merchants this platform targets.

---

## Instagram Import — Product Listing from Posts

### How It Works

Merchants connect their Instagram Business account via Meta OAuth. They paste an Instagram post URL into the admin panel, and the platform pulls the images and caption to pre-populate a product listing.

**Flow:**
1. Merchant connects Instagram during onboarding (same Meta OAuth used for the ad performance dashboard)
2. In the product editor, merchant pastes an Instagram post URL
3. Admin calls the Instagram Graph API to fetch the post's media and caption
4. Images are downloaded, cropped/resized, and uploaded to R2
5. Caption text pre-fills the product description field
6. Merchant reviews, sets price/sizes/stock, and publishes

### Instagram Graph API Details

**Required endpoints:**
- `GET /me/media` — list merchant's posts (for a browse/picker UI later)
- `GET /{media-id}?fields=caption,media_url,media_type,children` — fetch a single post's data
- For carousel posts: `GET /{media-id}/children?fields=media_url,media_type` — fetch all images in a multi-image post

**Required permissions:**
- `instagram_basic` — read profile and media
- `instagram_content_publish` is NOT needed (read-only)

**Access requirements:**
- Facebook App (shared across the platform, same app used for ad dashboard)
- Merchant must have an Instagram Business or Creator account (not Personal)
- App must pass Facebook App Review for `instagram_basic` permission

### What Gets Imported

| Instagram field | Maps to | Notes |
|---|---|---|
| `media_url` (images) | `images[].src` | Downloaded, resized to 1000x1000, converted to WebP, uploaded to R2 |
| `caption` | `description` | Pre-filled, merchant can edit before saving |
| Carousel children | Multiple `images[]` entries | Each carousel image becomes a product image |
| Video posts | Skipped or thumbnail only | Product listings are image-based |

### What the Merchant Still Sets Manually
- Title (Instagram captions aren't titles)
- Price
- Sizes and stock
- Category
- For-sale toggle

### Platform Implications

- **Single Meta OAuth flow** serves both the ad performance dashboard and Instagram import — one connection, two features
- **No per-merchant cost** — Instagram Graph API is free to read
- **Token storage:** Long-lived tokens (60 days) stored as env vars or in provisioning metadata, auto-refreshed
- **Rate limits:** 200 calls/user/hour — more than enough for importing a few posts per session

### Why This Is a Differentiator

Small makers and artisans already showcase products on Instagram before listing them anywhere. "Import from Instagram" removes the friction of re-uploading photos and rewriting descriptions. Shopify has this via third-party apps ($10-30/month). Offering it built-in at $5/month total is a strong selling point.

---

## GitHub Architecture — GitHub App Model

### The Problem

The current CMS authenticates via GitHub OAuth — the store owner logs in with GitHub, gets a token, and uses it to read/write their repo. This works for a developer but not for target merchants (artisans, small makers). Requiring a GitHub account to sell jewelry kills onboarding conversion.

### The Solution: GitHub App + Platform Auth

Register a **GitHub App** on a platform-owned GitHub org. Merchants never interact with GitHub — they log into the platform with email, and the GitHub App handles all repo operations behind the scenes.

### One-Time Platform Setup

1. Create a GitHub org (e.g., `florezflorez-stores`)
2. Register a GitHub App on that org
3. Install the app on the org with write access to all repos
4. Store the app's private key as a platform secret

### Merchant Onboarding Flow

1. Merchant signs up with email — no GitHub account needed
2. Provisioning API creates a repo from the template in the platform org (e.g., `florezflorez-stores/merchant-name`)
3. The GitHub App auto-has access (installed on the org)
4. Merchant logs into their admin via **platform auth** (magic link or email/password)
5. When admin reads/writes content, the platform backend generates a short-lived GitHub App installation token and proxies the request

**What the merchant experiences:** Sign up, pick a store name, connect Stripe, start adding products. They never see the word "GitHub."

### Architecture Change from Current Model

| Current (Florez Florez) | Platform (GitHub App) |
|---|---|
| Admin sends GitHub OAuth token directly to GitHub API | Admin sends platform session token to platform API, which uses GitHub App token |
| Merchant needs a GitHub account | Merchant needs only an email |
| Merchant's GitHub token stored in browser | GitHub App token generated server-side, never exposed to client |
| `/api/upload.js` receives merchant's GitHub token | Upload goes to R2 (no GitHub involvement for images) |
| Product save writes JSON via merchant's GitHub token | Product save goes through platform API → GitHub App token → GitHub |
| Merchant directly owns their GitHub repo | Platform org owns repos; merchant owns their data conceptually |

### Merchant Auth

Since the platform already uses Stripe for billing, auth can be lightweight:

- **Magic link login** (email a login link, no password) — cheapest to build, lowest friction for non-technical merchants
- **Session management:** JWTs or simple cookies
- **Stripe Customer Portal** for account/billing management
- GitHub OAuth is eliminated entirely as a merchant-facing flow

### Data Ownership & Export

With repos under the platform org, merchants don't directly own their repo. To address this:

- Provide a **data export** feature in the admin (download content JSON + images as a zip)
- This is a standard platform practice (Shopify, Squarespace all do this)
- For the target market ($5/month artisans), direct GitHub access is not a selling point

### GitHub App Token Details

- GitHub Apps generate **installation access tokens** (valid for 1 hour)
- The platform backend requests a token when needed: `POST /app/installations/{id}/access_tokens`
- Tokens can be scoped to specific repos for extra security
- No long-lived tokens stored — generated on demand from the app's private key
- Rate limit: 5,000 requests/hour per installation (more than enough)

---

## Merchant Onboarding Flow

### Step 1: Account + Payment
- Email address (becomes their login via magic link)
- Store name (e.g., "Luna Silver Studio")
- Choose plan: $5/month or $50/year
- Stripe Checkout for platform subscription (on the platform's own Stripe account)
- **Nothing is provisioned until payment succeeds**

### Step 2: Branding
- Upload logo
- Pick color palette (gradient pairs — offer presets or a picker)
- Font choice (offer 3-4 curated options, default IBM Plex Mono)

### Step 3: Categories
- Choose or name their product categories (e.g., "Rings, Necklaces, Bracelets")
- Minimum 1, add more later
- Optional: upload a background image per category (or skip, use gradient-only)

### Step 4: Connect Stripe
- Stripe Connect OAuth flow (separate from the platform subscription in Step 1)
- This connects their payout account — where their sales revenue goes
- Stripe handles bank account setup, identity verification, tax info

### Step 5: Store is Live
- Show them their URL: `luna-silver-studio.florezflorez.com`
- Empty store with their branding — ready for products
- CTA: "Add your first product"

### What Happens Behind the Scenes

| After step | Platform provisions |
|---|---|
| 1. Payment succeeds | Create merchant record in platform DB, create Stripe Billing subscription |
| 2. Branding submitted | Upload logo to R2 |
| 3. Categories chosen | Hold in memory (not written yet — no repo exists) |
| 4. Stripe connected | Store `stripe_account_id` in platform DB |
| 5. Store goes live | Create repo from template via GitHub App, write `homepage.json` + `settings.json` + empty category JSONs, create R2 bucket, create Vercel project, set all env vars, deploy |

All provisioning happens in one batch at the end. Steps 1-4 collect inputs; Step 5 builds everything.

### What Merchants Configure Later (in their admin)

- Add/edit/delete products (with optional Instagram import)
- Shipping settings (defaults: US only, free over $200)
- Meta Pixel ID for tracking
- Connect Instagram for product import + ad dashboard
- Connect ad platforms (Google, TikTok, Reddit) for consolidated dashboard
- Set up affiliate program
- Request custom domain
- Update branding (logo, colors, font)

---

## Build Order

1. **Generalize the template** — remove hardcoded repo names, domains, credentials. Everything merchant-specific becomes an env var.
2. **Migrate images to Cloudflare R2** — eliminate deploy-per-image, serve via `img.florezflorez.com`.
3. **Register GitHub App + create platform org** — foundation for all merchant repo management.
4. **Stripe Connect onboarding** — OAuth flow, store `stripe_account_id`, update checkout to use `stripe-account` header.
5. **Platform auth (magic link)** — replace GitHub OAuth with email-based merchant login.
6. **Provisioning API** — repo creation via GitHub App + Vercel project creation + R2 bucket + env var injection.
7. **Platform landing page + signup flow.**
8. **Subdomain routing.**
9. **Custom domain support.**
10. **Template update mechanism.**

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
| Shop template | Vanilla JS + custom git-based CMS |
| Hosting per merchant | Vercel (one project per repo) |
| Content per merchant | GitHub (one repo per merchant, under platform org) |
| Image storage | Cloudflare R2 (one bucket per merchant, custom domain) |
| Repo management | GitHub App (platform-owned, server-side tokens) |
| Merchant auth | Magic link (email-based, no GitHub account needed) |
| Payments | Stripe Connect (Standard accounts) |
| Platform database | Postgres (provisioning metadata only) |
| Platform app | Next.js or similar |
| Merchant billing | Stripe Billing (platform's own Stripe account) |

---

## Local Development & Project Structure

### Two Separate Projects

The platform has two distinct codebases that live in separate repos and deploy independently:

```
~/Documents/
├── ururu/                  # Platform app (ururu.store)
│   ├── app/                # Next.js marketing site + provisioning API
│   ├── api/                # Provisioning, auth, billing endpoints
│   └── ...
│
└── florezflorez/           # Shop template (what gets forked per merchant)
    ├── admin/              # Merchant admin panel
    ├── api/                # Checkout, upload, stripe-sync (per-merchant)
    ├── content/            # Product data, settings (per-merchant)
    ├── js/                 # Storefront JS
    └── ...
```

**ururu/** is the corporate platform — it owns:
- Marketing site at `ururu.store`
- Signup/onboarding flow
- Provisioning API (creates repos, Vercel projects, R2 buckets)
- Platform auth (magic link login)
- Stripe Billing ($5/month subscriptions)
- GitHub App credentials (private key for repo management)

**florezflorez/** is the shop template — it becomes:
- The repo that gets forked for each merchant
- `florezflorez.com` is merchant #1 (Florez Florez the jewelry store)
- Every new merchant gets a copy of this repo under the platform org

### Domain Architecture

| Domain | Purpose | Hosting |
|---|---|---|
| `ururu.store` | Platform marketing site + onboarding | Vercel (single project) |
| `[store].ururu.store` | Merchant storefronts (wildcard subdomain) | Vercel (one project per merchant) |
| `img.ururu.store` | Shared image CDN for all merchants | Cloudflare R2 (single bucket or per-merchant buckets) |
| `florezflorez.com` | Florez Florez store (merchant #1, custom domain) | Vercel (points to florezflorez's project) |

### DNS & Cloudflare Setup

**ururu.store** (Cloudflare):
- `A` / `CNAME` → Vercel (platform app)
- `*.ururu.store` → Vercel wildcard (merchant subdomains)
- `img.ururu.store` → R2 bucket custom domain

**florezflorez.com** (already on Cloudflare):
- Stays as-is, pointing to its own Vercel project
- `img.florezflorez.com` → R2 (Florez Florez's own images, migrated)

### Image Storage Decision

Two options for R2 at scale:

**Option A: Single shared bucket at `img.ururu.store`**
- All merchant images in one bucket, namespaced by store: `img.ururu.store/{store-slug}/filename.webp`
- Simpler provisioning (no per-merchant bucket creation)
- Single CDN domain
- Risk: one bucket's rate limits shared across all merchants

**Option B: Per-merchant buckets**
- Each merchant gets their own bucket: `{store-slug}-uploads`
- Isolated rate limits and storage quotas
- More provisioning complexity
- Each bucket can use the shared `img.ururu.store` domain with path-based routing, or merchant-specific subdomains

**Recommendation: Option A for MVP.** Single bucket with path namespacing. The R2 free tier (10GB storage, 10M reads/month) is per-account not per-bucket, so multiple buckets don't help with limits. Switch to per-merchant buckets only if you hit isolation issues.

### Wildcard Subdomain Routing on Vercel

Vercel supports wildcard domains on Pro plans. Each merchant's Vercel project gets assigned `{store-slug}.ururu.store`:

```
Provisioning step:
1. Create Vercel project from template repo
2. Add domain: luna-silver.ururu.store → project
3. Vercel handles SSL automatically
```

For custom domains (e.g., `florezflorez.com`):
- Merchant adds a CNAME pointing to `cname.vercel-dns.com`
- Platform API calls Vercel to add the domain to their project
- Vercel handles SSL via Let's Encrypt

### Local Development Workflow

**Working on the shop template (florezflorez/):**
```bash
cd ~/Documents/florezflorez
npx serve . -l 3000
# Open http://localhost:3000 for storefront
# Open http://localhost:3000/admin for admin panel
```

**Working on the platform (ururu/):**
```bash
cd ~/Documents/ururu
npm run dev
# Open http://localhost:3001 for platform site
# Provisioning API available at localhost:3001/api/...
```

**Testing provisioning end-to-end:**
The platform's provisioning API creates real GitHub repos and Vercel projects — this can't be fully tested locally. Use a staging environment:
- Staging GitHub org (e.g., `ururu-staging`)
- Staging Vercel team
- Staging Stripe account (test mode)
- Platform dev server points to staging services

### Migration Path: Florez Florez → Platform Merchant

When the platform launches, Florez Florez transitions from "the product" to "merchant #1":

1. Move the florezflorez repo under the platform org (`ururu-stores/florezflorez`)
2. Install the GitHub App on it
3. Replace GitHub OAuth in admin with platform auth
4. Update R2 URLs from `img.florezflorez.com` to `img.ururu.store/florezflorez/` (or keep custom domain)
5. `florezflorez.com` custom domain stays, just points to the Vercel project under the platform
6. Create merchant record in platform DB with existing Stripe account ID

The template repo becomes a clean, generalized version without Florez Florez-specific content.
