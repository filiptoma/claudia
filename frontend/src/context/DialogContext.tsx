import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Modal from '../components/Modal'

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

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null)
  const [value, setValue] = useState('')
  const resolver = useRef<((v: string | null | boolean) => void) | null>(null)

  const settle = useCallback((result: string | null | boolean) => {
    resolver.current?.(result)
    resolver.current = null
    setState(null)
  }, [])

  const prompt = useCallback((o: PromptOpts) => {
    setValue(o.defaultValue ?? '')
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
        <Modal
          title={state.opts.title}
          onClose={() => settle(null)}
          footer={
            <>
              <button className="btn" onClick={() => settle(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => settle(value.trim() || null)}
              >
                {state.opts.confirmText ?? 'OK'}
              </button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              settle(value.trim() || null)
            }}
          >
            {state.opts.label && <label className="field-label">{state.opts.label}</label>}
            <input
              className="text-input"
              autoFocus
              placeholder={state.opts.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </form>
        </Modal>
      )}

      {state?.kind === 'confirm' && (
        <Modal
          title={state.opts.title}
          onClose={() => settle(false)}
          footer={
            <>
              <button className="btn" onClick={() => settle(false)}>
                Cancel
              </button>
              <button
                className={`btn ${state.opts.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => settle(true)}
              >
                {state.opts.confirmText ?? 'Confirm'}
              </button>
            </>
          }
        >
          <p className="confirm-msg">{state.opts.message}</p>
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
