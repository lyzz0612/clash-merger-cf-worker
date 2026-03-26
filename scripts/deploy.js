const { readFileSync, writeFileSync } = require('fs');
const { execSync } = require('child_process');

const kvId = process.env.KV_NAMESPACE_ID;

if (kvId) {
  const toml = readFileSync('wrangler.toml', 'utf8');
  writeFileSync('wrangler.toml', toml.replace('placeholder-kv-id', kvId));
  console.log(`KV namespace ID set to: ${kvId}`);
}

execSync('npx wrangler deploy', { stdio: 'inherit' });
