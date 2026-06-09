import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, Lock, MessageSquare, Users } from 'lucide-react'
import { setDocumentAccessOverride, setFolderAccessOverride } from '../lib/crud'
import { treeKeys, useTree } from '../hooks/useTree'
import { toast } from '../lib/toast'
import type { DocumentRec, MemberRole } from '../lib/types'
import Modal from './Modal'
import ResourceAccessManager from './ResourceAccess'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

// What the dialog is editing: a folder or a document, plus its project, current cap, and privacy.
export interface PermissionsTarget {
  kind: 'folder' | 'document'
  id: string
  name: string
  projectId: string
  accessOverride: MemberRole | null
  isPrivate: boolean
}

// The override is stored as a member_role (or null = inherit). The picker only offers the restricting
// tiers — 'editor' would be a no-op cap (editors are already the ceiling), so it isn't surfaced.
const INHERIT = 'inherit'
type OverrideValue = typeof INHERIT | Extract<MemberRole, 'commenter' | 'viewer'>

function options(kind: PermissionsTarget['kind']) {
  const what = kind === 'folder' ? 'this folder and its documents' : 'this document'
  return [
    {
      value: INHERIT as OverrideValue,
      label: 'Use project permissions',
      hint: 'Everyone keeps the access their project role gives them.',
      icon: Users,
    },
    {
      value: 'commenter' as OverrideValue,
      label: 'Comment only',
      hint: `Others can comment and suggest edits to ${what}, but not change ${
        kind === 'folder' ? 'them' : 'it'
      } directly.`,
      icon: MessageSquare,
    },
    {
      value: 'viewer' as OverrideValue,
      label: 'View only',
      hint: `Others can only read ${what} — no editing, commenting, or suggesting.`,
      icon: Eye,
    },
  ]
}

/**
 * Owner-only dialog for a folder's or document's access. Two orthogonal controls (markdown only):
 *  • Private — hide it from everyone except people you give access to (migrations 0023/0024).
 *  • A cap (View only / Comment only) that DOWNGRADES the tier without hiding (0018/0020). Only shown
 *    when the item isn't private, since privacy supersedes the cap. Enforced in the DB; this is the UI.
 */
export default function PermissionsDialog({
  target,
  onClose,
}: {
  target: PermissionsTarget
  onClose: () => void
}) {
  const { refresh, projects } = useTree()
  const qc = useQueryClient()
  const project = projects.find((p) => p.id === target.projectId) ?? null
  const [isPrivate, setIsPrivate] = useState(target.isPrivate)
  const [value, setValue] = useState<OverrideValue>(
    target.accessOverride === 'commenter' || target.accessOverride === 'viewer'
      ? target.accessOverride
      : INHERIT,
  )
  const [busy, setBusy] = useState(false)
  const opts = options(target.kind)

  const change = async (next: OverrideValue) => {
    const override: MemberRole | null = next === INHERIT ? null : next
    const prev = value
    setValue(next)
    setBusy(true)
    try {
      if (target.kind === 'document') {
        await setDocumentAccessOverride(target.id, override)
        // Keep the open document's detail cache in sync so an active editor re-gates immediately.
        qc.setQueryData<DocumentRec>(treeKeys.document(target.id), (old) =>
          old ? { ...old, access_override: override } : old,
        )
      } else {
        await setFolderAccessOverride(target.id, override)
      }
      await refresh()
      toast('success', override ? 'Access restricted' : 'Now uses project permissions')
    } catch (e) {
      setValue(prev)
      toast('error', e instanceof Error ? e.message : 'Couldn’t update permissions')
    } finally {
      setBusy(false)
    }
  }

  const active = opts.find((o) => o.value === value) ?? opts[0]

  return (
    <Modal
      title={target.kind === 'folder' ? 'Folder access' : 'Document access'}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {project && (
          <ResourceAccessManager
            project={project}
            t={{ kind: target.kind, id: target.id, name: target.name, projectId: target.projectId }}
            isPrivate={isPrivate}
            onChanged={() => void refresh()}
            onPrivacyChange={setIsPrivate}
          />
        )}

        {/* The downgrade cap is moot once an item is private (the grant defines the tier). */}
        {!isPrivate && (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              Or cap what everyone else can do with{' '}
              <span className="font-medium text-foreground">{target.name}</span>, without hiding it. As the
              owner, this never affects you.
            </p>

            <Select value={value} disabled={busy} onValueChange={(v) => void change(v as OverrideValue)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opts.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <o.icon className="size-4 text-muted-foreground" />
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {value === INHERIT ? <Users className="size-4 shrink-0" /> : <Lock className="size-4 shrink-0" />}
              {active.hint}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
