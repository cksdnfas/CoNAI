import type AdmZip from 'adm-zip'
import { inflateRawSync } from 'zlib'

type ZipEntry = ReturnType<AdmZip['getEntries']>[number]

/** 'file' or 'folder' for a plain entry; null for a symlink, device or other special entry, or an encrypted one. */
export function zipEntryKind(entry: ZipEntry): 'file' | 'folder' | null {
  const type = (entry.attr >>> 16) & 0xf000
  if ((type && type !== 0x8000 && type !== 0x4000) || (entry.header.flags & 1)) return null
  return entry.isDirectory ? 'folder' : 'file'
}

/**
 * An entry's bytes, inflated with a ceiling and checked against the size its header declares, so a crafted
 * header can't make a small archive expand without bound. null when the data doesn't match or the method is unknown.
 */
export function zipEntryBytes(entry: ZipEntry, maxBytes: number): Buffer | null {
  if (entry.header.size > maxBytes) return null
  const compressed = entry.getCompressedData()
  let bytes: Buffer | null = null
  try { bytes = entry.header.method === 0 ? compressed : entry.header.method === 8 ? inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.header.size) }) : null } catch { return null }
  return bytes && bytes.length === entry.header.size ? bytes : null
}
