import type { ComponentProps } from 'react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'

/** Prompt sidebars keep their compact rows; hierarchy and expansion are shared. */
export function SidebarTree<T>(props: ComponentProps<typeof HierarchyNav<T>>) {
  return <HierarchyNav {...props} variant="sidebar" />
}
