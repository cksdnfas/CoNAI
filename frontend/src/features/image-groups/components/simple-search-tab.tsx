import React from 'react'
import {
  Sparkles as AutoAwesomeIcon,
  Ban as BlockIcon,
  CheckCircle as CheckCircleIcon,
  CircleOff as NotIcon,
  Minus as AndIcon,
  Plus as OrIcon,
  Star as RatingIcon,
  X as CloseIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SearchAutoComplete, { type PromptSearchResult } from './search-auto-complete'
import { Button } from '@/components/ui/button'

export interface SearchToken {
  id: string
  type: 'positive' | 'negative' | 'auto' | 'rating'
  label: string
  value: string
  logic: 'OR' | 'AND' | 'NOT'
  count?: number
  minScore?: number
  maxScore?: number | null
  color?: string | null
}

interface SimpleSearchTabProps {
  searchText: string
  onSearchTextChange: (text: string) => void
  onSearch: () => void
  tokens: SearchToken[]
  onAddToken: (tag: PromptSearchResult) => void
  onRemoveToken: (id: string) => void
  onCycleLogic: (id: string) => void
  onUpdateToken: (id: string, updates: Partial<SearchToken>) => void
}

const SimpleSearchTab: React.FC<SimpleSearchTabProps> = ({
  searchText,
  onSearchTextChange,
  onSearch,
  tokens,
  onAddToken,
  onRemoveToken,
  onCycleLogic,
  onUpdateToken,
}) => {
  const { t } = useTranslation(['search'])

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      onSearch()
    }
  }

  return (
    <div className="py-2">
      <SearchAutoComplete
        value={searchText}
        onChange={onSearchTextChange}
        onSelectTag={onAddToken}
        onKeyPress={handleKeyPress}
        placeholder={t('search:simpleSearch.placeholder')}
      />

      <div className="mt-2 flex flex-wrap gap-2">
        {tokens.map((token) => (
          <TokenBadge
            key={token.id}
            token={token}
            onRemove={onRemoveToken}
            onCycleLogic={onCycleLogic}
            onUpdate={onUpdateToken}
          />
        ))}
      </div>
    </div>
  )
}

const TokenBadge: React.FC<{
  token: SearchToken
  onRemove: (id: string) => void
  onCycleLogic: (id: string) => void
  onUpdate: (id: string, updates: Partial<SearchToken>) => void
}> = ({ token, onRemove, onCycleLogic, onUpdate }) => {
  const { t } = useTranslation(['search'])
  const [showScoreEditor, setShowScoreEditor] = React.useState(false)

  const handleClick = () => {
    if (token.type === 'auto') {
      setShowScoreEditor((prev) => !prev)
    }
  }

  const handleCycleType = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (token.type === 'rating') return

    const types: SearchToken['type'][] = ['positive', 'negative', 'auto']
    const currentIndex = types.indexOf(token.type)
    const nextType = types[(currentIndex + 1) % types.length]
    onUpdate(token.id, { type: nextType, count: undefined })
  }

  const getLogicIcon = (logic: 'OR' | 'AND' | 'NOT') => {
    switch (logic) {
      case 'OR':
        return <OrIcon className="h-4 w-4" />
      case 'AND':
        return <AndIcon className="h-4 w-4" />
      case 'NOT':
        return <NotIcon className="h-4 w-4" />
      default:
        return <OrIcon className="h-4 w-4" />
    }
  }

  const getLogicClass = (logic: 'OR' | 'AND' | 'NOT') => {
    switch (logic) {
      case 'OR':
        return 'bg-sky-600 text-white'
      case 'AND':
        return 'bg-emerald-600 text-white'
      case 'NOT':
        return 'bg-rose-600 text-white'
      default:
        return 'bg-sky-600 text-white'
    }
  }

  const getTypeColor = (type: SearchToken['type']) => {
    switch (type) {
      case 'positive':
        return '#16a34a'
      case 'negative':
        return '#dc2626'
      case 'auto':
        return '#ca8a04'
      case 'rating':
        return token.color || '#ca8a04'
      default:
        return '#ca8a04'
    }
  }

  const getSourceIcon = (type: SearchToken['type']) => {
    switch (type) {
      case 'positive':
        return <CheckCircleIcon className="h-4 w-4" />
      case 'negative':
        return <BlockIcon className="h-4 w-4" />
      case 'auto':
        return <AutoAwesomeIcon className="h-4 w-4" />
      case 'rating':
        return <RatingIcon className="h-4 w-4" />
      default:
        return <CheckCircleIcon className="h-4 w-4" />
    }
  }

  const minScore = token.minScore ?? 0
  const maxScore = token.maxScore ?? 1
  const showScore = token.type === 'auto' || token.type === 'rating'

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center overflow-hidden">
        <button
          type="button"
          title={t('search:simpleSearch.tooltips.logic')}
          onClick={(event) => {
            event.stopPropagation()
            onCycleLogic(token.id)
          }}
          className={`p-2 ${getLogicClass(token.logic)}`}
        >
          {getLogicIcon(token.logic)}
        </button>

        <button
          type="button"
          title={token.type === 'rating' ? 'Rating' : t('search:simpleSearch.tooltips.type')}
          onClick={handleCycleType}
          className="p-2 text-white"
          style={{ backgroundColor: getTypeColor(token.type), cursor: token.type === 'rating' ? 'default' : 'pointer' }}
        >
          {getSourceIcon(token.type)}
        </button>

        <button
          type="button"
          onClick={handleClick}
          className="hover:bg-muted/50 flex items-center gap-1 px-2 py-1"
          style={{ cursor: token.type === 'auto' ? 'pointer' : 'default' }}
        >
          <span className="text-sm">{token.label}</span>

          {token.count !== undefined && token.count > 0 && token.type !== 'rating' ? (
            <span className="text-xs text-muted-foreground">({token.count})</span>
          ) : null}

          {showScore ? (
            <span className="text-xs font-bold text-primary">
              ({minScore}~{token.maxScore === null ? '∞' : token.maxScore ?? maxScore})
            </span>
          ) : null}
        </button>

        <Button variant="ghost" size="icon-xs" onClick={() => onRemove(token.id)}>
          <CloseIcon className="h-3.5 w-3.5" />
        </Button>
      </div>

      {showScoreEditor ? (
        <div className="border-t p-2">
          <p className="mb-2 text-xs font-semibold">Confidence Score Range</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-xs text-muted-foreground">
              <p>Min</p>
              <input
                className="border-input mt-1 h-8 w-full rounded border px-2"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={minScore}
                onChange={(event) => onUpdate(token.id, { minScore: Number(event.target.value) })}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              <p>Max</p>
              <input
                className="border-input mt-1 h-8 w-full rounded border px-2"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={typeof maxScore === 'number' ? maxScore : 1}
                onChange={(event) => onUpdate(token.id, { maxScore: Number(event.target.value) })}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default SimpleSearchTab
