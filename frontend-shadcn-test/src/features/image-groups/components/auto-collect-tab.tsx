import React, { useEffect, useState } from 'react'
import { Box, FormControlLabel, Switch, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { ComplexFilter, FilterCondition } from '@comfyui-image-manager/shared'
import SimpleSearchTab, { type SearchToken } from './simple-search-tab'
import type { PromptSearchResult } from './search-auto-complete'

interface AutoCollectTabProps {
  enabled: boolean
  conditions: ComplexFilter
  onEnabledChange: (enabled: boolean) => void
  onConditionsChange: (conditions: ComplexFilter) => void
}

const AutoCollectTab: React.FC<AutoCollectTabProps> = ({
  enabled,
  conditions,
  onEnabledChange,
  onConditionsChange,
}) => {
  const { t } = useTranslation(['imageGroups'])

  const [searchText, setSearchText] = useState('')
  const [searchTokens, setSearchTokens] = useState<SearchToken[]>([])

  useEffect(() => {
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

    conditions.exclude_group?.forEach((condition) => processCondition(condition, 'NOT'))
    conditions.or_group?.forEach((condition) => processCondition(condition, 'OR'))
    conditions.and_group?.forEach((condition) => processCondition(condition, 'AND'))

    if (tokens.length > 0) {
      setSearchTokens(tokens)
    }
    // initialize once per mount/open cycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    <Box>
      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} color="primary" />}
          label={
            <Typography variant="subtitle1" fontWeight={500}>
              {t('imageGroups:modal.autoCollectEnable')}
            </Typography>
          }
        />
      </Box>

      {enabled ? (
        <Box>
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
        </Box>
      ) : (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            backgroundColor: (theme) => (theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50'),
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('imageGroups:modal.autoCollectDisabledHelp')}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

export default AutoCollectTab
