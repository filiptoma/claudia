import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Modal from '../components/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PromptOpts {
  title: string
  label?: string
  defaultValue?: string
  confirmText?: string
  placeholder?: string
}
// An optional segmented choice rendered under the text input (e.g. project type: Markdown | LaTeX).
interface ChoiceConfig {
  choices: { value: string; label: string }[]
  choiceLabel?: string
  choiceDefault?: string
  // Optional heads-up shown under the choice when a given value is selected (keyed by choice value),
  // e.g. a "LaTeX is beta" notice. Kept as plain strings so .ts callers needn't author JSX.
  choiceNotices?: Record<string, string>
}
interface PromptWithChoiceOpts extends PromptOpts, ChoiceConfig {}
interface ConfirmOpts {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}

interface DialogApi {
  prompt: (o: PromptOpts) => Promise<string | null>
  // Like prompt, but also returns the selected choice. Kept separate so prompt's string return type
  // (relied on by the rename/new-folder/new-doc callers) is untouched.
  promptWithChoice: (o: PromptWithChoiceOpts) => Promise<{ value: string; choice: string } | null>
  confirm: (o: ConfirmOpts) => Promise<boolean>
}

const Ctx = createContext<DialogApi | null>(null)

type PromptResult = string | { value: string; choice: string }
type Settle = string | { value: string; choice: string } | null | boolean

type State =
  | { kind: 'prompt'; opts: PromptOpts; choice?: ChoiceConfig }
  | { kind: 'confirm'; opts: ConfirmOpts }
  | null

const PROMPT_FORM_ID = 'claudia-prompt-form'

// Self-contained so each prompt gets a fresh react-hook-form instance (no manual reset needed).
function PromptDialog({
  opts,
  choice,
  onCancel,
  onSubmit,
}: {
  opts: PromptOpts
  choice?: ChoiceConfig
  onCancel: () => void
  onSubmit: (value: string, choice?: string) => void
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
  // The selected choice is local state (the dialog remounts fresh per open, so no reset is needed).
  const [selected, setSelected] = useState(choice?.choiceDefault ?? choice?.choices[0]?.value ?? '')

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
        onSubmit={handleSubmit(({ value }) => onSubmit(value.trim(), choice ? selected : undefined))}
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

        {choice && (
          <div className="mt-2 flex flex-col gap-1.5">
            {choice.choiceLabel && <Label>{choice.choiceLabel}</Label>}
            <div className="flex gap-2" role="radiogroup" aria-label={choice.choiceLabel}>
              {choice.choices.map((c) => {
                const active = selected === c.value
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelected(c.value)}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
            {choice.choiceNotices?.[selected] && (
              <Alert variant="warning" className="mt-1">
                <FlaskConical />
                <AlertDescription>{choice.choiceNotices[selected]}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null)
  const resolver = useRef<((v: Settle) => void) | null>(null)

  const settle = useCallback((result: Settle) => {
    resolver.current?.(result)
    resolver.current = null
    setState(null)
  }, [])

  const prompt = useCallback((o: PromptOpts) => {
    setState({ kind: 'prompt', opts: o })
    return new Promise<string | null>((res) => {
      resolver.current = res as (v: Settle) => void
    })
  }, [])

  const promptWithChoice = useCallback((o: PromptWithChoiceOpts) => {
    const { choices, choiceLabel, choiceDefault, choiceNotices, ...opts } = o
    setState({ kind: 'prompt', opts, choice: { choices, choiceLabel, choiceDefault, choiceNotices } })
    return new Promise<{ value: string; choice: string } | null>((res) => {
      resolver.current = res as (v: Settle) => void
    })
  }, [])

  const confirm = useCallback((o: ConfirmOpts) => {
    setState({ kind: 'confirm', opts: o })
    return new Promise<boolean>((res) => {
      resolver.current = res as (v: Settle) => void
    })
  }, [])

  return (
    <Ctx.Provider value={{ prompt, promptWithChoice, confirm }}>
      {children}

      {state?.kind === 'prompt' && (
        <PromptDialog
          opts={state.opts}
          choice={state.choice}
          onCancel={() => settle(null)}
          onSubmit={(value, choice) =>
            settle(state.choice ? ({ value, choice: choice ?? '' } as PromptResult) : value)
          }
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
