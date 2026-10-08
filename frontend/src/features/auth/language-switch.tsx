import { Languages } from 'lucide-react'
import { useI18n, type AppLanguage } from '@/i18n'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'

/** Native names so each option is recognisable whatever language is active. */
const LANGUAGE_NATIVE_NAMES: Record<AppLanguage, string> = {
  ko: '한국어',
  en: 'English',
}

const DEFAULT_OPTION_VALUE = 'default'

const LANGUAGE_OPTIONS: Array<AppLanguage | null> = [null, 'ko', 'en']

/** Label + hover title for one option; `null` follows the server default. */
function useLanguageOptionText() {
  const { t, defaultLanguage } = useI18n()
  return {
    label: (option: AppLanguage | null) => option === null ? t({ ko: '기본', en: 'Default' }) : LANGUAGE_NATIVE_NAMES[option],
    title: (option: AppLanguage | null) => option === null
      ? t({ ko: '서버 기본 언어 따르기 ({language})', en: 'Follow the server default ({language})' }, { language: LANGUAGE_NATIVE_NAMES[defaultLanguage] })
      : LANGUAGE_NATIVE_NAMES[option],
  }
}

/**
 * Per-browser display-language picker. Works for every session (anonymous, guest, admin)
 * because it only writes local storage; `null` follows the server-wide default again.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, languageOverride, setLanguageOverride } = useI18n()
  const optionText = useLanguageOptionText()

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
            <span className="truncate" lang={option ?? undefined} title={optionText.title(option)}>
              {optionText.label(option)}
            </span>
          ),
        }))}
      />
    </div>
  )
}

/** The same picker as one line of text tabs (chosen one underlined), for the account menu. */
export function LanguageTabs({ className }: { className?: string }) {
  const { t, languageOverride, setLanguageOverride } = useI18n()
  const optionText = useLanguageOptionText()

  return (
    <div role="radiogroup" aria-label={t({ ko: '표시 언어', en: 'Display language' })} className={cn('flex items-center gap-4', className)}>
      {LANGUAGE_OPTIONS.map((option) => {
        const isSelected = languageOverride === option
        return (
          <Button
            key={option ?? DEFAULT_OPTION_VALUE}
            type="button"
            variant="ghost"
            size="sm"
            role="radio"
            aria-checked={isSelected}
            lang={option ?? undefined}
            title={optionText.title(option)}
            onClick={() => setLanguageOverride(option)}
            className={cn(
              'h-7 shrink-0 rounded-none border-b-2 px-0.5 font-normal hover:bg-transparent',
              isSelected ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {optionText.label(option)}
          </Button>
        )
      })}
    </div>
  )
}
