import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'

import { cn } from '../../lib/utils'

export const Accordion = AccordionPrimitive.Root

export function AccordionItem({ className, ...props }) {
  return <AccordionPrimitive.Item className={cn('rounded-[22px] border border-slate-200 bg-white/80', className)} {...props} />
}

export function AccordionTrigger({ children, className, ...props }) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn('flex flex-1 items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-slate-900 transition-colors hover:text-emerald-700 [&[data-state=open]>svg]:rotate-180', className)}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

export function AccordionContent({ className, ...props }) {
  return (
    <AccordionPrimitive.Content
      className={cn('overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down', className)}
      {...props}
    />
  )
}
