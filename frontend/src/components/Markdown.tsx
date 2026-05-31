import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import rehypeHighlight from 'rehype-highlight'
import { STORAGE_PREFIX } from '../lib/storage'

// react-markdown v10: no `inline`/`className` props — wrap in a div, distinguish inline vs fenced
// code in CSS. `storage:<path>` image sources are swapped for signed URLs from the `images` map.
function buildComponents(images: Record<string, string>): Components {
  return {
    img: ({ node, src, ...props }) => {
      let resolved = typeof src === 'string' ? src : ''
      if (resolved.startsWith(STORAGE_PREFIX)) resolved = images[resolved.slice(STORAGE_PREFIX.length)] ?? ''
      return (
        <span className="md-img-plate">
          <img {...props} src={resolved} alt={props.alt ?? ''} loading="lazy" />
        </span>
      )
    },
    table: ({ node, ...props }) => (
      <div className="md-table-wrap">
        <table {...props} />
      </div>
    ),
    a: ({ node, href, ...props }) => {
      const external = !!href && /^https?:\/\//i.test(href)
      return (
        <a
          href={href}
          {...props}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        />
      )
    },
  }
}

export default function Markdown({
  children,
  images = {},
}: {
  children: string
  images?: Record<string, string>
}) {
  const components = useMemo(() => buildComponents(images), [images])
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
