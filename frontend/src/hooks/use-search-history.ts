import { useCallback, useState } from 'react'
import type { SearchToken } from '@/features/image-groups/components/simple-search-tab'

export interface SearchHistoryItem {
  id: string
  timestamp: number
  text: string
  tokens: SearchToken[]
}

const MAX_HISTORY_ITEMS = 10
const HISTORY_KEY = 'search_history_v1'

export const useSearchHistory = () => {
  const [history, setHistory] = useState<SearchHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY)
      return saved ? (JSON.parse(saved) as SearchHistoryItem[]) : []
    } catch (error) {
      console.error('Failed to load search history', error)
      return []
    }
  })

  const addHistoryItem = useCallback((text: string, tokens: SearchToken[]) => {
    if (!text.trim() && tokens.length === 0) return

    setHistory((previous) => {
      const filtered = previous.filter((item) => {
        const sameText = item.text === text
        const sameTokens = JSON.stringify(item.tokens) === JSON.stringify(tokens)
        return !(sameText && sameTokens)
      })

      const newItem: SearchHistoryItem = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        text,
        tokens,
      }

      const nextHistory = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory))
      } catch (error) {
        console.error('Failed to save search history', error)
      }

      return nextHistory
    })
  }, [])

  const removeHistoryItem = useCallback((id: string) => {
    setHistory((previous) => {
      const nextHistory = previous.filter((item) => item.id !== id)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory))
      return nextHistory
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem(HISTORY_KEY)
  }, [])

  return {
    history,
    addHistoryItem,
    removeHistoryItem,
    clearHistory,
  }
}
