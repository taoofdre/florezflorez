# Platform Cost Model — ururu

**Last revised**: 2026-05-11
**Architecture assumption**: post-Cloudflare migration (one multi-tenant Worker on Workers Paid, R2 for content + images, KV for tenant routing, Vercel Pro for the admin, Turso for the platform DB, Resend for email).

A working spreadsheet-in-markdown. Inputs at the top; line items below. The model is hand-computed — tweak inputs and recompute the line items when refining. The point isn't perfect precision, it's having explicit numbers to argue with.

---

## Inputs

| Parameter | Current value | Sensitivity |
|---|---|---|
| Merchants | 1,000 | linear on most line items |
| Sales / merchant / month | 50 | drives Resend + checkout API load |
| Conversion rate | 0.5% | inverse-linear on storefront traffic |
| Products / merchant | 20 | linear on storage |
| Photos / product | 5 | linear on image storage + image reads |
| Publishes / merchant / day | 10 (at the cap) | linear on R2 Class A + Vercel admin load |
| First-month-$1 share | ~5% of MRR is new signups | rounding error today |

**Derived**:
- Pageviews per merchant per month: 50 ÷ 0.005 = **10,000**
- Total pageviews per month: 10,000 × 1,000 = **10,000,000**
- Total transactions per month: 50 × 1,000 = **50,000**
- Total photos: 20 × 5 × 1,000 = **100,000** (~20 GB at 200KB/photo)
- Total publishes per month: 10 × 30 × 1,000 = **300,000**

---

## Per-pageview Worker activity

| What happens | Worker requests |
|---|---|
| HTML shell render | 1 |
| `/api/config` | 1 |
| `/content/settings.json` + `/content/homepage.json` | 2 |
| One additional `/content/<category|piece>.json` | ~1 |
| Image fetches via `img.ururu.store` | ~15 |
| **Per-pageview total** | **~20** |
| `/css/style.css`, `/js/main.js`, fonts | served via Workers Assets (not billed as Worker requests) |

10M pageviews × ~20 = **~200M Worker requests / month**.

**Cache assumptions** that turn 200M raw requests into actual cost:
- Images get `Cache-Control: public, max-age=2592000, immutable` (30 days) — assume **~85% edge cache hit rate** after warm-up
- Content JSON gets `Cache-Control: public, max-age=60` — assume **~45% edge cache hit rate** (cache cycles through every minute)

So R2 actually sees:
- Image reads: 150M × 15% = **22.5M / month**
- Content JSON reads: 50M × 55% = **27.5M / month**
- Total R2 Class B from storefront: **~50M / month**

---

## Recurring monthly costs at 1,000 merchants

| Line item | Calc | Cost |
|---|---|---|
| Cloudflare Workers Paid plan base | — | $5.00 |
| Workers requests over 10M included | 190M × $0.30/M | $57.00 |
| Workers CPU-ms (mostly image passthrough ~0.5ms, some HTML render ~5ms) | ~150M over the 30M included × $0.02/M | $3.00 |
| Cloudflare KV reads (1 per pageview) | 7M over free × $0.50/M | $3.50 |
| R2 storage (~20 GB images + ~100 MB content) | (20 − 10 GB free) × $0.015 | $0.15 |
| R2 Class B reads (storefront + admin) | (50M − 10M free) × $0.36/M | $14.40 |
| R2 Class A writes (publish ops, image uploads — ~1M/month) | within 1M free tier | $0.00 |
| Turso platform DB | well under 1B reads / 25M writes free | $0.00 |
| Vercel Pro (admin app + landing) | 1 paid seat | $20.00 |
| Resend (~55K emails: 50K order + 5K magic links) | Pro tier | $20.00 |
| **Infrastructure subtotal** | | **~$123** |
| Stripe fees on platform subscriptions | 1,000 × (2.9% × $5 + $0.30) | $445.00 |
| **Total recurring costs** | | **~$568** |

---

## Revenue side

| | |
|---|---|
| 1,000 merchants × $5 | $5,000 |
| First-month-$1 drag (~5% of base × $4 discount) | −$10 |
| **Gross revenue / month** | **~$4,990** |

---

## Net per merchant

| | |
|---|---|
| Revenue | $5.00 |
| Total cost (infra + Stripe) | $0.57 |
| **Net margin per merchant** | **$4.43** |
| **Margin %** | **~88%** |

For reference: **infrastructure-only cost per merchant** (excluding Stripe fees) is **$0.13/month**. That's the number that scales with the architecture; everything else is Stripe.

---

## Sensitivity

What moves when an input changes (everything else held constant):

| Variable | Change | Effect on monthly cost |
|---|---|---|
| Conversion rate | 0.5% → 1.0% | pageviews halve → Workers + R2 reads drop ~$35/month |
| Conversion rate | 0.5% → 0.25% | pageviews double → +$60–80/month |
| Photos per product | 5 → 10 | more image fetches per pageview → +$10–15/month |
| Sales / merchant | 50 → 100 | doubles order emails + checkout sessions → +$20/month (mostly Resend tier) |
| Publishes / merchant / day | 10 → 30 | R2 Class A exits free tier → +$5–10/month |
| Merchants | 1k → 10k | roughly linear on everything → ~$1,200/month total (still ~80%+ margin) |
| Image cache hit rate | 85% → 60% | R2 Class B reads ~2.5x → +$20/month |

The dominant non-Stripe cost is **Workers requests** (~$60). That scales 1:1 with pageview count, which is the storefront's actual user load. Everything else is mostly fixed-base (Vercel, Resend tiers) or trivial (Turso, R2 storage).

---

## What this model excludes

- **Domain registration** (~$15/year for ururu.store; one-off, not recurring)
- **One-time setup costs** (Vercel project init, DNS, certs — all $0 ongoing)
- **Refunds / chargebacks** — Stripe dispute fees are $15 each, but those land on the merchant's Connect account, not the platform's
- **Burst traffic events** — Workers scales horizontally for free; Resend is the only place a 10x spike would force a tier bump
- **Storage growth over years** — image uploads accumulate; not auto-deleted on replacement. At ~9 GB/month of new uploads, in 5 years ~540 GB extra = ~$8/month additional storage. Real but slow.
- **Customer support time** — has a dollar value, not modeled here
- **Ad-dashboard API usage** (Meta / Google / TikTok / Reddit) — all free per their docs
- **USPS rate API** — free
- **Time value of having a working product** — also not modeled

---

## When to refresh this

Run a fresh pass when any of:
- Merchant count moves by ~5×
- Storefront traffic per merchant shifts (conversion rate, photo count) by a noticeable amount
- A new infra dependency is added (e.g., if we ever introduce a queue, a DB read replica, or a per-merchant analytics store)
- Cloudflare / Vercel / Stripe / Resend pricing announcement
- Anything in `platformthinking.md` § Build Status changes from pending → shipped (each new feature usually adds a cost line)

When refreshing, keep the structure: inputs table → derived values → per-pageview activity → cost lines → revenue → net → sensitivity. Don't replace numbers in place — keep the old version inline as a strikethrough or comment so the trajectory is visible. The point of this doc is not to be right today; it's to be auditable over time.

---

## Cross-reference

- `platformthinking.md` — architecture and product strategy. Has a coarse "Unit Economics" section that this file expands on.
- Cloudflare migration memory (`project_cloudflare_migration.md` in the platform's local agent memory) — explains *why* the architecture is shaped this way, which is the input to *why* the cost structure is what it is.
