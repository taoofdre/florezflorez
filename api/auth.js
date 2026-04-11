module.exports = function handler(req, res) {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const scope = 'repo,user';
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=${scope}`;
  res.redirect(302, authUrl);
};
