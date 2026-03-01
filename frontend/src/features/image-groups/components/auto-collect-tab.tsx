import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComplexFilter, FilterCondition } from '@comfyui-image-manager/shared'
import SimpleSearchTab, { type SearchToken } from './simple-search-tab'
import type { PromptSearchResult } from './search-auto-complete'
import { Switch } from '@/components/ui/switch'

interface AutoCollectTabProps {
  enabled: boolean
  conditions: ComplexFilter
  onEnabledChange: (enabled: boolean) => void
  onConditionsChange: (conditions: ComplexFilter) => void
}

function conditionsToTokens(conditions: ComplexFilter): SearchToken[] {
  const tokens: SearchToken[] = []

  const processCondition = (condition: FilterCondition, defaultLogic: 'OR' | 'AND' | 'NOT') => {
    let type: SearchToken['type'] = 'positive'

    if (condition.category === 'auto_tag' || condition.type === 'auto_tag_any') {
      type = 'auto'
    } else if (condition.category === 'negative_prompt' || condition.type?.includes('negative')) {
      type = 'negative'
    }

    tokens.push({
      id: `${Date.now()}-${Math.random()}`,
      type,
      label: String(condition.value),
      value: String(condition.value),
      logic: defaultLogic,
      minScore: condition.min_score,
      maxScore: condition.max_score,
    })
  }

  conditions.exclude_group?.forEach((condition) => {
    processCondition(condition, 'NOT')
  })
  conditions.or_group?.forEach((condition) => {
    processCondition(condition, 'OR')
  })
  conditions.and_group?.forEach((condition) => {
    processCondition(condition, 'AND')
  })

  return tokens
}

const AutoCollectTab: React.FC<AutoCollectTabProps> = ({
  enabled,
  conditions,
  onEnabledChange,
  onConditionsChange,
}) => {
  const { t } = useTranslation(['imageGroups'])

  const [searchText, setSearchText] = useState('')
  const [searchTokens, setSearchTokens] = useState<SearchToken[]>(() => conditionsToTokens(conditions))

  useEffect(() => {
    const excludeGroup: FilterCondition[] = []
    const orGroup: FilterCondition[] = []
    const andGroup: FilterCondition[] = []

    const tokensToProcess = [...searchTokens]
    if (searchText.trim()) {
      tokensToProcess.push({
        id: 'temp-text',
        type: 'positive',
        label: searchText.trim(),
        value: searchText.trim(),
        logic: 'OR',
      })
    }

    tokensToProcess.forEach((token) => {
      let category: FilterCondition['category'] = 'positive_prompt'
      let type: FilterCondition['type'] = 'prompt_contains'

      if (token.type === 'auto') {
        category = 'auto_tag'
        type = 'auto_tag_any'
      } else if (token.type === 'negative') {
        category = 'negative_prompt'
        type = 'negative_prompt_contains'
      }

      const condition: FilterCondition = {
        category,
        type,
        value: token.value,
        ...(token.type === 'auto' && {
          min_score: token.minScore ?? 0,
          max_score: token.maxScore ?? 1,
        }),
      }

      if (token.logic === 'OR') {
        orGroup.push(condition)
      } else if (token.logic === 'AND') {
        andGroup.push(condition)
      } else {
        excludeGroup.push(condition)
      }
    })

    onConditionsChange({
      exclude_group: excludeGroup.length > 0 ? excludeGroup : undefined,
      or_group: orGroup.length > 0 ? orGroup : undefined,
      and_group: andGroup.length > 0 ? andGroup : undefined,
    })
  }, [onConditionsChange, searchText, searchTokens])

  const handleAddToken = (tag: PromptSearchResult) => {
    if (searchTokens.some((token) => token.value === tag.prompt && token.type === tag.type)) {
      return
    }

    setSearchTokens((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        type: tag.type,
        label: tag.prompt,
        value: tag.prompt,
        logic: 'AND',
        count: tag.usage_count,
      },
    ])
    setSearchText('')
  }

  const handleRemoveToken = (id: string) => {
    setSearchTokens((prev) => prev.filter((token) => token.id !== id))
  }

  const handleCycleLogic = (id: string) => {
    setSearchTokens((prev) =>
      prev.map((token) => {
        if (token.id !== id) return token
        const logicMap: Record<SearchToken['logic'], SearchToken['logic']> = {
          AND: 'OR',
          OR: 'NOT',
          NOT: 'AND',
        }
        return { ...token, logic: logicMap[token.logic] }
      }),
    )
  }

  const handleUpdateToken = (id: string, updates: Partial<SearchToken>) => {
    setSearchTokens((prev) => prev.map((token) => (token.id === id ? { ...token, ...updates } : token)))
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        <p className="text-base font-medium">{t('imageGroups:modal.autoCollectEnable')}</p>
      </div>

      {enabled ? (
        <div>
          <SimpleSearchTab
            searchText={searchText}
            onSearchTextChange={setSearchText}
            onSearch={() => {}}
            tokens={searchTokens}
            onAddToken={handleAddToken}
            onRemoveToken={handleRemoveToken}
            onCycleLogic={handleCycleLogic}
            onUpdateToken={handleUpdateToken}
          />
        </div>
      ) : (
        <div className="border-border bg-muted/30 rounded-md border p-3 text-center">
          <p className="text-sm text-muted-foreground">{t('imageGroups:modal.autoCollectDisabledHelp')}</p>
        </div>
      )}
    </div>
  )
}

export default AutoCollectTab
