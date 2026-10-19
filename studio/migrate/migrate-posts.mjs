// migrate-posts.mjs
// Converts the Astro markdown posts in ../src/content/blog/ into an NDJSON file
// that `sanity dataset import` can load, uploading cover and inline images along the way.
//
// Run from inside the studio/ folder:
//   node migrate/migrate-posts.mjs
//   npx sanity dataset import migrate/posts.ndjson production --replace

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import matter from 'gray-matter'
import {marked} from 'marked'
import {JSDOM} from 'jsdom'
import {htmlToBlocks} from '@portabletext/block-tools'
import {Schema} from '@sanity/schema'
import {builtinTypes} from '@sanity/schema/_internal'

const here = path.dirname(fileURLToPath(import.meta.url))
const SITE_ROOT = path.resolve(here, '..', '..') // guiding-point-site/
const BLOG_DIR = path.join(SITE_ROOT, 'src', 'content', 'blog')
const OUT_FILE = path.join(here, 'posts.ndjson')

// Where to look for images referenced like "/images/foo.webp" or "./foo.png"
const IMAGE_SEARCH_DIRS = [
  path.join(SITE_ROOT, 'public'),
  path.join(SITE_ROOT, 'public', 'images'),
  path.join(SITE_ROOT, 'src', 'assets'),
  path.join(SITE_ROOT, 'src', 'assets', 'images'),
  BLOG_DIR,
]

// Must match the body field in schemaTypes/post.ts
const bodyType = Schema.compile({
  name: 'migration',
  types: [
    ...builtinTypes,
    {
      type: 'object',
      name: 'post',
      fields: [
        {
          name: 'body',
          type: 'array',
          of: [{type: 'block'}, {type: 'image', fields: [{name: 'alt', type: 'string'}]}],
        },
      ],
    },
  ],
})
  .get('post')
  .fields.find((f) => f.name === 'body').type

const warnings = []

function findImage(ref, postFile) {
  if (!ref) return null
  if (/^https?:\/\//.test(ref)) return null // remote images are left out; flagged below
  const clean = ref.replace(/^\.?\//, '')
  const candidates = [
    path.join(SITE_ROOT, 'public', clean),
    path.resolve(path.dirname(postFile), ref),
    ...IMAGE_SEARCH_DIRS.map((d) => path.join(d, path.basename(clean))),
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

// Sanity's importer uploads any value shaped like this and swaps in a real asset reference.
const assetRef = (absPath) => `image@${pathToFileURL(absPath).href}`

function toDate(value) {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

function convertBody(markdown, postFile, slug) {
  const html = marked.parse(markdown)
  return htmlToBlocks(html, bodyType, {
    parseHtml: (h) => new JSDOM(h).window.document,
    rules: [
      {
        deserialize(el, _next, createBlock) {
          if (el.tagName?.toLowerCase() !== 'img') return undefined
          const src = el.getAttribute('src')
          const file = findImage(src, postFile)
          if (!file) {
            warnings.push(`[${slug}] inline image not found, skipped: ${src}`)
            return undefined
          }
          return createBlock({
            _type: 'image',
            alt: el.getAttribute('alt') ?? '',
            _sanityAsset: assetRef(file),
          })
        },
      },
    ],
  }).filter(
    // drop empty paragraphs left behind by skipped images or stray spacing
    (b) => b._type !== 'block' || b.children?.some((c) => c.text?.trim()),
  )
}

const files = fs
  .readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
  .sort()

const docs = files.map((file) => {
  const postFile = path.join(BLOG_DIR, file)
  const {data: fm, content} = matter(fs.readFileSync(postFile, 'utf8'))
  const slug = file.replace(/\.mdx?$/, '')
  const baseId = `post-${slug}`

  const doc = {
    _id: fm.draft ? `drafts.${baseId}` : baseId,
    _type: 'post',
    title: fm.title,
    slug: {_type: 'slug', current: slug},
    description: fm.description,
    pubDate: toDate(fm.pubDate),
    updatedDate: toDate(fm.updatedDate),
    author: fm.author ?? 'Zipporah Banyay',
    category: fm.category,
    audience: fm.audience ?? ['both'],
    tags: fm.tags ?? [],
    featured: Boolean(fm.featured),
    body: convertBody(content, postFile, slug),
  }

  if (fm.coverImage) {
    const file = findImage(fm.coverImage, postFile)
    if (file) {
      doc.coverImage = {_type: 'image', alt: fm.coverAlt ?? '', _sanityAsset: assetRef(file)}
    } else {
      warnings.push(`[${slug}] cover image not found: ${fm.coverImage}`)
    }
  }

  if (fm.linkedin) {
    doc.linkedin = {
      hook: fm.linkedin.hook,
      cta: fm.linkedin.cta,
      hashtags: fm.linkedin.hashtags ?? [],
    }
  }

  if (fm.title && fm.title.length > 60) {
    warnings.push(`[${slug}] title is ${fm.title.length} chars (over 60)`)
  }

  // Drop empty optional fields so the documents stay tidy
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k]
  return doc
})

fs.writeFileSync(OUT_FILE, docs.map((d) => JSON.stringify(d)).join('\n') + '\n')

console.log(`\nConverted ${docs.length} posts → ${path.relative(process.cwd(), OUT_FILE)}`)
for (const d of docs) {
  const status = d._id.startsWith('drafts.') ? 'draft' : 'published'
  const cover = d.coverImage ? 'cover ✓' : 'no cover'
  console.log(`  • ${d.slug.current}  (${status}, ${d.body.length} blocks, ${cover})`)
}
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} thing(s) to check:`)
  warnings.forEach((w) => console.log('  - ' + w))
} else {
  console.log('\nNo warnings.')
}
console.log('\nNext: npx sanity dataset import migrate/posts.ndjson production --replace\n')