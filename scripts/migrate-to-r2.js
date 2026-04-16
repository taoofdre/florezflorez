#!/usr/bin/env node

// One-time migration: upload all images from /uploads/ to R2,
// then update all content JSON files to use R2 URLs.
//
// Usage:
//   R2_ACCOUNT_ID=xxx R2_ACCESS_KEY_ID=xxx R2_SECRET_ACCESS_KEY=xxx \
//   R2_BUCKET_NAME=florezflorez-uploads R2_PUBLIC_URL=https://img.florezflorez.com \
//   node scripts/migrate-to-r2.js
//
// Or set these in a .env file and run: node -e "require('dotenv').config()" && node scripts/migrate-to-r2.js

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const ROOT = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const CONTENT_DIR = path.join(ROOT, 'content');

const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
}

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL.replace(/\/$/, '');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const EXT_TO_TYPE = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

async function uploadFile(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const contentType = EXT_TO_TYPE[ext] || 'application/octet-stream';
  const body = fs.readFileSync(filePath);

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: filename,
    Body: body,
    ContentType: contentType,
  }));

  return `${R2_PUBLIC_URL}/${filename}`;
}

async function main() {
  // Step 1: Upload all files from /uploads/ to R2
  const files = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.'));
  console.log(`Found ${files.length} files in uploads/`);

  const urlMap = {}; // old relative path -> new R2 URL
  let uploaded = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(UPLOADS_DIR, file);
    if (!fs.statSync(filePath).isFile()) continue;

    try {
      const r2Url = await uploadFile(filePath);
      urlMap[`/uploads/${file}`] = r2Url;
      uploaded++;
      console.log(`  [${uploaded}/${files.length}] ${file} -> ${r2Url}`);
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${file} - ${err.message}`);
    }
  }

  console.log(`\nUploaded: ${uploaded}, Failed: ${failed}\n`);

  if (failed > 0) {
    console.error('Some uploads failed. Fix errors and re-run, or proceed with caution.');
  }

  // Step 2: Update all content JSON files
  const jsonFiles = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'));
  let filesUpdated = 0;

  for (const jsonFile of jsonFiles) {
    const jsonPath = path.join(CONTENT_DIR, jsonFile);
    let content = fs.readFileSync(jsonPath, 'utf8');
    let changed = false;

    for (const [oldPath, newUrl] of Object.entries(urlMap)) {
      // Match both /uploads/file and full Vercel URLs pointing to /uploads/file
      const patterns = [
        oldPath,
        `https://florezflorez.vercel.app${oldPath}`,
        `https://florezflorez.com${oldPath}`,
        `https://www.florezflorez.com${oldPath}`,
      ];
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          content = content.split(pattern).join(newUrl);
          changed = true;
        }
      }
    }

    if (changed) {
      fs.writeFileSync(jsonPath, content, 'utf8');
      filesUpdated++;
      console.log(`Updated: ${jsonFile}`);
    }
  }

  console.log(`\nContent files updated: ${filesUpdated}`);
  console.log('\nDone! Next steps:');
  console.log('  1. Verify images load from R2 URLs');
  console.log('  2. Add "uploads/" to .gitignore');
  console.log('  3. Run: git rm -r --cached uploads/');
  console.log('  4. Commit and push');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
