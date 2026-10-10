import type { SyntheticEvent } from 'react'

/**
 * React bubbles events out of a body portal along the component tree, not the DOM, so a row or card that hosts a popup
 * also hears every click made inside that popup. Floating surfaces end clicks at their own edge with this.
 */
export function stopAtPortalEdge<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    handler?.(event)
    event.stopPropagation()
  }
}

/** True when the event started inside the handler's own DOM rather than in a portal rendered beneath it. */
export function isFromOwnDom(event: SyntheticEvent) {
  return event.target instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(event.target)
}
