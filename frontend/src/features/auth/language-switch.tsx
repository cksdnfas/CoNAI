import { Languages } from 'lucide-react'
import { useI18n, type AppLanguage } from '@/i18n'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/components/common/segmented-control'

/** Native names so each option is recognisable whatever language is active. */
const LANGUAGE_NATIVE_NAMES: Record<AppLanguage, string> = {
  ko: '한국어',
  en: 'English',
}

const DEFAULT_OPTION_VALUE = 'default'

const LANGUAGE_OPTIONS: Array<AppLanguage | null> = [null, 'ko', 'en']

/**
 * Per-browser display-language picker. Works for every session (anonymous, guest, admin)
 * because it only writes local storage; `null` follows the server-wide default again.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, defaultLanguage, languageOverride, setLanguageOverride } = useI18n()

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Languages className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <SegmentedControl
        size="xs"
        fullWidth
        className="min-w-0 flex-1"
        ariaLabel={t({ ko: '표시 언어', en: 'Display language' })}
        value={languageOverride ?? DEFAULT_OPTION_VALUE}
        onChange={(value) => setLanguageOverride(value === DEFAULT_OPTION_VALUE ? null : (value as AppLanguage))}
        items={LANGUAGE_OPTIONS.map((option) => ({
          value: option ?? DEFAULT_OPTION_VALUE,
          label: (
            <span
              className="truncate"
              lang={option ?? undefined}
              title={option === null
                ? t({ ko: '서버 기본 언어 따르기 ({language})', en: 'Follow the server default ({language})' }, { language: LANGUAGE_NATIVE_NAMES[defaultLanguage] })
                : LANGUAGE_NATIVE_NAMES[option]}
            >
              {option === null ? t({ ko: '기본', en: 'Default' }) : LANGUAGE_NATIVE_NAMES[option]}
            </span>
          ),
        }))}
      />
    </div>
  )
}
