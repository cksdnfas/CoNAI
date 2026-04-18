import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NaiControllerSection } from './nai-generation-panel-sections'

export interface NaiSavedImageBrowserSectionProps {
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
  searchPlaceholder = '이름 / 설명 검색',
  emptyMessage,
  isLoading,
  defaultExpanded = false,
  className,
  onSearchChange,
  children,
}: NaiSavedImageBrowserSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <NaiControllerSection
      heading={<span className="text-xs font-medium tracking-[0.08em] text-muted-foreground/90">{title}</span>}
      className={className}
      contentClassName={isExpanded ? 'space-y-0 px-3 py-3' : 'hidden'}
      actions={(
        <>
          <Badge variant="outline">{count}</Badge>
          <div className="w-[9.5rem] sm:w-44 md:w-52">
            <Input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} />
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setIsExpanded((current) => !current)}
            aria-label={isExpanded ? `${title} 접기` : `${title} 펼치기`}
            title={isExpanded ? `${title} 접기` : `${title} 펼치기`}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </>
      )}
    >
      {isExpanded ? (
        isLoading ? (
          <div className="text-sm text-muted-foreground">불러오는 중…</div>
        ) : count > 0 ? (
          children
        ) : (
          <div className="text-sm text-muted-foreground">{emptyMessage}</div>
        )
      ) : null}
    </NaiControllerSection>
  )
}
