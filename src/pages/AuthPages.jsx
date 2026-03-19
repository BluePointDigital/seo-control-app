import { useEffect, useState } from 'react'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'

export function LoginPage({ busy, notice, onLogin, onNavigate, publicSignupEnabled }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <AuthLayout
      title="Log in"
      description="Access your agency workspace, client operations, and reporting surfaces from one place."
      notice={notice}
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onLogin({ email, password }) }}>
        <Field label="Email">
          <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </Field>
        <Field label="Password">
          <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in...' : 'Log in'}</Button>
      </form>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('/forgot-password')}>Forgot password?</Button>
        {publicSignupEnabled ? <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('/signup')}>Create an agency account</Button> : null}
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
    <AuthLayout
      title="Create agency account"
      description="Bootstrap the first organization, owner account, and client workspace in one flow."
      notice={notice}
    >
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault()
        onSignup({ displayName, email, password, organizationName, workspaceName })
      }}>
        <Field label="Your name">
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </Field>
        <Field label="Work email">
          <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </Field>
        <Field label="Password">
          <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </Field>
        <Field label="Agency name">
          <Input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required />
        </Field>
        <Field label="First client workspace">
          <Input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</Button>
      </form>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('/login')}>Already have access?</Button>
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
    <AuthLayout
      title="Accept invite"
      description={inviteInfo ? `Join ${inviteInfo.organizationName} as ${inviteInfo.role}.` : 'Loading invite details...'}
      notice={notice}
    >
      {inviteInfo ? (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onAcceptInvite({ token, displayName, password }) }}>
          <Field label="Invite email">
            <Input value={inviteInfo.email} disabled />
          </Field>
          <Field label="Your name">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
          </Field>
          <Field label="Create password">
            <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Joining...' : 'Join organization'}</Button>
        </form>
      ) : (
        <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-5 py-8 text-sm leading-6 text-slate-500">
          Invite preview unavailable.
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('/login')}>Back to login</Button>
      </div>
    </AuthLayout>
  )
}

export function ForgotPasswordPage({ busy, notice, onNavigate, onRequestReset }) {
  const [email, setEmail] = useState('')

  return (
    <AuthLayout
      title="Reset password"
      description="Request a password reset link for your agency account."
      notice={notice}
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onRequestReset({ email }) }}>
        <Field label="Email">
          <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</Button>
      </form>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('/login')}>Back to login</Button>
      </div>
    </AuthLayout>
  )
}

export function ResetPasswordPage({ busy, notice, onNavigate, onResetPassword, token }) {
  const [password, setPassword] = useState('')

  return (
    <AuthLayout
      title="Set new password"
      description="Finish the password reset and head back into the workspace."
      notice={notice}
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onResetPassword({ token, password }) }}>
        <Field label="New password">
          <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Resetting...' : 'Reset password'}</Button>
      </form>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate('/login')}>Back to login</Button>
      </div>
    </AuthLayout>
  )
}

function AuthLayout({ children, description, notice, title }) {
  return (
    <section className="grid min-h-screen place-items-center bg-shell px-4 py-10">
      <Card className="w-full max-w-[1080px] overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1.05fr)_460px]">
          <div className="relative hidden min-h-[720px] overflow-hidden bg-slate-950 px-10 py-12 text-white lg:block">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.35),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_32%)]" />
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div className="space-y-4">
                <Badge variant="accent">Agency SEO Control</Badge>
                <h1 className="max-w-md text-4xl font-semibold tracking-tight">One cleaner workspace for setup, reporting, rankings, and technical review.</h1>
                <p className="max-w-lg text-sm leading-7 text-slate-300">
                  The beta now keeps client operations tighter and more cohesive, with workspace setup separated from org administration.
                </p>
              </div>
              <div className="grid gap-3">
                <Feature text="Compact shell with one reporting window control" />
                <Feature text="Dedicated workspace setup instead of scattered forms" />
                <Feature text="Cleaner reporting, ranking, and audit surfaces" />
              </div>
            </div>
          </div>

          <CardContent className="flex min-h-[720px] items-center justify-center p-6 sm:p-10">
            <div className="w-full max-w-md">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Agency SaaS Beta</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-500">{description}</p>
              {notice ? (
                <div className="mt-6 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                  {notice}
                </div>
              ) : null}
              <div className="mt-8">{children}</div>
            </div>
          </CardContent>
        </div>
      </Card>
    </section>
  )
}

function Field({ children, label }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

function Feature({ text }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
      {text}
    </div>
  )
}
