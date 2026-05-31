/**
 * Optional bulk importer — seed Claudia from a folder of markdown files.
 *
 *   PB_URL=http://127.0.0.1:8090 PB_ADMIN_EMAIL=you@example.com PB_ADMIN_PW=secret \
 *     npm run import -- --project "My Course" --dir /path/to/markdown
 *
 * Behaviour:
 *   - authenticates as the PocketBase superuser (bypasses API rules)
 *   - creates/reuses a project from --project (slug derived from the name)
 *   - for each *.md (sorted): slug from filename, title from the first `# H1`
 *     (fallback: filename), order from a leading number in the filename if present
 *   - one level of sub-folders maps to project folders
 *   - local (relative) image links are uploaded to `media` and rewritten to PB URLs
 *   - documents are upserted by (project, slug) so re-runs don't duplicate
 *
 * Nothing is hardcoded about specific filenames or content.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import PocketBase from 'pocketbase'

// ---- args / env ----
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL
const PB_ADMIN_PW = process.env.PB_ADMIN_PW
const projectName = arg('project')
const dir = arg('dir')

if (!PB_ADMIN_EMAIL || !PB_ADMIN_PW || !projectName || !dir) {
  console.error(
    'Missing args. Required: env PB_ADMIN_EMAIL, PB_ADMIN_PW and flags --project "Name" --dir <folder>',
  )
  process.exit(1)
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'untitled'

const pb = new PocketBase(PB_URL)

async function upsert(
  collection: string,
  filter: string,
  data: Record<string, unknown>,
): Promise<{ id: string }> {
  try {
    const existing = await pb.collection(collection).getFirstListItem(filter, { requestKey: null })
    return await pb.collection(collection).update(existing.id, data)
  } catch {
    return await pb.collection(collection).create(data)
  }
}

// Upload one local image file and return its public PocketBase URL.
async function uploadImage(absPath: string, documentId: string): Promise<string> {
  const buf = await readFile(absPath)
  const name = basename(absPath)
  const fd = new FormData()
  fd.append('file', new Blob([buf]), name)
  fd.append('document', documentId)
  fd.append('alt', name.replace(/\.[^.]+$/, ''))
  const rec = await pb.collection('media').create(fd)
  return pb.files.getURL(rec, rec.file as string)
}

// Replace relative ![alt](path) image links with uploaded PB URLs.
async function rewriteImages(content: string, mdDir: string, documentId: string): Promise<string> {
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g
  const tasks: { full: string; alt: string; url: string }[] = []
  for (const m of content.matchAll(re)) {
    const [full, alt, link] = m
    if (/^(https?:)?\/\//i.test(link) || link.startsWith('data:')) continue // already remote
    const abs = resolve(mdDir, link.split(/[?#]/)[0])
    try {
      const url = await uploadImage(abs, documentId)
      tasks.push({ full, alt, url })
    } catch (e) {
      console.warn(`  ! could not upload image ${link}: ${e instanceof Error ? e.message : e}`)
    }
  }
  let out = content
  for (const t of tasks) out = out.split(t.full).join(`![${t.alt}](${t.url})`)
  return out
}

function deriveDoc(file: string, raw: string) {
  const name = basename(file, extname(file))
  const h1 = raw.match(/^\s*#\s+(.+?)\s*$/m)
  const title = h1 ? h1[1] : name
  const slug = slugify(name)
  const numMatch = name.match(/^(\d+)/)
  const order = numMatch ? Number(numMatch[1]) : 0
  return { title, slug, order }
}

async function importMarkdownFile(file: string, projectId: string, folderId: string) {
  const raw = await readFile(file, 'utf8')
  const { title, slug, order } = deriveDoc(file, raw)
  // Create/find the doc first (need its id to attach media), then rewrite images and update.
  const doc = await upsert(
    'documents',
    pb.filter('project = {:p} && slug = {:s}', { p: projectId, s: slug }),
    { title, slug, project: projectId, folder: folderId, content: raw, order },
  )
  const content = await rewriteImages(raw, dirname(file), doc.id)
  if (content !== raw) await pb.collection('documents').update(doc.id, { content })
  console.log(`  ✓ ${slug}${folderId ? ' (in folder)' : ''}`)
}

async function main() {
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL!, PB_ADMIN_PW!)

  const projectSlug = slugify(projectName!)
  const project = await upsert(
    'projects',
    pb.filter('slug = {:s}', { s: projectSlug }),
    { name: projectName, slug: projectSlug, order: 0 },
  )
  console.log(`Project "${projectName}" (${project.id})`)

  const root = resolve(dir!)
  const entries = await readdir(root)
  entries.sort()

  for (const entry of entries) {
    const full = join(root, entry)
    const st = await stat(full)
    if (st.isDirectory()) {
      // one level of sub-folders -> project folders
      const folderSlug = slugify(entry)
      const folder = await upsert(
        'folders',
        pb.filter('project = {:p} && slug = {:s}', { p: project.id, s: folderSlug }),
        { name: entry, slug: folderSlug, project: project.id, order: 0 },
      )
      const subEntries = (await readdir(full)).filter((f) => f.endsWith('.md')).sort()
      console.log(` folder "${entry}"`)
      for (const f of subEntries) await importMarkdownFile(join(full, f), project.id, folder.id)
    } else if (entry.endsWith('.md')) {
      await importMarkdownFile(full, project.id, '')
    }
  }
  console.log('Done.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
