import type { ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import { ToggleRow } from '@/components/ui/toggle-row'
import { cn } from '@/lib/utils'

interface SettingsSwitchRowProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

/** An on/off setting: label (and optional hint) on the left, a switch on the right; the whole row toggles it. */
export function SettingsSwitchRow({ checked, onCheckedChange, label, description, disabled = false, className }: SettingsSwitchRowProps) {
  return (
    <ToggleRow className={cn('cursor-pointer justify-between gap-4 has-[:disabled]:cursor-not-allowed', disabled && 'opacity-60', className)}>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </ToggleRow>
  )
}
