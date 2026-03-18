import { useEffect, useState } from 'react'

export function LoginPage({ busy, notice, onLogin, onNavigate, publicSignupEnabled }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <AuthLayout title="Log In" description="Access your agency workspace and client delivery surfaces." notice={notice}>
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); onLogin({ email, password }) }}>
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label>
        <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required /></label>
        <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Log in'}</button>
      </form>
      <div className="auth-links">
        <button type="button" className="link-button" onClick={() => onNavigate('/forgot-password')}>Forgot password?</button>
        {publicSignupEnabled ? <button type="button" className="link-button" onClick={() => onNavigate('/signup')}>Create an agency account</button> : null}
      </div>
    </AuthLayout>
  )
}

export function SignupPage({ busy, notice, onNavigate, onSignup }) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')

  return (
    <AuthLayout title="Create Agency Account" description="Bootstrap the first organization, owner account, and client workspace." notice={notice}>
      <form className="auth-form" onSubmit={(event) => {
        event.preventDefault()
        onSignup({ displayName, email, password, organizationName, workspaceName })
      }}>
        <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
        <label>Work email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label>
        <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required /></label>
        <label>Agency name<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></label>
        <label>First client workspace<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required /></label>
        <button type="submit" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
      </form>
      <div className="auth-links">
        <button type="button" className="link-button" onClick={() => onNavigate('/login')}>Already have access?</button>
      </div>
    </AuthLayout>
  )
}

export function AcceptInvitePage({ busy, inviteInfo, notice, onAcceptInvite, onLoadInvite, onNavigate, token }) {
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (token) onLoadInvite(token)
  }, [onLoadInvite, token])

  return (
    <AuthLayout title="Accept Invite" description={inviteInfo ? `Join ${inviteInfo.organizationName} as ${inviteInfo.role}.` : 'Loading invite details...'} notice={notice}>
      {inviteInfo ? (
        <form className="auth-form" onSubmit={(event) => { event.preventDefault(); onAcceptInvite({ token, displayName, password }) }}>
          <label>Invite email<input value={inviteInfo.email} disabled /></label>
          <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
          <label>Create password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required /></label>
          <button type="submit" disabled={busy}>{busy ? 'Joining...' : 'Join organization'}</button>
        </form>
      ) : <p className="muted-copy">Invite preview unavailable.</p>}
      <div className="auth-links">
        <button type="button" className="link-button" onClick={() => onNavigate('/login')}>Back to login</button>
      </div>
    </AuthLayout>
  )
}

export function ForgotPasswordPage({ busy, notice, onNavigate, onRequestReset }) {
  const [email, setEmail] = useState('')

  return (
    <AuthLayout title="Reset Password" description="Request a password reset link for your agency account." notice={notice}>
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); onRequestReset({ email }) }}>
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label>
        <button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
      </form>
      <div className="auth-links">
        <button type="button" className="link-button" onClick={() => onNavigate('/login')}>Back to login</button>
      </div>
    </AuthLayout>
  )
}

export function ResetPasswordPage({ busy, notice, onNavigate, onResetPassword, token }) {
  const [password, setPassword] = useState('')

  return (
    <AuthLayout title="Set New Password" description="Finish the password reset and return to the agency workspace." notice={notice}>
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); onResetPassword({ token, password }) }}>
        <label>New password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required /></label>
        <button type="submit" disabled={busy}>{busy ? 'Resetting...' : 'Reset password'}</button>
      </form>
      <div className="auth-links">
        <button type="button" className="link-button" onClick={() => onNavigate('/login')}>Back to login</button>
      </div>
    </AuthLayout>
  )
}

function AuthLayout({ children, description, notice, title }) {
  return (
    <section className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Agency SaaS Beta</p>
        <h1>{title}</h1>
        <p className="muted-copy">{description}</p>
        {notice ? <div className="notice-bar">{notice}</div> : null}
        {children}
      </div>
    </section>
  )
}
