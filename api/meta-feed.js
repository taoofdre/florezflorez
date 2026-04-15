const REPO = process.env.GITHUB_REPO || 'taoofdre/florezflorez';
const SPECIAL_SECTIONS = ['consulting', 'about'];

async function fetchJSON(filePath, pat) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    headers: {
      'Authorization': 'token ' + pat,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) return null;
  const file = await res.json();
  return JSON.parse(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'));
}

async function getSettings(pat) {
  return await fetchJSON('content/settings.json', pat) || {};
}

function escapeCSV(val) {
  const str = String(val || '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

module.exports = async (req, res) => {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    res.status(500).send('Server configuration error');
    return;
  }

  const settings = await getSettings(pat);
  const baseUrl = (settings.og_url || '').replace(/\/$/, '');

  if (!baseUrl) {
    res.status(500).send('Site URL not configured in settings');
    return;
  }

  // Load categories from homepage.json
  const homepage = await fetchJSON('content/homepage.json', pat) || {};
  const contentFiles = (homepage.categories || [])
    .filter(c => !SPECIAL_SECTIONS.includes(c.slug))
    .map(c => ({ path: 'content/' + c.slug + '.json', category: c.slug }));

  if (contentFiles.length === 0) {
    // Fallback
    contentFiles.push(
      { path: 'content/necklaces.json', category: 'necklaces' },
      { path: 'content/rings.json', category: 'rings' },
      { path: 'content/art.json', category: 'art' }
    );
  }

  const columns = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
  const rows = [columns.join(',')];

  for (const { path, category } of contentFiles) {
    const data = await fetchJSON(path, pat);
    if (!data || !data.pieces) continue;

    for (const piece of data.pieces) {
      if (!piece.for_sale) continue;
      if (!piece.price_display) continue;

      const price = piece.price_display.replace(/[^0-9.]/g, '');
      if (!price) continue;

      const imageUrl = piece.images && piece.images.length > 0
        ? baseUrl + piece.images[0].src
        : '';
      if (!imageUrl) continue;

      const stock = typeof piece.stock === 'number' ? piece.stock : null;
      const availability = stock === 0 ? 'out of stock' : 'in stock';

      const row = [
        escapeCSV(piece.id),
        escapeCSV(piece.title),
        escapeCSV(piece.description),
        availability,
        'new',
        escapeCSV(price + ' USD'),
        escapeCSV(baseUrl + '/' + category + '/' + piece.id),
        escapeCSV(imageUrl),
        escapeCSV(settings.site_title || 'Florez Florez'),
      ];

      rows.push(row.join(','));
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(rows.join('\n'));
};
