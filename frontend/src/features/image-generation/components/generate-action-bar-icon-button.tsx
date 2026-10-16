import { createContext, useContext, type ComponentProps } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'

export type GenerateActionBarVariant = 'inline' | 'sticky'

export const GenerateActionBarVariantContext = createContext<GenerateActionBarVariant>('inline')

export const STICKY_ICON_SIZE = 'size-11 sm:size-9'

/** One secondary icon action sized for the surrounding GenerateActionBar variant. */
export function GenerateActionBarIconButton({ className, ...props }: Omit<ComponentProps<typeof IconButton>, 'size' | 'variant'>) {
  const variant = useContext(GenerateActionBarVariantContext)
  return (
    <IconButton
      variant="ghost"
      size="icon"
      className={cn(variant === 'sticky' && STICKY_ICON_SIZE, className)}
      {...props}
    />
  )
}
