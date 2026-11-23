/**
 * Entry names inside one download archive. A taken name gets ` (1)`, ` (2)`… before its extension, compared
 * case-insensitively because archives are unpacked onto case-insensitive disks. With `captions`, each entry also
 * reserves `<stem>.txt`, so two images that differ only by extension never share a caption file.
 */
export function createArchiveEntryNamer(options: { captions?: boolean } = {}) {
  const used = new Set<string>();
  /** Next number to try per base name, so a long run of duplicates stays linear. */
  const next = new Map<string, number>();
  return (stem: string, extension: string): string => {
    const base = stem || 'file';
    const key = `${base}${options.captions ? '.txt' : extension}`.toLowerCase();
    for (let count = next.get(key) ?? 0; ; count += 1) {
      const candidate = count === 0 ? base : `${base} (${count})`;
      const name = `${candidate}${extension}`;
      const caption = `${candidate}.txt`;
      if (used.has(name.toLowerCase()) || (options.captions && used.has(caption.toLowerCase()))) continue;
      used.add(name.toLowerCase());
      if (options.captions) used.add(caption.toLowerCase());
      next.set(key, count + 1);
      return name;
    }
  };
}

/** The caption entry that belongs to an entry named by a captioning namer. */
export function archiveCaptionName(entryName: string): string {
  return entryName.replace(/\.[^.]+$/, '') + '.txt';
}
