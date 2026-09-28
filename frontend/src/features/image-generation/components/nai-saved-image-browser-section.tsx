import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { Section } from '@/components/ui/section'

interface NaiSavedImageBrowserSectionProps {
  title?: string
  count: number
  searchValue: string
  searchPlaceholder?: string
  emptyMessage: string
  isLoading: boolean
  defaultExpanded?: boolean
  className?: string
  onSearchChange: (value: string) => void
  children: ReactNode
}

/** Render one collapsible saved-image browser header that keeps count/search visible while collapsed. */
export function NaiSavedImageBrowserSection({
  title = 'Save Image',
  count,
  searchValue,
  searchPlaceholder,
  emptyMessage,
  isLoading,
  defaultExpanded = false,
  className,
  onSearchChange,
  children,
}: NaiSavedImageBrowserSectionProps) {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const effectiveSearchPlaceholder = searchPlaceholder ?? t('image-generation.components.nai.saved.image.browser.section.search.name.description')
  const toggleLabel = isExpanded
    ? t('image-generation.components.nai.saved.image.browser.section.collapse', { title })
    : t('image-generation.components.nai.saved.image.browser.section.expand', { title })

  return (
    <Section
      variant="controller"
      heading={<Text as="span" variant="overline" className="font-semibold">{title}</Text>}
      className={className}
      bodyClassName={isExpanded ? 'space-y-0 px-3 py-3' : 'hidden'}
      actions={(
        <>
          <Badge variant="outline">{count}</Badge>
          <div className="w-[9.5rem] sm:w-44 md:w-52">
            <Input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={effectiveSearchPlaceholder} />
          </div>
          <IconButton
            size="icon-sm"
            variant="ghost"
            onClick={() => setIsExpanded((current) => !current)}
            aria-expanded={isExpanded}
            label={toggleLabel}
          >
            <ChevronDown className={cn('transition-transform', !isExpanded && '-rotate-90')} />
          </IconButton>
        </>
      )}
    >
      {isExpanded ? (
        isLoading ? (
          <Text variant="muted">{t('image-generation.components.nai.saved.image.browser.section.loading')}</Text>
        ) : count > 0 ? (
          children
        ) : (
          <Text variant="muted">{emptyMessage}</Text>
        )
      ) : null}
    </Section>
  )
}
