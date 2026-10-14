/** A file name's extension in capitals (PDF, ZIP, TXT…), or null. */
export function fileExtension(name: string) {
  return /\.([a-z0-9]{1,6})$/i.exec(name)?.[1].toUpperCase() ?? null
}
