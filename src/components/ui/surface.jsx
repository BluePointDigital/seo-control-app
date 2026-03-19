import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Sparkles } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Badge } from './badge'
import { Button } from './button'

export function PageIntro({ actions = null, badge = null, className, description, title }) {
  return (
    <div className={cn('flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="max-w-3xl space-y-3">
        {badge ? <Badge variant="neutral">{badge}</Badge> : null}
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
          {description ? <p className="max-w-2xl text-sm leading-7 text-slate-500 sm:text-base">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  )
}

export function SectionHeading({ action = null, description, title }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
        {description ? <p className="text-sm leading-6 text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function MetricCard({ className, label, tone = 'default', value }) {
  const toneClassName = {
    default: 'border-slate-200 bg-white',
    accent: 'border-emerald-200 bg-emerald-50/70',
    warning: 'border-amber-200 bg-amber-50/70',
    danger: 'border-rose-200 bg-rose-50/70',
    subtle: 'border-transparent bg-slate-100/80',
  }[tone]

  return (
    <div className={cn('rounded-[24px] border px-4 py-4 shadow-sm', toneClassName, className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  )
}

export function EmptyState({ action, className, copy, title }) {
  return (
    <div className={cn('rounded-[28px] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center', className)}>
      <Sparkles className="mx-auto h-8 w-8 text-emerald-500" />
      <h3 className="mt-4 text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{copy}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function StatusPill({ className, tone = 'default', value }) {
  const toneClassName = {
    default: 'bg-slate-100 text-slate-600',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-rose-100 text-rose-700',
  }[tone]

  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', toneClassName, className)}>{value}</span>
}

export function FormField({ children, className, hint, label }) {
  return (
    <label className={cn('grid gap-2', className)}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-slate-400">{hint}</span> : null}
    </label>
  )
}

export function KeyValueRow({ className, label, value }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 rounded-[20px] border border-slate-200 bg-white px-4 py-3', className)}>
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-right text-sm font-semibold text-slate-900">{value}</span>
    </div>
  )
}

export function StepCard({ done, hint, label }) {
  return (
    <div className={cn('rounded-[24px] border px-4 py-4 shadow-sm', done ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-white')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{label}</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{hint}</p>
        </div>
        {done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Clock3 className="h-5 w-5 text-slate-300" />}
      </div>
    </div>
  )
}

export function FocusCard({ actionLabel, description, onAction, title }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-950 px-6 py-6 text-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.9)]">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-white/10 p-2">
          <AlertCircle className="h-5 w-5 text-emerald-300" />
        </div>
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.14em] text-emerald-200">Next step</p>
          <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
          <p className="text-sm leading-6 text-slate-300">{description}</p>
        </div>
      </div>
      <Button className="mt-6 w-full justify-between bg-white text-slate-950 hover:bg-slate-100" onClick={onAction} type="button">
        <span>{actionLabel}</span>
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
