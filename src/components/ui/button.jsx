import { forwardRef } from 'react'
import { cva } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-full text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-slate-950 px-4 py-2.5 text-white shadow-sm hover:bg-slate-800',
        secondary: 'border border-slate-200 bg-white px-4 py-2.5 text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50',
        ghost: 'px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        accent: 'bg-emerald-600 px-4 py-2.5 text-white shadow-sm hover:bg-emerald-500',
        danger: 'bg-rose-600 px-4 py-2.5 text-white shadow-sm hover:bg-rose-500',
      },
      size: {
        default: 'h-10',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-11 px-5',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export const Button = forwardRef(function Button({ className, size, variant, ...props }, ref) {
  return <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
})
