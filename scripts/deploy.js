const { readFileSync, writeFileSync } = require('fs');
const { execSync } = require('child_process');

let toml = readFileSync('wrangler.toml', 'utf8');
const kvId = process.env.KV_NAMESPACE_ID;

if (kvId) {
  toml = toml.replace('placeholder-kv-id', kvId);
  writeFileSync('wrangler.toml', toml);
  console.log(`KV namespace ID set to: ${kvId}`);
} else if (toml.includes('placeholder-kv-id')) {
  toml = toml.replace(/\[\[kv_namespaces\]\]\r?\nbinding\s*=\s*"CLASH_KV"\r?\nid\s*=\s*"placeholder-kv-id"\r?\n\r?\n?/, '');
  writeFileSync('wrangler.toml', toml);
  console.log('KV placeholder removed, using dashboard bindings');
}

execSync('npx wrangler deploy --keep-vars', { stdio: 'inherit' });
