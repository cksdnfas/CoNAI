import fs from 'fs';
import path from 'path';

/** The write itself must be exclusive: two callers may choose the same name before either one publishes. */
export async function writeToAvailablePath(preferred: string, writeExclusive: (candidate: string) => Promise<void>): Promise<string> {
  const { dir, name, ext } = path.parse(preferred);
  for (let index = 0; ; index++) {
    const candidate = index ? path.join(dir, `${name} (${index})${ext}`) : preferred;
    try {
      await writeExclusive(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export function copyToAvailablePath(source: string, preferred: string) {
  return writeToAvailablePath(preferred, candidate => fs.promises.copyFile(source, candidate, fs.constants.COPYFILE_EXCL));
}
