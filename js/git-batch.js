// GitBatch — atomic multi-file commits via the GitHub Git Data API.
// Usage:
//   const batch = new GitBatch('owner/repo', token);
//   batch.addJSON('content/data.json', { key: 'value' });
//   batch.addText('index.html', '<html>...</html>');
//   await batch.commit('Update files');

class GitBatch {
  constructor(repo, token) {
    this.repo = repo;
    this.token = token;
    this.files = [];
  }

  addJSON(path, data) {
    this.files.push({ path, content: JSON.stringify(data, null, 2) + '\n' });
  }

  addText(path, content) {
    this.files.push({ path, content });
  }

  hasChanges() {
    return this.files.length > 0;
  }

  async commit(message) {
    if (this.files.length === 0) return null;

    const files = this.files.slice();
    this.files = [];

    return this._tryCommit(files, message, null);
  }

  async _tryCommit(files, message, cachedBlobs) {
    // 1. Get current ref
    const ref = await this._gh('GET', '/git/refs/heads/main');
    const headSha = ref.object.sha;

    // 2. Get current commit's tree
    const headCommit = await this._gh('GET', '/git/commits/' + headSha);
    const baseTreeSha = headCommit.tree.sha;

    // 3. Create blobs (parallel), reuse if retrying
    const blobShas = cachedBlobs || await Promise.all(
      files.map(f => this._gh('POST', '/git/blobs', {
        content: f.content,
        encoding: 'utf-8',
      }).then(b => b.sha))
    );

    // 4. Create tree
    const tree = files.map((f, i) => ({
      path: f.path,
      mode: '100644',
      type: 'blob',
      sha: blobShas[i],
    }));

    const newTree = await this._gh('POST', '/git/trees', {
      base_tree: baseTreeSha,
      tree: tree,
    });

    // 5. Create commit
    const newCommit = await this._gh('POST', '/git/commits', {
      message: message,
      tree: newTree.sha,
      parents: [headSha],
    });

    // 6. Update ref
    try {
      await this._gh('PATCH', '/git/refs/heads/main', {
        sha: newCommit.sha,
      });
    } catch (err) {
      if (err.status === 409 && !cachedBlobs) {
        // Another commit landed — retry once, reuse blobs
        return this._tryCommit(files, message, blobShas);
      }
      throw err;
    }

    return { sha: newCommit.sha };
  }

  async _gh(method, endpoint, body) {
    const url = 'https://api.github.com/repos/' + this.repo + endpoint;
    const opts = {
      method: method,
      headers: {
        'Authorization': 'token ' + this.token,
        'Accept': 'application/vnd.github.v3+json',
      },
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message || 'GitHub API error: ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}
