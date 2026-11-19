/**
 * Swap the drag ghost for a small count badge ("3 images") for a drag that carries several items. The browser
 * snapshots the element synchronously, so it is removed on the next frame.
 */
export function setDragCountBadge(dataTransfer: DataTransfer, label: string) {
  const badge = document.createElement('div')
  badge.textContent = label
  badge.className = 'fixed -left-[999px] top-0 rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-elevation-2'
  document.body.appendChild(badge)
  dataTransfer.setDragImage(badge, 12, 12)
  window.requestAnimationFrame(() => badge.remove())
}
