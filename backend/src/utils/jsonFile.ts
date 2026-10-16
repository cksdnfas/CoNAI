import fs from 'fs';
import path from 'path';

/** Write JSON through a temp file and a rename, so a crash mid-write never leaves a half-written file behind. */
export function writeJsonFileAtomic(filePath: string, value: unknown, options: { mode?: number } = {}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stagingPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(stagingPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: options.mode });
    fs.renameSync(stagingPath, filePath);
  } finally {
    fs.rmSync(stagingPath, { force: true });
  }
}

function fileStamp(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

/**
 * A JSON file read through `parse` (which gets `null` for a missing or malformed file) and re-read only when the file
 * changes on disk, so hot request paths stop parsing it every time. Each read returns a fresh copy.
 */
export function createJsonFileReader<T>(filePath: string | (() => string), parse: (raw: unknown) => T) {
  let cachedStamp: string | null | undefined;
  let cachedValue: T;

  return {
    read(): T {
      const file = typeof filePath === 'function' ? filePath() : filePath;
      const stamp = fileStamp(file);
      if (cachedStamp === undefined || stamp !== cachedStamp) {
        let raw: unknown = null;
        if (stamp !== null) {
          try {
            raw = JSON.parse(fs.readFileSync(file, 'utf8'));
          } catch {
            raw = null;
          }
        }
        cachedValue = parse(raw);
        cachedStamp = stamp;
      }
      return structuredClone(cachedValue);
    },
  };
}
