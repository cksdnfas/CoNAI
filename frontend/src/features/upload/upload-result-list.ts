export function getVisibleUploadResultItems<T>(items: readonly T[], maxVisible: number) {
  const limit = Math.max(0, Math.floor(maxVisible))
  const visible = items.slice(0, limit)
  return {
    visible,
    hiddenCount: Math.max(0, items.length - visible.length),
  }
}
