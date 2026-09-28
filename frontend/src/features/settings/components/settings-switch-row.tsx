import { useId, type ReactNode } from 'react'
import { SettingRow } from '@/components/ui/setting-row'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface SettingsSwitchRowProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

/** An on/off setting as a flat hairline row: label on the left, a switch on the right; the label toggles it too. */
export function SettingsSwitchRow({ checked, onCheckedChange, label, description, disabled = false, className }: SettingsSwitchRowProps) {
  const id = useId()

  return (
    <SettingRow
      label={label}
      description={description}
      htmlFor={id}
      className={cn('[&_label]:cursor-pointer', disabled && 'opacity-60 [&_label]:cursor-not-allowed', className)}
    >
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </SettingRow>
  )
}
