// Docker build step: download the search model (118 MB, too big for GitHub) from its private Hugging Face
// repo and verify its SHA-256, so a wrong or tampered file fails the build.
// The token comes from a BuildKit secret (/run/secrets/hf_token) and is never stored in an image layer.
// Usage (inside the Dockerfile): node docker/fetch-model.js <repo> <sha256> <output file>
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [repo, sha256, out] = process.argv.slice(2);
const FILE = 'onnx/model_quantized.onnx';

async function main() {
  const token = fs.readFileSync('/run/secrets/hf_token', 'utf8').trim();
  const url = `https://huggingface.co/${repo}/resolve/main/${FILE}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url} (check HF_TOKEN and repo access)`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== sha256) throw new Error(`checksum mismatch for ${FILE}: expected ${sha256}, got ${got}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`model ok: ${FILE} ${(buf.length / 1e6).toFixed(0)} MB sha256 ${got}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
