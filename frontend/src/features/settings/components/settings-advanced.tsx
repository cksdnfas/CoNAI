import { useSyncExternalStore } from 'react'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'

const ADVANCED_KEY = 'conai:settings:advanced'
/** The profile editor's own switch before it became the shared one. */
const LEGACY_ADVANCED_KEY = 'conai:chat-profile-editor:advanced'

function readAdvanced() {
  try {
    const value = localStorage.getItem(ADVANCED_KEY) ?? localStorage.getItem(LEGACY_ADVANCED_KEY)
    return value === '1'
  } catch {
    return false
  }
}

let advanced = readAdvanced()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function setAdvanced(next: boolean) {
  advanced = next
  try { localStorage.setItem(ADVANCED_KEY, next ? '1' : '0') } catch { /* Storage can be unavailable. */ }
  for (const listener of listeners) listener()
}

/**
 * One switch for every settings screen and editor: off shows what most setups change, on adds the tuning fields
 * (limits, thresholds, request options). Remembered per browser.
 */
export function useSettingsAdvanced() {
  return useSyncExternalStore(subscribe, () => advanced, () => false)
}

/** The 고급 switch, for the settings toolbar and editor headers. */
export function SettingsAdvancedSwitch() {
  const { t } = useI18n()
  const on = useSettingsAdvanced()
  return (
    <label className="flex h-8 cursor-pointer items-center gap-1.5 px-1.5 text-sm text-muted-foreground">
      {t({ ko: '고급', en: 'Advanced' })}
      <Switch size="sm" checked={on} onCheckedChange={setAdvanced} />
    </label>
  )
}
