const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify GitHub token
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
    res.status(401).json({ error: 'Invalid GitHub token' });
    return;
  }

  const { filename, content } = req.body;
  if (!filename || !content) {
    res.status(400).json({ error: 'Missing filename or content' });
    return;
  }

  // Sanitize filename
  const safeName = filename.replace(/[^a-z0-9._\-]/gi, '-');

  // Determine content type from extension
  const ext = safeName.split('.').pop().toLowerCase();
  const contentTypes = {
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    gif: 'image/gif',
  };
  const contentType = contentTypes[ext] || 'application/octet-stream';

  try {
    const buffer = Buffer.from(content, 'base64');

    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: safeName,
      Body: buffer,
      ContentType: contentType,
    }));

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${safeName}`;
    res.status(200).json({ path: publicUrl, filename: safeName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
