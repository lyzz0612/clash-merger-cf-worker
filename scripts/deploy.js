const { readFileSync, writeFileSync } = require('fs');
const { execSync } = require('child_process');

let toml = readFileSync('wrangler.toml', 'utf8');
const kvId = process.env.KV_NAMESPACE_ID;

if (kvId) {
  toml = toml.replace('placeholder-kv-id', kvId);
  writeFileSync('wrangler.toml', toml);
  console.log(`KV namespace ID set to: ${kvId}`);
} else if (toml.includes('placeholder-kv-id')) {
  // 只去掉占位 id，保留 binding：wrangler 会继承线上已有的同名 KV 绑定（没有则自动创建），
  // 不能整块删除，否则部署时会把 Dashboard 里的 CLASH_KV 绑定一起清掉
  toml = toml.replace(/^id\s*=\s*"placeholder-kv-id"\r?\n/m, '');
  writeFileSync('wrangler.toml', toml);
  console.log('KV placeholder id removed, inheriting existing CLASH_KV binding');
}

execSync('npx wrangler deploy --keep-vars', { stdio: 'inherit' });
