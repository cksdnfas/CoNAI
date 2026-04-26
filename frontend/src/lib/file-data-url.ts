/** Read one browser Blob/File object into a data URL string. */
export function readBlobAsDataUrl(blob: Blob, fallbackMessage = 'Failed to read blob as data URL') {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error(fallbackMessage))
    reader.readAsDataURL(blob)
  })
}
