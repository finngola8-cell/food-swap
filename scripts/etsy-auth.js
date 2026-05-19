'use strict';

/**
 * One-time Etsy OAuth2 PKCE token exchange.
 * Run: node scripts/etsy-auth.js
 * Then paste the redirect URL from your browser when prompted.
 */

const http = require('http');
const crypto = require('crypto');
const https = require('https');
const readline = require('readline');

const CLIENT_ID = process.env.ETSY_API_KEY;
if (!CLIENT_ID) { console.error('Set ETSY_API_KEY first'); process.exit(1); }

const REDIRECT_URI = 'http://localhost:3003/callback';
const SCOPES = 'listings_w listings_r shops_r shops_w transactions_r address_r email_r';

// PKCE
const codeVerifier = crypto.randomBytes(64).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const authUrl =
  `https://www.etsy.com/oauth/connect` +
  `?response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&client_id=${CLIENT_ID}` +
  `&state=${state}` +
  `&code_challenge=${codeChallenge}` +
  `&code_challenge_method=S256`;

console.log('\n1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Approve the app. You will be redirected to localhost:3003/callback.');
console.log('   (The page will appear to fail — that is fine.)\n');

// Spin up a local server to catch the redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3003');
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (!code) { res.end('No code received'); return; }
  if (returnedState !== state) { res.end('State mismatch — CSRF?'); return; }

  res.end('✓ Auth code received! Check your terminal.');

  // Exchange code for tokens
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code,
    code_verifier: codeVerifier,
  });

  const options = {
    hostname: 'api.etsy.com',
    path: '/v3/public/oauth/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };

  const tokenReq = https.request(options, (tokenRes) => {
    let data = '';
    tokenRes.on('data', (chunk) => (data += chunk));
    tokenRes.on('end', () => {
      const tokens = JSON.parse(data);
      if (tokens.error) {
        console.error('\n❌ Token exchange failed:', tokens);
        process.exit(1);
      }
      console.log('\n✅  SUCCESS — add these to your .env:\n');
      console.log(`ETSY_ACCESS_TOKEN=${tokens.access_token}`);
      console.log(`ETSY_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('\nToken expires in:', tokens.expires_in, 'seconds (~', Math.round(tokens.expires_in / 3600), 'hours)');
      console.log('The system will auto-refresh it when it expires.\n');
      server.close();
    });
  });

  tokenReq.on('error', (err) => console.error('Token request error:', err));
  tokenReq.write(body);
  tokenReq.end();
});

server.listen(3003, () => {
  console.log('Waiting for Etsy redirect on http://localhost:3003/callback …\n');
});
