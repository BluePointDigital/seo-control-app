import { cva } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]',
  {
    variants: {
      variant: {
        default: 'border-slate-200 bg-slate-100 text-slate-600',
        accent: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        warning: 'border-amber-200 bg-amber-50 text-amber-700',
        danger: 'border-rose-200 bg-rose-50 text-rose-700',
        neutral: 'border-white/70 bg-white/80 text-slate-500',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />
}
