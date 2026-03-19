import { cn } from '../../lib/utils'

export function Card({ className, ...props }) {
  return <div className={cn('rounded-[28px] border border-white/70 bg-white/90 shadow-[0_16px_48px_-24px_rgba(15,23,42,0.35)] backdrop-blur', className)} {...props} />
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-2 p-6 pb-0', className)} {...props} />
}

export function CardTitle({ className, ...props }) {
  return <h2 className={cn('text-xl font-semibold tracking-tight text-slate-950', className)} {...props} />
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm leading-6 text-slate-500', className)} {...props} />
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-6', className)} {...props} />
}

export function CardFooter({ className, ...props }) {
  return <div className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />
}
