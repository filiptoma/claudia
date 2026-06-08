// Upload the LaTeX engine bundle (public/assets/busytex/*) to the production R2 bucket over R2's
// S3-compatible API — which, unlike `wrangler r2 object put` (hard-capped at 300 MiB), does multipart,
// so the 324 MiB texlive-extra.data uploads fine. This is the recommended uploader; nothing is dropped.
//
// NO AWS ACCOUNT INVOLVED. @aws-sdk/client-s3 is just a library that speaks the S3 protocol; here it
// talks to Cloudflare R2. The only credential is a free Cloudflare R2 API token (Object Read & Write).
//
// ── Setup (one-time) ────────────────────────────────────────────────────────────────────────────
//   1. Cloudflare dashboard → R2 → "Manage R2 API Tokens" → Create API token → permission
//      "Object Read & Write", scoped to the bucket. Copy the Access Key ID + Secret Access Key.
//   2. Add them to your gitignored `.env.production` (NOT VITE_-prefixed, so Vite never bundles them):
//        R2_ACCESS_KEY_ID=...
//        R2_SECRET_ACCESS_KEY=...
//
// ── Run (now and for every future asset upload) ───────────────────────────────────────────────────
//        npm run upload:tex-assets        # loads .env.production automatically (--env-file-if-exists)
//
//   Credentials come from the environment, so they never land in your shell history. Optional env:
//   R2_ACCOUNT_ID (default below), BUSYTEX_BUCKET (default "claudia-busytex").
//
// Re-run `npm run fetch:tex-assets` then `npm run upload:tex-assets` to push an engine upgrade
// (overwrites existing objects).

import { readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? 'bd6590513616e241374222a01e93b3e6'
const BUCKET = process.env.BUSYTEX_BUCKET ?? 'claudia-busytex'
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY

if (!ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.error(
    'Missing credentials. Create an R2 API token (dashboard → R2 → Manage R2 API Tokens,\n' +
      '"Object Read & Write"), then add to frontend/.env.production:\n' +
      '  R2_ACCESS_KEY_ID=...\n  R2_SECRET_ACCESS_KEY=...\nand re-run `npm run upload:tex-assets`.',
  )
  process.exit(1)
}

const TYPES = { wasm: 'application/wasm', js: 'text/javascript', json: 'application/json', txt: 'text/plain' }
const contentType = (name) => TYPES[name.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream'

const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'busytex')

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
})

const files = (await readdir(ASSET_DIR, { withFileTypes: true }))
  .filter((d) => d.isFile())
  .map((d) => d.name)
  .sort()

if (files.length === 0) {
  console.error(`No files in ${ASSET_DIR}. Run 'npm run fetch:tex-assets' first.`)
  process.exit(1)
}

console.log(`Uploading ${files.length} file(s) → r2://${BUCKET} (${ACCOUNT_ID})\n`)

for (const name of files) {
  const path = join(ASSET_DIR, name)
  const { size } = await stat(path)
  const mib = (size / 1048576).toFixed(1)
  process.stdout.write(`→ ${name.padEnd(38)} ${mib.padStart(8)} MiB  `)

  const upload = new Upload({
    client: s3,
    params: { Bucket: BUCKET, Key: name, Body: createReadStream(path), ContentType: contentType(name) },
    partSize: 100 * 1024 * 1024, // 100 MiB parts → multipart kicks in automatically past that
    queueSize: 4,
    leavePartsOnError: false,
  })
  await upload.done()
  console.log('✓')
}

console.log(`\nDone. All ${files.length} object(s) uploaded. Verify in the dashboard or with:`)
console.log(`  npx wrangler r2 object get ${BUCKET}/texlive-extra.data --file /tmp/check.data --remote && ls -lh /tmp/check.data`)
