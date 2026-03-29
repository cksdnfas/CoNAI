import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

type FloatingBottomActionProps = ComponentProps<typeof Button> & {
  containerClassName?: string
}

export function FloatingBottomAction({ className, containerClassName, ...props }: FloatingBottomActionProps) {
  return (
    <div className={cn('pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4', containerClassName)}>
      <Button
        size="sm"
        className={cn('theme-floating-panel pointer-events-auto w-[30vw] min-w-[112px] max-w-[180px] shadow-[0_18px_48px_rgba(0,0,0,0.35)]', className)}
        {...props}
      />
    </div>
  )
}
