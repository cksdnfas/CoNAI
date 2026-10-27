import { createContext, useContext, useEffect, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

export type GenerateActionBarVariant = 'inline' | 'sticky'

export const GenerateActionBarVariantContext = createContext<GenerateActionBarVariant>('inline')
export const GenerateActionBarMenuContext = createContext<{
  kind: 'menu' | 'plugin'
  reportBusy?: (busy: boolean) => void
} | null>(null)

/** One secondary icon action sized for the surrounding GenerateActionBar variant. */
export function GenerateActionBarIconButton(props: Omit<ComponentProps<typeof IconButton>, 'size' | 'variant'>) {
  const variant = useContext(GenerateActionBarVariantContext)
  const menu = useContext(GenerateActionBarMenuContext)
  const busy = props['aria-busy'] === true || props['aria-busy'] === 'true'
  const reportBusy = menu?.kind === 'plugin' ? menu.reportBusy : undefined
  useEffect(() => {
    reportBusy?.(busy)
  }, [reportBusy, busy])
  if (menu) {
    return (
      <DropdownMenuItem asChild disabled={props.disabled} onSelect={menu.kind === 'plugin' ? (event) => event.preventDefault() : undefined}>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={props.onClick} disabled={props.disabled} aria-busy={props['aria-busy']}>
          {props.children}{props.label}
        </Button>
      </DropdownMenuItem>
    )
  }
  return <IconButton variant="ghost" size={variant === 'sticky' ? 'icon-touch' : 'icon'} {...props} />
}
