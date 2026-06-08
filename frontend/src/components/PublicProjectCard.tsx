import { Link } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ProfileAvatar from './ProfileAvatar'
import ProjectTypeBadge from './ProjectTypeBadge'
import { projectPath } from '../lib/paths'
import type { PublicProject } from '../lib/types'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export default function PublicProjectCard({ project }: { project: PublicProject }) {
  return (
    <Link
      to={projectPath(project.slug)}
      className="group flex transform-gpu flex-col rounded-xl border border-border bg-card shadow-sm transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {/* Name + document count */}
      <div className="flex items-start gap-3 p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent2/12 text-accent2">
          <BookOpen className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <div className="line-clamp-2 min-w-0 flex-1 font-semibold leading-snug transition-colors group-hover:text-primary">
              {project.name}
            </div>
            <ProjectTypeBadge type={project.type} className="mt-0.5" />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {project.document_count} {project.document_count === 1 ? 'document' : 'documents'}
          </div>
        </div>
      </div>

      {/* Owner + dates in a single footer row */}
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        {project.owner ? (
          <ProfileAvatar
            userId={project.owner}
            name={project.owner_name}
            email={null}
            avatarUrl={project.owner_avatar_url}
            variant="inline"
            size="sm"
            noLink
          />
        ) : (
          <span />
        )}
        <div className="flex shrink-0 gap-3 text-xs text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default">Updated {fmtDate(project.updated_at)}</span>
            </TooltipTrigger>
            <TooltipContent>{fmtDateTime(project.updated_at)}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default">Created {fmtDate(project.created_at)}</span>
            </TooltipTrigger>
            <TooltipContent>{fmtDateTime(project.created_at)}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </Link>
  )
}
