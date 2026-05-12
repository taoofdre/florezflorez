# Platform Thinking — Florez Florez → SaaS Shopping Platform

## The Vision

Build a multi-tenant shopping platform powered by Stripe that charges merchants $5/month — dramatically cheaper than Shopify ($29/month) or Wix/Squarespace ($23-40/month). Merchants only pay the flat fee plus standard Stripe transaction fees (2.9% + $0.30). No platform markup on transactions.

Target: small makers, artisans, independent sellers who don't need the full Shopify feature set but want a real storefront.

---

## Architecture: Multi-Tenant Cloudflare Worker

One Cloudflare Worker serves every merchant. Tenant is resolved per request via hostname → Cloudflare KV → R2 content prefix. Per-merchant content (`settings.json`, `homepage.json`, category JSONs) lives in a single shared R2 bucket under per-merchant prefixes; per-merchant images live in a separate R2 bucket on the same prefix shape. Platform admin (signup, dashboard, provisioning) is a Next.js app on Vercel at `ururu.store`.

**The platform is a provisioner, not a host of content** — but in the multi-tenant Worker sense rather than the original fork-based sense. Merchant content is namespaced in R2; the Worker reads the right prefix per request based on the hostname it received.

| Layer | Implementation |
|---|---|
| Storefront runtime | One Cloudflare Worker (`ururu-storefront`), Hono, serves every merchant |
| Tenant routing | Wildcard `*.ururu.store/*` Workers Route → Worker reads hostname → KV `MERCHANT_INDEX` lookup |
| Per-merchant content | R2 bucket `ururu-content`, keys `<slug>/content/<file>.json` |
| Per-merchant images | R2 bucket `ururu-images`, keys `<slug>/<filename>`, served via `img.ururu.store` (the Worker proxies these too) |
| Platform admin | Next.js on Vercel at `ururu.store` |
| Platform DB | Turso (libSQL) — provisioning metadata + drafts only |
| Auth | Magic link + WebAuthn passkeys |
| Payments | Stripe Connect (Standard, `stripeAccount` header pattern) |

---

## What's Different vs the Original Fork Plan

The first cut of this platform shipped with per-merchant GitHub forks + per-merchant Vercel projects (one fork + one project per merchant). It worked, but unit economics broke down past ~100 merchants — mostly Vercel bandwidth + build minutes scaling linearly with merchant count, plus operational chores ("update template across N forks") becoming the bottleneck.

