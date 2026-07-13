import { KeyRound, LogIn, MailCheck, UserPlus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  cognitoEnabled,
  confirmSignUp,
  loadSession,
  signIn,
  signOut,
  signUp,
  type AuthSession,
} from './auth'

type AuthMode = 'signin' | 'signup' | 'confirm'

type AuthGateProps = {
  appName: string
  children: (session: AuthSession, onSignOut: () => void) => ReactNode
}

export function AuthGate({ appName, children }: AuthGateProps) {
  const [session, setSession] = useState<AuthSession | null>(() => loadSession())
  const [mode, setMode] = useState<AuthMode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function handleSignOut() {
    signOut()
    setSession(null)
  }

  if (session) {
    return <>{children(session, handleSignOut)}</>
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unexpected error')
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (mode === 'signin') {
      await run(async () => {
        setSession(await signIn(username, password))
      })
    } else if (mode === 'signup') {
      await run(async () => {
        await signUp(username, password, email)
        setNotice('Check your email for the confirmation code')
        setMode('confirm')
      })
    } else {
      await run(async () => {
        await confirmSignUp(username, code)
        setSession(await signIn(username, password))
      })
    }
  }

  return (
    <main className="app-shell">
      <section className="auth-card">
        <p className="eyebrow">{appName}</p>
        <h1>
          {mode === 'signin' && 'Sign in'}
          {mode === 'signup' && 'Create account'}
          {mode === 'confirm' && 'Confirm email'}
        </h1>

        {!cognitoEnabled && (
          <p className="auth-dev-note">
            Cognito is not configured (<code>VITE_COGNITO_*</code>). Running in dev mode: pick any
            username, no password needed.
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="username"
              autoComplete="username"
              disabled={mode === 'confirm'}
            />
          </label>

          {cognitoEnabled && mode !== 'confirm' && (
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </label>
          )}

          {cognitoEnabled && mode === 'signup' && (
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
          )}

          {mode === 'confirm' && (
            <label>
              <span>Confirmation code</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
          )}

          <button type="submit" disabled={busy || !username.trim()}>
            {mode === 'signin' && <LogIn size={18} aria-hidden="true" />}
            {mode === 'signup' && <UserPlus size={18} aria-hidden="true" />}
            {mode === 'confirm' && <MailCheck size={18} aria-hidden="true" />}
            {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Sign up' : 'Confirm'}
          </button>
        </form>

        {notice && <p className="auth-notice">{notice}</p>}
        {error && (
          <div className="error-banner" role="alert">
            <KeyRound size={18} aria-hidden="true" />
            {error}
          </div>
        )}

        {cognitoEnabled && (
          <div className="auth-switch">
            {mode !== 'signin' && (
              <button type="button" className="link" onClick={() => setMode('signin')}>
                Have an account? Sign in
              </button>
            )}
            {mode === 'signin' && (
              <button type="button" className="link" onClick={() => setMode('signup')}>
                New here? Create an account
              </button>
            )}
            {mode === 'signup' && (
              <button type="button" className="link" onClick={() => setMode('confirm')}>
                Already have a code? Confirm email
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
