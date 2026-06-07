import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, Lock, MessageSquare, Users } from 'lucide-react'
import { setDocumentAccessOverride, setFolderAccessOverride } from '../lib/crud'
import { treeKeys, useTree } from '../hooks/useTree'
import { toast } from '../lib/toast'
import type { DocumentRec, MemberRole } from '../lib/types'
import Modal from './Modal'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// What the dialog is editing: a folder or a document, plus its current cap.
export interface PermissionsTarget {
  kind: 'folder' | 'document'
  id: string
  name: string
  accessOverride: MemberRole | null
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
 * Owner-only dialog to cap a folder's or document's permissions. The cap applies to everyone EXCEPT the
 * project owner (a folder cap also covers the documents inside it). Restrict-only — never grants access
 * a project role doesn't already give. Enforced in the DB (migrations 0018/0020); this is the control.
 */
export default function PermissionsDialog({
  target,
  onClose,
}: {
  target: PermissionsTarget
  onClose: () => void
}) {
  const { refresh } = useTree()
  const qc = useQueryClient()
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
      title={target.kind === 'folder' ? 'Folder permissions' : 'Document permissions'}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Cap what other people can do with{' '}
          <span className="font-medium text-foreground">{target.name}</span>, regardless of their role on
          the rest of the project. As the owner, this never affects you.
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
    </Modal>
  )
}
