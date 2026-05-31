import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import rehypeHighlight from 'rehype-highlight'

// react-markdown v10: no `className` prop on the component (wrap with a div), and no `inline`
// prop on `code` — inline vs. fenced code is distinguished in CSS (.md code vs .md pre code).
const components: Components = {
  img: ({ node, ...props }) => (
    <span className="md-img-plate">
      <img {...props} alt={props.alt ?? ''} loading="lazy" />
    </span>
  ),
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

export default function Markdown({ children }: { children: string }) {
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
