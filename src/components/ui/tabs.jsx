import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '../../lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex h-auto flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-slate-100/80 p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex min-h-9 items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition-colors data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }) {
  return <TabsPrimitive.Content className={cn('mt-6 outline-none', className)} {...props} />
}
