import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Asterisk, Bookmark } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { SegmentedControl } from '@/components/common/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { PromptTypeFilter } from '@/types/prompt'
import type { PromptPageView } from '../prompt-page-view'

export interface PromptPageToolbarProps {
  view: PromptPageView
  /** Prompt type to go back to when the preset toggle is switched off. */
  promptType: PromptTypeFilter
  canViewWildcards: boolean
  onChangeView: (view: PromptPageView) => void
  /** Flexible middle (search). */
  children?: ReactNode
  /** View-specific icon actions placed before the wildcard / preset keys (sort, options…). */
  actions?: ReactNode
}

/** The shared part of the toolbar that each /prompts view extends with its own search and actions. */
export type PromptPageToolbarBaseProps = Omit<PromptPageToolbarProps, 'children' | 'actions'>

/** The one toolbar row of /prompts: type switch · search · view actions · wildcard and preset keys. */
export function PromptPageToolbar({ view, promptType, canViewWildcards, onChangeView, children, actions }: PromptPageToolbarProps) {
  const { t } = useI18n()
  const items = [
    { value: 'positive', label: t({ ko: '긍정', en: 'Positive' }) },
    { value: 'negative', label: t({ ko: '부정', en: 'Negative' }) },
    { value: 'auto', label: t({ ko: '자동', en: 'Auto' }) },
    { value: 'danbooru', label: t({ ko: '단부루', en: 'Danbooru' }) },
  ]
  const isPresetView = view === 'presets'

  return (
    <PageToolbar
      start={(
        <SegmentedControl
          value={view}
          items={items}
          onChange={(next) => onChangeView(next as PromptPageView)}
          size="sm"
          semantics="tabs"
          ariaLabel={t({ ko: '프롬프트 종류', en: 'Prompt type' })}
        />
      )}
      actions={(
        <>
          {actions}
          {canViewWildcards ? (
            <IconButton asChild variant="ghost" size="icon-sm" label={t({ ko: '와일드카드', en: 'Wildcards' })}>
              <Link to="/wildcards">
                <Asterisk />
              </Link>
            </IconButton>
          ) : null}
          <IconButton
            variant="ghost"
            size="icon-sm"
            active={isPresetView}
            onClick={() => onChangeView(isPresetView ? promptType : 'presets')}
            label={t({ ko: '프리셋', en: 'Presets' })}
          >
            <Bookmark />
          </IconButton>
        </>
      )}
    >
      {children}
    </PageToolbar>
  )
}
