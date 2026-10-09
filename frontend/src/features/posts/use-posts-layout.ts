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
