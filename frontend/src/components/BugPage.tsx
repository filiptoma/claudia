import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Bug, CheckCircle } from 'lucide-react'
import { submitFeedback } from '../lib/crud'
import { useAuth } from '../context/AuthContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APP_NAME } from '../lib/brand'

const schema = z.object({
  title: z.string().trim().min(5, 'Please provide a short summary (at least 5 characters)').max(200),
  description: z
    .string()
    .trim()
    .min(10, 'Please describe the issue in more detail (at least 10 characters)')
    .max(5000),
  email: z.string().trim().email('Enter a valid email address').or(z.literal('')).optional(),
})
type FormValues = z.infer<typeof schema>

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-destructive">{message}</p>
}

export default function BugPage() {
  useDocumentTitle(`Report a bug · ${APP_NAME}`)
  const { user, uid } = useAuth()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', description: '', email: user?.email ?? '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setBusy(true)
    setServerError(null)
    try {
      await submitFeedback({
        type: 'bug',
        title: values.title,
        description: values.description,
        email: values.email || user?.email || null,
        userId: uid,
      })
      setDone(true)
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  })

  if (done) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-5 px-8 pt-24 pb-20 text-center max-md:px-5">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/12 ring-1 ring-primary/20">
          <CheckCircle className="size-8 text-primary" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">Bug report received</h1>
        <p className="text-muted-foreground">
          Thanks for taking the time to report this. We'll look into it.
        </p>
        <Button asChild variant="outline">
          <Link to="/">Back to dashboard</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-8 pt-10 pb-20 max-md:px-5 max-md:pt-14">
      <div className="mb-7 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-destructive/12 text-destructive">
          <Bug className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Report a bug</h1>
          <p className="text-sm text-muted-foreground">Something broken? Tell us what happened.</p>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        noValidate
        autoComplete="off"
        className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bug-title">Summary</Label>
          <Input
            id="bug-title"
            placeholder="e.g. Clicking 'Save' does nothing on Firefox"
            aria-invalid={!!errors.title}
            {...register('title')}
          />
          <FieldError message={errors.title?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bug-desc">Description</Label>
          <textarea
            id="bug-desc"
            rows={6}
            placeholder="Steps to reproduce, expected vs. actual behaviour, browser/OS…"
            aria-invalid={!!errors.description}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 aria-invalid:border-destructive"
            {...register('description')}
          />
          <FieldError message={errors.description?.message} />
        </div>

        {!user && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bug-email">Your email (optional)</Label>
            <Input
              id="bug-email"
              type="email"
              placeholder="so we can follow up if needed"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            <FieldError message={errors.email?.message} />
          </div>
        )}

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}

        <Button type="submit" disabled={busy} className="self-start">
          {busy ? 'Sending…' : 'Submit bug report'}
        </Button>
      </form>
    </div>
  )
}
