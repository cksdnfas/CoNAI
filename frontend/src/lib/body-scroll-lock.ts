/**
 * One page-scroll lock shared by every overlay that covers the page (viewer, lightbox, dialogs, sheets, the phone chat).
 * Each overlay used to save and restore body.style.overflow on its own; when they closed out of order (a chat
 * lightbox unmounting under the detail viewer, a dialog outliving the viewer that opened it) the last one put back a
 * stale "hidden" and the page lost its scrollbar for good. Counted instead: the body scrolls again when the last
 * holder lets go.
 */
let holderCount = 0
let overflowBeforeLock = ''

/** Lock the page scroll; call the returned function (once) to let go. */
export function lockBodyScroll() {
  if (holderCount === 0) {
    overflowBeforeLock = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  holderCount += 1

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    holderCount -= 1
    if (holderCount === 0) {
      document.body.style.overflow = overflowBeforeLock
    }
  }
}
