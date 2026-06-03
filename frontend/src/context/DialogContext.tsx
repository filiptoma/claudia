import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Modal from '../components/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface PromptOpts {
  title: string
  label?: string
  defaultValue?: string
  confirmText?: string
  placeholder?: string
}
interface ConfirmOpts {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}

interface DialogApi {
  prompt: (o: PromptOpts) => Promise<string | null>
  confirm: (o: ConfirmOpts) => Promise<boolean>
}

const Ctx = createContext<DialogApi | null>(null)

type State =
  | { kind: 'prompt'; opts: PromptOpts }
  | { kind: 'confirm'; opts: ConfirmOpts }
  | null

const PROMPT_FORM_ID = 'claudia-prompt-form'

// Self-contained so each prompt gets a fresh react-hook-form instance (no manual reset needed).
function PromptDialog({
  opts,
  onCancel,
  onSubmit,
}: {
  opts: PromptOpts
  onCancel: () => void
  onSubmit: (value: string) => void
}) {
  const schema = z.object({
    value: z.string().trim().min(1, `${opts.label ?? 'This field'} is required`),
  })
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ value: string }>({
    resolver: zodResolver(schema),
    defaultValues: { value: opts.defaultValue ?? '' },
  })

  return (
    <Modal
      title={opts.title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={PROMPT_FORM_ID}>
            {opts.confirmText ?? 'OK'}
          </Button>
        </>
      }
    >
      <form
        id={PROMPT_FORM_ID}
        className="flex flex-col gap-2"
        onSubmit={handleSubmit(({ value }) => onSubmit(value.trim()))}
        noValidate
      >
        {opts.label && <Label htmlFor="claudia-prompt-input">{opts.label}</Label>}
        <Input
          id="claudia-prompt-input"
          autoFocus
          placeholder={opts.placeholder}
          aria-invalid={!!errors.value}
          {...register('value')}
        />
        {errors.value && <p className="text-xs text-destructive">{errors.value.message}</p>}
      </form>
    </Modal>
  )
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null)
  const resolver = useRef<((v: string | null | boolean) => void) | null>(null)

  const settle = useCallback((result: string | null | boolean) => {
    resolver.current?.(result)
    resolver.current = null
    setState(null)
  }, [])

  const prompt = useCallback((o: PromptOpts) => {
    setState({ kind: 'prompt', opts: o })
    return new Promise<string | null>((res) => {
      resolver.current = res as (v: string | null | boolean) => void
    })
  }, [])

  const confirm = useCallback((o: ConfirmOpts) => {
    setState({ kind: 'confirm', opts: o })
    return new Promise<boolean>((res) => {
      resolver.current = res as (v: string | null | boolean) => void
    })
  }, [])

  return (
    <Ctx.Provider value={{ prompt, confirm }}>
      {children}

      {state?.kind === 'prompt' && (
        <PromptDialog
          opts={state.opts}
          onCancel={() => settle(null)}
          onSubmit={(value) => settle(value)}
        />
      )}

      {state?.kind === 'confirm' && (
        <Modal
          title={state.opts.title}
          onClose={() => settle(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => settle(false)}>
                Cancel
              </Button>
              <Button
                variant={state.opts.danger ? 'destructive' : 'default'}
                onClick={() => settle(true)}
              >
                {state.opts.confirmText ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-muted-foreground">{state.opts.message}</p>
        </Modal>
      )}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDialog(): DialogApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDialog must be used within DialogProvider')
  return c
}
