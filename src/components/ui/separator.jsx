import * as SeparatorPrimitive from '@radix-ui/react-separator'

import { cn } from '../../lib/utils'

export function Separator({ className, orientation = 'horizontal', ...props }) {
  return (
    <SeparatorPrimitive.Root
      className={cn(
        'shrink-0 bg-slate-200',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      orientation={orientation}
      {...props}
    />
  )
}
