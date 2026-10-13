import { useState } from 'react'
import type { PostListLayout } from '@conai/shared'

const LAYOUT_KEY = 'conai.posts.layout'
const LAYOUTS: readonly PostListLayout[] = ['feed', 'cards', 'sns']

function readLayout(): PostListLayout | null {
  try {
    const stored = window.localStorage.getItem(LAYOUT_KEY)
    return LAYOUTS.includes(stored as PostListLayout) ? stored as PostListLayout : null
  } catch {
    return null
  }
}

/** The viewer's own list layout, remembered per browser; until they pick one, the settings default applies. */
export function usePostsLayout(fallback: PostListLayout) {
  const [chosen, setChosen] = useState<PostListLayout | null>(readLayout)
  const change = (layout: PostListLayout) => {
    setChosen(layout)
    try {
      window.localStorage.setItem(LAYOUT_KEY, layout)
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }
  return [chosen ?? fallback, change] as const
}

const COLLAPSED_KEY = 'conai.posts.collapsedCategories'

function readCollapsed() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(stored) ? stored.filter((id): id is number => Number.isSafeInteger(id)) : [])
  } catch {
    return new Set<number>()
  }
}

/** Parent categories the viewer folded in the sidebar, remembered per browser. */
export function usePostsCollapsedCategories() {
  const [collapsed, setCollapsed] = useState<Set<number>>(readCollapsed)
  const toggle = (id: number) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
    } catch {
      // Storage blocked: the folding lasts for this page only.
    }
  }
  return [collapsed, toggle] as const
}
