module.exports = async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    res.status(400).send('Missing code parameter');
    return;
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.OAUTH_CLIENT_ID,
        client_secret: process.env.OAUTH_CLIENT_SECRET,
        code: code,
      }),
    });

    const data = await response.json();

    if (data.error) {
      res.status(400).send(`OAuth error: ${data.error_description}`);
      return;
    }

    // Decap CMS expects the token to be passed back via postMessage
    const html = `
<!DOCTYPE html>
<html>
<body>
<script>
(function() {
  function recieveMessage(e) {
    console.log("recieveMessage %o", e);
    window.opener.postMessage(
      'authorization:github:success:${JSON.stringify({ token: data.access_token, provider: "github" })}',
      e.origin
    );
    window.removeEventListener("message", recieveMessage, false);
  }
  window.addEventListener("message", recieveMessage, false);
  window.opener.postMessage("authorizing:github", "*");
})();
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Authentication failed');
  }
};
