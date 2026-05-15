export function getVisibleUploadResultItems<T>(items: readonly T[], maxVisible: number) {
  const limit = Math.max(0, Math.floor(maxVisible))
  const visible = items.slice(0, limit)
  return {
    visible,
    hiddenCount: Math.max(0, items.length - visible.length),
  }
}

export function getVisibleUploadResultLists<TUploaded, TFailed>(
  result: {
    uploaded: readonly TUploaded[]
    failed: readonly TFailed[]
  },
  maxVisible: number,
) {
  return {
    uploaded: getVisibleUploadResultItems(result.uploaded, maxVisible),
    failed: getVisibleUploadResultItems(result.failed, maxVisible),
  }
}
