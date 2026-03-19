import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'lucide-react'

import { cn } from '../../lib/utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export function DropdownMenuContent({ className, sideOffset = 12, ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn('z-50 min-w-[220px] rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_20px_56px_-20px_rgba(15,23,42,0.45)]', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({ className, inset, ...props }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn('relative flex cursor-default select-none items-center gap-2 rounded-2xl px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:bg-slate-100 focus:text-slate-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50', inset && 'pl-8', className)}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItem({ className, children, checked, ...props }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn('relative flex cursor-default select-none items-center rounded-2xl py-2.5 pl-8 pr-3 text-sm text-slate-700 outline-none transition-colors focus:bg-slate-100 focus:text-slate-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)}
      {...props}
    >
      <span className="absolute left-3 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

export function DropdownMenuLabel({ className, inset, ...props }) {
  return <DropdownMenuPrimitive.Label className={cn('px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400', inset && 'pl-8', className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-slate-200', className)} {...props} />
}

export function DropdownMenuSubTrigger({ className, inset, children, ...props }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn('flex cursor-default select-none items-center rounded-2xl px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:bg-slate-100 data-[state=open]:bg-slate-100', inset && 'pl-8', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto h-4 w-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

export function DropdownMenuSubContent({ className, ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        className={cn('z-50 min-w-[200px] rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_20px_56px_-20px_rgba(15,23,42,0.45)]', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}
