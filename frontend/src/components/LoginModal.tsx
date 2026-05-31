import { useState } from 'react'
import Modal from './Modal'
import { useAuth } from '../context/AuthContext'

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const { loginEmail, loginOAuth, register } = useAuth()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={tab === 'login' ? 'Sign in' : 'Create account'} onClose={onClose}>
      <div className="oauth-row">
        <button className="btn btn-oauth" disabled={busy} onClick={() => void run(() => loginOAuth('google'))}>
          Continue with Google
        </button>
        <button className="btn btn-oauth" disabled={busy} onClick={() => void run(() => loginOAuth('github'))}>
          Continue with GitHub
        </button>
      </div>

      <div className="divider">
        <span>or</span>
      </div>

      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() =>
            tab === 'login' ? loginEmail(email, password) : register({ email, password, name }),
          )
        }}
      >
        {tab === 'register' && (
          <input
            className="text-input"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          className="text-input"
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="text-input"
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : tab === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <div className="auth-switch">
        {tab === 'login' ? (
          <button className="link-btn" onClick={() => setTab('register')}>
            Need an account? Register
          </button>
        ) : (
          <button className="link-btn" onClick={() => setTab('login')}>
            Have an account? Sign in
          </button>
        )}
      </div>
    </Modal>
  )
}
