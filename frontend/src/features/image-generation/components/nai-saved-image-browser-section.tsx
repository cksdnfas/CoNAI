import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { NaiControllerSection } from './nai-generation-panel-sections'

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
    <NaiControllerSection
      heading={<span className="text-xs font-medium tracking-[0.08em] text-muted-foreground/90">{title}</span>}
      className={className}
      contentClassName={isExpanded ? 'space-y-0 px-3 py-3' : 'hidden'}
      actions={(
        <>
          <Badge variant="outline">{count}</Badge>
          <div className="w-[9.5rem] sm:w-44 md:w-52">
            <Input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={effectiveSearchPlaceholder} />
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setIsExpanded((current) => !current)}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </>
      )}
    >
      {isExpanded ? (
        isLoading ? (
          <div className="text-sm text-muted-foreground">{t('image-generation.components.nai.saved.image.browser.section.loading')}</div>
        ) : count > 0 ? (
          children
        ) : (
          <div className="text-sm text-muted-foreground">{emptyMessage}</div>
        )
      ) : null}
    </NaiControllerSection>
  )
}
