import { createContext, useContext, type ComponentProps } from 'react'
import { IconButton } from '@/components/ui/icon-button'

export type GenerateActionBarVariant = 'inline' | 'sticky'

export const GenerateActionBarVariantContext = createContext<GenerateActionBarVariant>('inline')

/** One secondary icon action sized for the surrounding GenerateActionBar variant. */
export function GenerateActionBarIconButton(props: Omit<ComponentProps<typeof IconButton>, 'size' | 'variant'>) {
  const variant = useContext(GenerateActionBarVariantContext)
  return <IconButton variant="ghost" size={variant === 'sticky' ? 'icon-touch' : 'icon'} {...props} />
}
