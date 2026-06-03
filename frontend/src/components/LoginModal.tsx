import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Modal from './Modal'
import { useAuth } from '../context/AuthContext'
import { toast } from '../lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GoogleIcon, GitHubIcon } from './ProviderIcons'

const schema = z.object({
  name: z.string().trim().optional(),
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
type FormValues = z.infer<typeof schema>

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-destructive">{message}</p>
}

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const { loginEmail, loginOAuth, register: registerUser } = useAuth()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // Set to the email address once a verification email has been sent (swaps the modal to a
  // "check your email" confirmation view instead of closing).
  const [verifySentTo, setVerifySentTo] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  })

  // OAuth providers are configured only on the PROD Supabase project, so only offer them when this
  // build targets prod (mode 'production' → .env.production). In dev (npm run dev → dev DB) the
  // buttons are hidden and statically stripped from the bundle; use email/password locally.
  const oauthEnabled = import.meta.env.PROD

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setServerError(null)
    try {
      await fn()
      onClose()
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (values: FormValues) => {
    if (tab === 'login') {
      void run(async () => {
        await loginEmail(values.email, values.password)
        toast('success', 'Signed in')
      })
      return
    }
    // Register: if the project requires email confirmation, keep the modal open and switch it to a
    // "check your email" view (plus a toast). Otherwise (auto-signed-in) just close.
    setBusy(true)
    setServerError(null)
    void (async () => {
      try {
        const { needsConfirmation } = await registerUser({
          email: values.email,
          password: values.password,
          name: values.name ?? '',
        })
        if (needsConfirmation) {
          toast('success', 'Verification email sent — check your inbox to confirm your account.')
          setVerifySentTo(values.email)
        } else {
          toast('success', 'Account created')
          onClose()
        }
      } catch (e) {
        setServerError(e instanceof Error ? e.message : 'Something went wrong')
      } finally {
        setBusy(false)
      }
    })()
  }

  if (verifySentTo) {
    return (
      <Modal title="Check your email" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            We sent a verification link to{' '}
            <span className="font-medium text-foreground">{verifySentTo}</span>. Click it to activate
            your account, then sign in.
          </p>
          <Button onClick={onClose}>Got it</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={tab === 'login' ? 'Welcome back' : 'Create your account'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as 'login' | 'register'); setServerError(null) }}>
          <TabsList className="w-full">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>
        </Tabs>

        {oauthEnabled && (
          <>
            <div className="flex flex-col gap-2.5">
              <Button
                variant="outline"
                className="h-11 justify-center gap-3 font-medium"
                disabled={busy}
                onClick={() => void run(() => loginOAuth('google'))}
              >
                <GoogleIcon className="size-4.5" />
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="h-11 justify-center gap-3 font-medium"
                disabled={busy}
                onClick={() => void run(() => loginOAuth('github'))}
              >
                <GitHubIcon className="size-4.5" />
                Continue with GitHub
              </Button>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              <span>or continue with email</span>
              <Separator className="flex-1" />
            </div>
          </>
        )}

        <form className="flex flex-col gap-3" onSubmit={handleSubmit(onSubmit)} noValidate>
          {tab === 'register' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auth-name">Name</Label>
              <Input id="auth-name" placeholder="Jane Doe" autoComplete="name" {...register('name')} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            <FieldError message={errors.email?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              placeholder={tab === 'register' ? 'At least 8 characters' : 'Your password'}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            <FieldError message={errors.password?.message} />
          </div>
          {serverError && <div className="text-sm text-destructive">{serverError}</div>}
          <Button type="submit" disabled={busy} className="mt-1">
            {busy ? 'Please wait…' : tab === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
      </div>
    </Modal>
  )
}
