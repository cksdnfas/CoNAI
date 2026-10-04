import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

type FloatingBottomActionProps = ComponentProps<typeof Button> & {
  containerClassName?: string
  innerClassName?: string
}

export function FloatingBottomAction({ className, containerClassName, innerClassName, ...props }: FloatingBottomActionProps) {
  return (
    // Centred in the page area: a docked chat panel (--chat-dock-width) takes the right edge.
    <div className={cn('pointer-events-none fixed bottom-6 left-0 right-[var(--chat-dock-width,0px)] z-50 flex justify-center px-4', containerClassName)}>
      <div className={cn('flex w-full justify-center', innerClassName)}>
        <Button
          size="sm"
          className={cn('theme-floating-panel pointer-events-auto w-[30vw] min-w-[112px] max-w-[180px] shadow-[0_18px_48px_rgba(0,0,0,0.35)]', className)}
          {...props}
        />
      </div>
    </div>
  )
}
