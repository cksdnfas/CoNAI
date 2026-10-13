import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A round avatar that is itself the control (change / open the picture): no Button padding to crop it, only the
 * focus ring. Pass the avatar as children and the action name as `aria-label`.
 */
function AvatarButton({ className, ...props }: Omit<ComponentProps<'button'>, 'type'>) {
  return (
    <button
      data-slot="avatar-button"
      type="button"
      className={cn('shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', className)}
      {...props}
    />
  )
}

export { AvatarButton }
