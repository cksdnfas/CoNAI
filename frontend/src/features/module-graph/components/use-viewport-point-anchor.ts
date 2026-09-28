import { useMemo } from 'react'

/**
 * Build a zero-size virtual anchor at a viewport point (PopoverAnchor `virtualRef`),
 * so canvas menus open at the pointer without a hand-rolled fixed overlay.
 */
export function useViewportPointAnchor(anchor: { x: number; y: number }) {
  return useMemo(() => ({
    current: {
      getBoundingClientRect: () => DOMRect.fromRect({ x: anchor.x, y: anchor.y, width: 0, height: 0 }),
    },
  }), [anchor.x, anchor.y])
}
