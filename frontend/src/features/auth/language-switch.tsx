import { useId } from 'react'
import { Languages } from 'lucide-react'
import { useI18n, type AppLanguage } from '@/i18n'
import { cn } from '@/lib/utils'

/** Native names so each option is recognisable whatever language is active. */
const LANGUAGE_NATIVE_NAMES: Record<AppLanguage, string> = {
  ko: '한국어',
  en: 'English',
}

const LANGUAGE_OPTIONS: Array<AppLanguage | null> = [null, 'ko', 'en']

/**
 * Per-browser display-language picker. Works for every session (anonymous, guest, admin)
 * because it only writes local storage; `null` follows the server-wide default again.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, defaultLanguage, languageOverride, setLanguageOverride } = useI18n()
  const labelId = useId()

  return (
    <div className={cn('space-y-1.5', className)}>
      <div id={labelId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Languages className="h-3.5 w-3.5" />
        {t({ ko: '표시 언어 (이 브라우저)', en: 'Display language (this browser)' })}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-3 gap-1 rounded-sm border border-border bg-surface-low p-0.5">
        {LANGUAGE_OPTIONS.map((option) => {
          const isSelected = languageOverride === option
          const label = option === null ? t({ ko: '기본', en: 'Default' }) : LANGUAGE_NATIVE_NAMES[option]
          const title = option === null
            ? t({ ko: '서버 기본 언어 따르기 ({language})', en: 'Follow the server default ({language})' }, { language: LANGUAGE_NATIVE_NAMES[defaultLanguage] })
            : LANGUAGE_NATIVE_NAMES[option]

          return (
            <button
              key={option ?? 'default'}
              type="button"
              role="radio"
              aria-checked={isSelected}
              title={title}
              onClick={() => setLanguageOverride(option)}
              lang={option ?? undefined}
              className={cn(
                'truncate rounded-sm px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
                isSelected ? 'bg-primary/14 text-primary' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
