# Plan: Migrate Images from Git to Cloudflare R2

## Context

Every image upload triggers a Vercel deploy (git commit → push → deploy). With the platform vision of 100+ merchants, this will burn through Vercel's 6,000/day deploy limit quickly. Moving images to R2 eliminates deploy-per-image entirely. R2's free tier (10GB storage, 10M reads/month) is more than enough per merchant at $0 cost.

## Implementation Steps

### Step 1: DNS Setup (GoDaddy + Cloudflare)
- Add `florezflorez.com` to Cloudflare (free plan)
- Cloudflare gives you two nameservers — update GoDaddy to use them
- Re-add any existing DNS records (e.g., Vercel CNAME) in Cloudflare's DNS panel
- Wait for propagation (15 min to 24 hrs)

### Step 2: R2 Setup (Cloudflare dashboard)
- Create bucket `florezflorez-uploads`
- Add custom domain: `img.florezflorez.com` (production-ready, CDN-cached, no rate limits)
- Do NOT use the `r2.dev` public URL (rate-limited, no caching)
- Create API token with Read & Write permissions scoped to the bucket
- Add 5 env vars to Vercel:
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET_NAME` (`florezflorez-uploads`)
  - `R2_PUBLIC_URL` (`https://img.florezflorez.com`)

### Step 3: Install S3 SDK
- Add `@aws-sdk/client-s3` to `package.json` dependencies (R2 is S3-compatible)
- **File:** `package.json`

### Step 4: Rewrite `/api/upload.js`
- Replace GitHub Contents API upload with R2 `PutObjectCommand`
- Keep GitHub token verification for auth (no new auth system needed)
- R2 credentials stay server-side only (env vars)
- Return `{ path: "https://img.florezflorez.com/filename.webp" }` instead of `{ path: "/uploads/filename.webp" }`
- Frontend `img.src` works with both relative paths and full URLs — no frontend changes needed
- **File:** `api/upload.js`

### Step 5: Update homepage admin uploads
- `/admin/homepage/index.html` has its own inline `uploadFile()` that calls GitHub API directly (bypasses `/api/upload`)
- Route **image** uploads (logo, backgrounds) through `/api/upload` instead
- Keep **font** uploads going to GitHub (fonts are served from `/fonts/` by CSS `@font-face`)
- **File:** `admin/homepage/index.html`

### Step 6: Cosmetic update to crop tool
- Update status message in `crop.html` from `"Saved as /uploads/..."` to show actual R2 URL
- **File:** `admin/tools/crop.html`

### Step 7: Deploy and verify new uploads work
- Upload a test image via each admin tool
- Confirm images serve from R2 URL in browser

### Step 8: Migration script for existing images
- One-time Node script (`scripts/migrate-to-r2.js`):
  1. Read all 63 files from `/uploads/` (~205MB)
  2. Upload each to R2
  3. Walk all content JSON files, replace `/uploads/filename` with R2 URL
  4. Also update `og_image` in `settings.json` (currently a full Vercel URL)
- **Files updated:** all 9 content JSON files in `content/`

### Step 9: Remove `/uploads/` from git
- Add `uploads/` to `.gitignore`
- `git rm -r --cached uploads/` (removes from tracking, keeps local files)
- Commit — this is the last deploy-triggering image change ever

## Files to modify
- `package.json` — add `@aws-sdk/client-s3`
- `api/upload.js` — rewrite: GitHub → R2
- `admin/homepage/index.html` — route image uploads through `/api/upload`
- `admin/tools/crop.html` — status message update
- `content/*.json` (9 files) — migration script updates paths
- `.gitignore` — add `uploads/`
- New: `scripts/migrate-to-r2.js` — one-time migration

## No changes needed
- `admin/products/edit.html` — already calls `/api/upload` and stores `result.path`, works with full URLs
- `js/main.js` — sets `img.src` from JSON data, works with both relative and absolute URLs
- `vercel.json` — no image routing needed, R2 serves its own URLs

## Platform implications
- Each merchant gets their own R2 bucket (R2 free tier is per-bucket)
- Provisioning adds: create bucket → create token → set env vars
- Removes the hardcoded repo name from upload flow (was already a fork problem)
- `REPO` constant in admin pages still hardcoded — separate issue, not in scope

## Verification
1. Upload image via product editor → appears from R2 URL
2. Upload image via crop tool → appears from R2 URL
3. Upload logo via homepage admin → appears from R2 URL
4. Upload font via homepage admin → still goes to GitHub
5. All product pages render images correctly after migration
6. Homepage logo and backgrounds render correctly
7. OG image works when sharing link
8. Run `npm test` (Playwright suite) — all 28 tests pass