The migration to a single multi-tenant Worker happened in 7 phases through 2026-04 to 2026-05. After Phase 6 cutover, florezflorez (merchant #1) serves entirely from the Worker; per-merchant Vercel projects and GitHub forks are gone. Phase 7 deleted the legacy code paths.

What's preserved from the original plan:
- Stripe Connect direct charges with the `stripeAccount` header (every merchant uses the platform's Stripe key, only `stripe_account_id` is per-merchant)
- Per-merchant Stripe accounts via Connect Standard onboarding
- Magic-link platform auth (no GitHub account required for merchants)
- Cloudflare R2 for image storage
- The `[store].ururu.store` subdomain pattern

What changed:
- No GitHub fork per merchant. The Worker bundle is the template.
- No Vercel project per merchant. One Worker serves everyone.
- No per-merchant Decap CMS / git OAuth flow. The platform admin writes directly to R2.
- No `application_fee_amount`. The platform takes nothing on top of Stripe's standard rates; revenue is purely the $5/mo or $50/yr subscription.

---

## Stripe Architecture (unchanged)

Use Stripe Connect's `stripeAccount` header pattern:

```javascript
const stripe = new Stripe(env.PLATFORM_STRIPE_SK);

const session = await stripe.checkout.sessions.create(
  { /* line_items, shipping, etc. */ },
  { stripeAccount: merchant.stripe_account_id }
);
```

The Worker holds the platform's Stripe secret as a Wrangler secret. The connected account ID lives in the KV `MERCHANT_INDEX` entry alongside the tenant's slug + store name. Money flows directly to the merchant's Stripe account; the platform takes nothing on top.

When a merchant completes Stripe Connect, the platform admin's callback updates the DB row and mirrors the new `stripe_account_id` into the KV entry (`refreshMerchantIndex`).

---

## Provisioning Flow

A new merchant onboarding is a flat KV + R2 write:

1. **Sign up + payment** — magic link, $5/mo or $50/yr (30-day free trial), Stripe Billing on the platform's account.
2. **Brand + categories + Stripe Connect** — collected through the dashboard.
3. **Provision** (`provisionMerchantOnCloudflare`):
   - Write starter `settings.json` + `homepage.json` to R2 `ururu-content/<slug>/content/`
   - Write `<slug>.ururu.store` → identity entry to KV `MERCHANT_INDEX`
   - Set `merchant.custom_domain` = `<slug>.ururu.store`, status = `live`
4. **Live**. Once the KV entry exists the wildcard Workers Route catches the merchant's hostname and the Worker resolves them.

No per-merchant API calls beyond R2 + KV. No GitHub fork, no Vercel project, no env-var injection. The same Worker bundle serves every merchant — bug fixes and feature ships happen via a single `wrangler deploy` instead of a per-merchant fork update.

---

## Publish Flow (drafts → R2)

Dashboard form edits are staged into a `draft_changes` table in the platform DB. A "publish" action validates the daily cap (10/day per merchant), writes each draft to R2 in parallel, records a row in `publishes`, and clears the drafts. KV is read-through with ~60s eventual consistency globally; the storefront sees changes within a minute.

This replaced the original "git commit per publish" flow, which created separate auditable history but required per-merchant write tokens and tied publish frequency to GitHub rate limits.

---

## Key Challenges

### 1. KV is shared across dev + prod
There's a single `MERCHANT_INDEX` namespace bound to the storefront Worker. Both `.env.local` and `.env.production.local` point at the same namespace ID. Anything that writes the KV entry from a dev tool will overwrite the live entry — discovered the hard way during the Phase 6 cutover, when running the migration script against the dev DB clobbered prod's `store_name` and `stripe_account_id`. Fix: keep dev DB rows in lockstep with prod for any merchant whose KV entry is live.

### 2. img.ururu.store and Workers Routes
Adding a wildcard `*.ururu.store/*` route makes it intercept `img.ururu.store` too. The original "no script" carve-out approach for `img.ururu.store/*` doesn't actually skip Workers in current Cloudflare behavior. Fix: bind `ururu-images` directly to the Worker as the `IMAGES` R2 binding and have the Worker serve `img.ururu.store` requests itself. Trade-off is image fetches now bill Workers requests instead of the free Custom Domain path; cheaper than wrestling with carve-out semantics.

### 3. New-arch custom domain support is unbuilt
For a merchant who wants `mystore.com` instead of `mystore.ururu.store`, the legacy flow attached the domain to a per-merchant Vercel project. New-arch needs Cloudflare for SaaS / Custom Hostnames on the storefront Worker. Not yet built; the dashboard's custom-url page is currently a "coming back" stub.

### 4. Provisioning reliability
Both R2 PUT and KV PUT are individually idempotent, so partial failures roll forward cleanly on retry. Real failure modes are credentials being wrong or quota exceeded; surface those clearly in the onboarding UI rather than retrying silently.

---

## Unit Economics

| Revenue | |
|---|---|
| Subscription | $5.00/merchant/month (or $50/year) |
| **Total per merchant** | **$5/month** |

| Costs | |
|---|---|
| Cloudflare Workers Paid plan | $5/month flat across all merchants |
| R2 storage + reads | Negligible at small scale; class A ops priced sub-dollar at hundreds of merchants |
| Cloudflare KV | Free tier covers thousands of merchants |
| Vercel (platform admin only) | Hobby plan suffices for the admin app |
| Turso | Free tier through ~100 merchants |
| Stripe Connect fees | Negligible to the platform |
| **Net margin** | **High at scale** — costs are roughly flat past the Workers Paid floor |

Pre-migration the dominant cost was Vercel bandwidth + build minutes scaling per merchant (~$0.10–0.40/merchant/month). Post-migration it's flat-ish, dominated by the Workers $5/mo floor.

---

## Dynamic Shipping with USPS

USPS rates are calculated at checkout via Stripe's `onShippingDetailsChange` callback. The Worker's `/api/calculate-shipping-options` endpoint hits the USPS API, returns options, and Stripe updates the checkout session.

```javascript
onShippingDetailsChange(address) {
  const uspsRate = await getUSPSRate(address, packageDetails);

  if (cartTotal >= 20000) { // $200 in cents
    return { shippingOptions: [{ name: "Free Shipping", amount: 0 }] };
  }

  return {
    shippingOptions: [
      { name: `USPS ${uspsRate.service}`, amount: uspsRate.price }
    ]
  };
}
```

### Free Shipping Threshold
- Cart ≥ merchant-configured threshold → "Free Shipping" at $0 (platform absorbs the real USPS cost)
- Cart < threshold → real USPS rates passed through
- Even when free, the shipping address is collected for fulfillment.

### Per-Merchant Configuration
Each merchant configures their own shipping mode (free, flat, USPS, pickup), threshold (if any), and origin ZIP via the dashboard. The Worker reads these from the merchant's `settings.json` at request time.

---

## Analytics & Ad Performance — Platform Strategy

### No Self-Hosted Web Analytics
Self-hosted analytics (Umami, Plausible, Ackee) requires a real database with high write rate. At $5/month pricing the math doesn't work — adding a per-merchant Postgres or Clickhouse instance erodes margins fast. **Decision: skip self-hosted web analytics** in favor of platform-level Cloudflare Analytics on the Worker (free, no per-merchant cost, no DB).

### Consolidated Ad Performance Dashboard

Surface ad campaign performance from platforms merchants are already using:
- **Meta** — Marketing API (free, OAuth, read campaign spend/reach/clicks/purchases/ROAS)
- **Google** — Google Ads API (free, developer token required)
- **TikTok** — TikTok Marketing API (free, OAuth)
- **Reddit** — Reddit Ads API (free)

**How it works:**
1. Merchant connects ad accounts via OAuth during onboarding (similar to Stripe Connect)
2. The dashboard calls each platform's API on demand on page load — no DB writes
3. Display unified view: spend, clicks, add-to-carts, purchases, ROAS across platforms

Cost to the platform: zero per merchant. All ad platform APIs are free to read. Data lives on the upstream platforms.

This is a real differentiator — Shopify doesn't consolidate ad data in their admin. A clean "I spent $X across three platforms, here's where my N purchases came from" is unmet in the small-merchant tool space.

### Ad Creation — Out of Scope
v1: read-only consolidated dashboard. v2/v3: maybe simple "boost this product" flows that create basic campaigns with sensible defaults — only after validating demand.

---

## Affiliate Program

### How It Works

Merchants create affiliate links (e.g., `mystore.com?ref=creator123`) and set a per-creator revenue share. Creators share the link; on a successful purchase the affiliate's cut is paid out automatically via Stripe Connect.

**Flow:**
1. Merchant creates affiliate link in admin (unique `ref`, commission rate)
2. Creator connects via Stripe Connect Express (lightweight, Stripe handles tax forms)
3. Customer click sets a cookie/localStorage with the `ref`
4. Checkout passes `ref` as Stripe session metadata
5. After charge succeeds, `stripe.transfers.create` pays the affiliate

### No-Database Approach (v1)

Affiliate metadata (ref → creator mapping, commission rates) lives in JSON in R2 alongside the merchant's other content. Conversion tracking leans entirely on Stripe — query Sessions API filtered by metadata. Click-through rates aren't surfaced; if needed later, add a minimal Turso table per click event.

### Tax Reporting

Stripe Connect Express accounts handle 1099 issuance automatically. The platform issues no 1099s itself.

### Differentiator

Shopify merchants pay $30-49/month for third-party affiliate apps. Built-in affiliate at $5/month total is a strong creator-economy hook.

---

## Instagram Integration

Already shipped end-to-end (see project memory for details). Two flows:
1. Import images + caption from an Instagram post into a product listing
2. Browse a merchant's IG media to start a new product from a post

**Auth:** Instagram Business Login (OAuth, separate from Meta Business). Long-lived tokens (60 days) auto-refresh. Token storage is per-merchant in `merchant_integrations` (provider-agnostic table designed for future ad-platform OAuth flows).

**Permissions:** `instagram_basic` only. Read-only.

**Required state to go beyond test users:** Meta App Review submission for `instagram_basic` permission. Currently dev mode (works only for accounts added as testers).

---

## Storefront Updates (no longer a hard problem)

Pre-migration this was the hardest long-term problem — propagating template changes to N forked repos. Post-migration it's a single `wrangler deploy`. The Worker bundle is the template; one deploy ships to every merchant simultaneously.

**Migration window**: when the Worker's `main.js` changes, in-flight cart sessions on the old code finish whatever they're doing; new requests get the new code. No per-merchant version skew.

---

## Auth (unchanged)

**Magic link** (email a login link, no password) plus **WebAuthn passkeys** (registered on first successful magic-link login, used for subsequent sessions). Cheap to build, lowest friction for non-technical merchants. Sessions are JWTs in HttpOnly cookies; rotation handled by the platform's session module.

---

## Merchant Onboarding Flow

### Step 1: Account + Payment
- Email (becomes login via magic link)
- Store name (e.g., "Luna Silver Studio")
- Plan: $5/mo or $50/yr (30-day free trial on both)
- Stripe Checkout for platform subscription
- **Nothing is provisioned until payment succeeds (or trial begins)**

### Step 2: Brand + Categories + Stripe Connect
- Collect logo, color palette (gradient pairs), font, category names
- Stripe Connect OAuth flow (separate from platform billing)

### Step 3: Provision
- Write starter `settings.json` + `homepage.json` to R2 (with merchant's branding + categories baked in)
- Write KV `MERCHANT_INDEX` entry for `<slug>.ururu.store`
- Set merchant row `custom_domain`, `status='live'`

### Step 4: Live
- Show URL: `luna-silver-studio.ururu.store`
- CTA: "Add your first product"

### Behind the Scenes Per Step

| After step | Platform action |
|---|---|
| 1. Payment / trial start | Create merchant row, create Stripe Billing subscription |
| 2. Brand + categories submitted | Hold in memory until provision time |
| 2b. Stripe connected | Store `stripe_account_id` on merchant row |
| 3. Provision | R2 `<slug>/content/{settings,homepage}.json`, KV entry, DB row update |
| 4. Live | Merchant lands on dashboard; can start adding products |

### What Merchants Configure Later in the Dashboard
- Add/edit/delete products (with optional Instagram import)
- Shipping settings (free / flat / USPS / pickup)
- Meta Pixel ID for tracking
- Connect Instagram for product import + ad dashboard
- Connect ad platforms (Google, TikTok, Reddit) for consolidated dashboard
- Set up affiliate program
- Request custom domain (once Cloudflare for SaaS flow ships)
- Update branding

---

## Build Status

| Phase | Status |
|---|---|
| Landing page | ✓ done |
| Platform auth (magic link + passkeys) | ✓ done |
| Stripe Billing ($5/mo + $50/yr, 30-day trial) | ✓ done |
| Per-merchant Stripe Connect | ✓ done |
| R2 image CDN | ✓ done |
| Platform admin: branding, categories, products, shipping, contact, thank-you, secondary CTA, marketing, account, orders, coupons, custom-url stub | ✓ done |
| Instagram integration (import + create-from-post) | ✓ done (pending App Review) |
| Storefront orders + branded emails + fulfillment marking | ✓ done |
| Multi-tenant Cloudflare Worker storefront | ✓ done (Phase 6 cutover 2026-05-10) |
| New-arch publishing (drafts → R2) | ✓ done |
| Custom domain support (Cloudflare for SaaS / Custom Hostnames) | pending |
| Live Stripe Connect for florezflorez prod | pending |
| Storefront update mechanism | obsolete (single Worker deploy = update every merchant) |

---

## Stack Recommendation (current)

| Layer | Technology |
|---|---|
| Storefront runtime | Cloudflare Workers (Hono framework, one binary serves all merchants) |
| Platform admin | Next.js on Vercel at ururu.store |
| Auth | Magic link + WebAuthn passkeys, JWT sessions |
| Payments | Stripe Connect (Standard, `stripeAccount` header) |
| Platform billing | Stripe Billing |
| Per-merchant content | Cloudflare R2 (bucket `ururu-content`, prefix `<slug>/content/`) |
| Per-merchant images | Cloudflare R2 (bucket `ururu-images`, prefix `<slug>/`) served via `img.ururu.store` |
| Tenant lookup cache | Cloudflare KV (`MERCHANT_INDEX`, hostname → identity) |
| Platform DB | Turso (libSQL) — provisioning metadata + drafts |

---

## Local Development

The platform admin and the storefront Worker are both in the same `ururu` repo:

```
~/Documents/ururu/
├── src/                      # Platform admin (Next.js)
├── storefront/               # Cloudflare Worker
│   ├── src/                  # Worker entry + routes + tenant resolution
│   ├── static/               # Bundled storefront assets (main.js, css, fonts, etc.)
│   └── wrangler.toml
└── scripts/                  # Operational helpers (KV mapping, env push, etc.)
```

**Platform admin:**
```bash
cd ~/Documents/ururu
npm run dev      # https://localhost:3001 (--experimental-https)
```

**Storefront Worker:**
```bash
cd ~/Documents/ururu/storefront
npm run dev      # http://localhost:8787 via wrangler dev
```

The KV namespace is shared between dev and prod (one binding to one namespace), so any KV writes from a dev tool affect the live storefront. Treat dev DB rows that have a corresponding live KV entry as read-mostly.

---

## Domain Architecture

| Domain | Purpose |
|---|---|
| `ururu.store` | Platform admin (Next.js on Vercel) — marketing, dashboard, provisioning API |
| `*.ururu.store` | Merchant storefronts. Wildcard DNS is orange-cloud; the wildcard Workers Route routes everything to `ururu-storefront`. |
| `img.ururu.store` | Shared image CDN. Served by the Worker via the `IMAGES` R2 binding (bucket `ururu-images`). |
| `florezflorez.com` | Florez Florez's planned custom domain (not yet active; depends on Cloudflare for SaaS work). |

---

## Pending Strategy Work

### 1. Rename `for_sale` → `visible` on disk (deferred field migration)

Piece editor labels were updated in 2026-05 (Visible / For sale), but the underlying JSON field names still read `for_sale` (visibility) and `purchasable` (buy-button toggle). The mismatch is a usability footgun — every future contributor has to learn that "for_sale" actually means "visible".

**Settled plan: rename one field only.**

| Field on disk (today) | Field on disk (after migration) |
|---|---|
| `for_sale` (= visibility) | **`visible`** (renamed) |
| `purchasable` | `purchasable` (unchanged) |

`purchasable` keeps its name; the UI label "For sale" is just a presentation choice and the field name is clear on its own. Renaming only `for_sale` avoids a name collision and keeps the back-compat fallback to one line.

**Sequencing**:
1. Platform admin reads with `piece.visible ?? piece.for_sale ?? true`. Writes drop `for_sale`. Rename code variables `for_sale` → `visible` in `PieceForm`, `AddProductButton`, `ProductsList`, `products/page.tsx`.
2. Storefront Worker (`storefront/static/js/main.js`) reads with same fallback.
3. One-shot script renames `for_sale` → `visible` in every R2 `<slug>/content/<category>.json`. Runs against `ururu-content`.
4. Drop the read fallbacks once content is fully migrated.

Meta product feed (`api/meta-feed.js` in florezflorez) also reads `piece.for_sale` — needs the fallback in step 2.

### 2. Replace USPS direct integration with EasyPost (Phase 4 — deferred indefinitely)

Current shipping path: Worker calls USPS API directly via `/api/calculate-shipping-options`. Works, but locks the platform to USPS and forces every merchant to set up their own USPS Enterprise Payment System (EPS) account if they want to actually buy labels — non-starter for casual makers.

**Settled plan: EasyPost as a multi-carrier abstraction.** Wrapped behind `lib/shipping.ts` so a future direct-USPS-EPS swap is a one-file change. Prototype lives at `scripts/easypost-prototype.mjs` (never run live — no test key was ever provided).

**Critical design rule — buyer-quoted rate equals merchant cost:**
- Storefront `/api/shipping/rates` proxies to EasyPost `/v2/shipments`, returns rate options.
- Chosen `shipment_id` + `rate_id` persist on the Stripe Checkout Session metadata.
- "Buy label" later calls EasyPost `/v2/shipments/{id}/buy` with the same `rate_id` — guarantees merchant cost = buyer quote, no daylight.

**Funding model — platform-managed postage ONLY in USPS dynamic mode:**

| Shipping mode | application_fee_amount | Postage destination | Label buyer |
| --- | --- | --- | --- |
| USPS dynamic | `1.1% × subtotal + dynamic_postage_cents` | Platform Stripe account | ururu (via EasyPost) |
| Flat rate | `1.1% × total` | Merchant's Connect balance | Merchant handles independently |
| Free | `1.1% × total` | N/A | Merchant |
| Pickup | `1.1% × total` | N/A | N/A |

The platform only intercepts shipping money when it's actually performing the shipping service. For flat/free/pickup, the platform never touches shipping money — no refund-back-to-merchant escape hatch needed.

**Schema additions to `order_fulfillments`:** `easypost_shipment_id`, `easypost_rate_id`, `shipping_label_qr_url`, `shipping_label_pdf_url`, `postage_cents`, `shipping_carrier`, `shipping_service`, `voided_at`, `purchased_at`. Plus piece-level box dimensions (`box_length`, `box_width`, `box_height`) on `PieceShape`.

**Why deferred**: 2026-05-04 confirmation that florezflorez (and current candidate merchants) are comfortable with flat-rate / free shipping. Revisit when a merchant explicitly asks for dynamic USPS rates at checkout.

### 3. Smoke tests we still owe ourselves

The migration is live and florezflorez renders, but several paths aren't exercised live yet. List in priority order:

1. **Onboarding a fresh new-arch merchant end-to-end.** `provisionMerchantOnCloudflare` ran live for the test slug in Phase 4 (then was torn down) and again on florezflorez via the migration script — but a real flow from `/onboarding/create-store` after Phase 7 has never been run. First brand-new merchant onboarding will exercise the full path.
2. **Live Stripe Connect on a new-arch merchant.** Florezflorez prod has `stripe_account_id=NULL`; live Connect was only ever done on sandbox. The `refreshMerchantIndex` KV write in the Connect callback was rewritten in Phase 7 and has never run live.
3. **Drafts → R2 publish flow against a real merchant.** Dashboard staging + publish was tested mid-migration on dev only. First florezflorez publish post-cutover will validate the round trip (R2 PUT → KV propagation → storefront re-render within ~60s).
4. **Embedded Stripe Checkout flow on the Worker.** The new bundled `main.js` ports florezflorez's embedded checkout but has never run live (florezflorez is gated by step 2). Will fire as soon as Stripe Connect is wired.
5. **USPS rate calc through the Worker.** `/api/calculate-shipping-options` was ported from florezflorez's checkout JS in Phase 3 but never invoked live. Needs a real Stripe checkout session to fire the Stripe `onShippingDetailsChange` callback against the Worker.
6. **Customer + merchant order email delivery from the Worker's Connect webhook.** Sandbox webhooks worked via Stripe CLI tunneling to localhost; the prod path (`POST` from Stripe → ururu.store/api/stripe/connect-webhook → Resend send) hasn't completed an end-to-end loop. Re-register the webhook destination on the Stripe Connect platform once the prod admin URL is live; set `STRIPE_CONNECT_WEBHOOK_SECRET`.
7. **Mark-shipped + tracking number flow.** UI works in dev DB; never exercised on a prod-merchant order with a real customer email round-trip.
8. **Subscription cancellation grace state.** Plan was: when `customer.subscription.deleted` fires, flip merchant to a "store under construction" page. With the new architecture this is just a `merchant.status = 'cancelled'` flag the Worker checks before serving — but no code yet.
9. **Coupon creation + redemption.** Coupons CRUD shipped (Phase 1 of platform admin); never tested with a real Stripe checkout that applies one.
10. **Stripe Connect disconnect.** API endpoint exists; flow never exercised live.

The first three are the only ones that block routine merchant operation. The rest are gaps to close opportunistically as merchants hit them.

---

## Agentic Commerce (Stripe ACS)

Stripe Agentic Commerce Suite is the path. Push a single Stripe-format catalog feed per merchant; Stripe handles the per-agent integration with ChatGPT, Operator, Gemini, and whoever else they sign. Same Stripe Connect plumbing we already use, same `checkout.session.completed` webhook that fires on normal orders.

**Key decisions:**

- **Charge type: direct charges.** Matches our existing Connect Standard setup; connected account stays merchant of record. (Destination + `on_behalf_of` also works but adds complexity for no benefit here.)
- **No application fee.** Consistent with the platform's no-cut policy. The `v1.delegated_checkout.finalize_checkout` hook is therefore not load-bearing — we don't need to set `application_fee_details` to preserve revenue. The hook only becomes useful if we want pre-approval (inventory / fraud / cart sanity), and is optional.
- **No Ururu onboarding UX for agentic.** For Connect Standard merchants, Stripe Profile creation, Stripe Tax setup, legal-policy URLs (refund / ToS / privacy), agent enablement, and OCA approvals all live in the merchant's own Stripe Dashboard. We don't mirror or wrap that surface.

Why the small surface: Ururu's only must-do is the catalog feed, because Stripe can't read merchant content out of R2. Everything else Stripe already exposes to the connected account through their own Dashboard. The embedded `agentic-commerce-settings` component is a UX-cohesion nice-to-have, not a requirement — small makers already touch their Stripe Dashboard for Connect onboarding.

**Phase plan (simplified to two pieces):**

1. **Stripe-CSV exporter + `ProductCatalogImport` upload pipeline.** Port the existing Meta-feed plumbing (one row per piece, globally unique IDs already enforced cross-category) to Stripe's CSV schema. Upload per-merchant via the v2 commerce API with the `Stripe-Account` header, triggered on merchant publish. `mode=upsert` for the full product feed; incremental `inventory` and `pricing` feeds for stock/price-only edits.
2. **Shipping customization hook.** Implement `v1.delegated_checkout.customize_checkout` to return shipping rates from our existing dynamic-USPS logic. Without this, ACS would fall back to static feed-defined rates and lose our shipping accuracy. Tax stays on Stripe Tax (set `stripe_product_tax_code` per piece or use a platform default); we don't write a custom tax hook unless Stripe Tax falls short.

That's it. No embedded component, no setup wizard, no per-step checklist.

**Status:** Waitlist-gated. Platform-level ACS requires approval via `go.stripe.global/agentic-commerce-contact-sales`. Pre-approval work that can ship behind a feature flag: the CSV exporter and upload pipeline (will 4xx against the v2 API until approved; the code path is identical). The shipping hook can be built and ngrok-tested against stubbed payloads in the meantime.

**Caveats to revisit:**

- ACS endpoints are on preview API versions (`2026-04-22.preview`, `2025-12-15.preview`). Schema may shift before GA — keep both endpoints and CSV schema isolated behind a thin internal interface so a future version bump is one-file work.
- Marketplace facilitator (MPF) tax obligations attach to the agent that mediated the sale, not the platform, per Stripe's note. Still worth periodic review by a tax advisor.
- Restricted API key needs `Product Catalog Import` write permission. Separate from existing Connect keys; rotation schedule is independent.

---

## Legal & Privacy

Two layers with different owners. US-only scope means **CCPA is the binding regime**; GDPR is out of scope until we sell outside the US.

### Platform (`ururu.store`)

What we collect and need to disclose at the platform level:
- **Signup form** — email address only (no password is stored; auth is magic link + WebAuthn passkeys).
- **Auth cookies** — `ururu_session` JWT, session token.
- **Email delivery via Resend** — magic links, email-change confirmations, order receipts forwarded from merchant Stripe accounts. Email addresses are shared with Resend for delivery.
- **Merchant profile data in Turso** — slug, store name, Stripe account ID, custom domain.

**No third-party ad trackers run on the marketing site**, so there's no advertising disclosure to make. Meta Pixel and friends live on merchant storefronts, not on `ururu.store`.

Surface:
- `ururu.store/privacy` — basic privacy policy covering the four buckets above.
- `ururu.store/terms` — basic Terms of Service covering the merchant–platform relationship, acceptable-use (what merchants can't sell), platform's right to suspend, dispute resolution. Implicit acceptance via signup.
- Linked from the marketing-page footer and from the signup form ("by creating an account, you agree to…").
- Content hardcoded for v1, authored or reviewed by a lawyer. Not editable through the `/admin` admin tool — too easy to break a legal document with a stray edit, and the update cadence is rare enough that a deploy is fine.

### Per-merchant storefronts (`<slug>.ururu.store`)

Each merchant is the **data controller / "business" under CCPA** for their own customers. The storefront does the data collection (checkout fields, ad pixels); the merchant — not the platform — owes their customers the disclosure. Our job is to make compliance the path of least resistance.

Three pieces, designed to work together:

**1. Worker-rendered privacy page.** Replace `storefront/static/privacy.html` (currently identical-boilerplate-for-everyone) with a route in the Worker that pulls from `settings.json` per request. Two parts:
- **Static base** — reviewed boilerplate covering checkout-data collection, the merchant contact email pulled from settings, retention defaults. Identical structure across merchants but with merchant-specific name/email injected.
- **Dynamic "Third-party services" section** — auto-populated from which trackers the merchant has configured. If `meta_pixel_id` is set, a Meta Pixel disclosure block renders. Future pixels (`google_analytics_id`, `tiktok_pixel_id`, …) slot in alongside via the same registry. Merchant doesn't edit this section — it's keyed off configuration so the disclosure can't drift from reality.

**2. Global Privacy Control (GPC) respect at pixel init.** GPC is the de-facto CCPA opt-out signal that Firefox, Brave, and some Chrome extensions send. Gate every pixel's `init` call on `navigator.globalPrivacyControl` in the storefront's shell template:

```js
if (settings.meta_pixel_id && !navigator.globalPrivacyControl) {
  fbq('init', settings.meta_pixel_id);
}
```

A few lines, applies to every merchant who has any pixel configured. Closes the largest CCPA-tail risk for negligible effort.

**3. "Do Not Sell or Share My Personal Information" footer link.** Renders only when the storefront has at least one ad tracker configured. Links to a per-storefront opt-out page that records the choice in `localStorage` and prevents pixel init on subsequent loads via the same gate as GPC. The opt-out page also exposes a contact form routing to the merchant's contact email for formal CCPA requests.

Returns and shipping policies stay merchant-editable (existing `returns_policy` free-text field plus a shipping-specific equivalent rendered into the public returns/shipping pages), but the privacy page itself is structurally generated — too much room for legal drift if merchants write their own.

### Stripe ACS connection

When a merchant configures agentic commerce in their Stripe Profile, Stripe asks for refund / ToS / privacy URLs. Those URLs already exist per merchant (`<slug>.ururu.store/privacy`, `/returns.html`, etc.); after this work, they point to real merchant-specific content rather than shared boilerplate. Required precondition for ACS adoption but not blocking ACS planning.

### Phase plan

1. **Platform legal pages** (`/terms`, `/privacy` on `ururu.store`) — content authored or templated via Termly / iubenda, reviewed before live. Footer link on marketing pages and signup form. ~2 days once content exists.
2. **Worker-rendered merchant privacy page** — replace static `privacy.html` with a Worker route; build the tracker-disclosure template registry; inject merchant name + contact email from `settings.json`. ~1 day.
3. **GPC + opt-out link** — pixel-init gate in `shell.ts`, DNS footer link, opt-out page that flips a `localStorage` flag and surfaces a CCPA contact form. ~0.5 day.
4. **Returns / shipping per-merchant rendering (deferred)** — the `returns_policy` field already exists; rendering it into `/returns.html` is the missing piece. ~0.5 day. Low priority; current static page is acceptable as a starter.

### Explicitly out of scope (for now)

- **GDPR / EEA users** — US-only product, no EU traffic to serve.
- **Cookie banner** — CCPA doesn't require it; sale/sharing opt-out + GPC respect cover the obligation. Re-evaluate if we add platform-side analytics or expand outside the US.
- **Per-merchant ToS** — most small makers don't need one. Add a templated version if/when a merchant requests it.
- **DSAR / CCPA "right to know" automation** — handled manually by the merchant via their contact email until volume justifies tooling.

---

## Florez Florez's Place in This

The current `florezflorez/` repo is the **historical pre-migration storefront**. Florez Florez itself is now merchant #1 on the platform — served by the Cloudflare Worker, content in R2 `ururu-content/florezflorez/content/`. The repo is kept around as a reference (working CSS, working main.js with embedded checkout + USPS handlers) but is no longer on the request path. The Worker's `static/` directory is the canonical storefront bundle now.

Florez Florez's Vercel project is still alive as a soak-period rollback path post-cutover, scheduled for decommission once normal use confirms no surprises.
