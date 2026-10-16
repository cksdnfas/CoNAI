import crypto from 'crypto';
import fs from 'fs';
import { promisify } from 'util';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

const stat = promisify(fs.stat);

/**
 * A file's revision without reading it: any write changes the size, mtime or ctime, a replace changes the inode.
 * Used as the compare-and-swap token for text edits (file store, project workspaces).
 */
export function statRevision(info: fs.BigIntStats): string {
  return crypto.createHash('sha256').update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`).digest('hex');
}

/**
 * MD5 파일 해시 생성
 * 스트리밍 방식으로 대용량 파일 지원
 *
 * @param filePath - 해시를 생성할 파일 경로
 * @returns MD5 해시 (32자 hex 문자열)
 * @throws 파일이 존재하지 않거나 읽기 오류 발생 시
 */
/** Copy a file and return the MD5 of what was copied, reading the source once. */
export async function copyFileWithHash(sourcePath: string, targetPath: string): Promise<string> {
  const hash = crypto.createHash('md5');
  await pipeline(
    fs.createReadStream(sourcePath),
    new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    }),
    fs.createWriteStream(targetPath),
  );
  return hash.digest('hex');
}

/** MD5 of bytes already in memory, in the same form as generateFileHash. */
export function generateBufferHash(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

export async function generateFileHash(filePath: string): Promise<string> {
  try {
    // 파일 존재 확인
    await stat(filePath);

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (error) => {
        reject(new Error(`파일 해시 생성 실패: ${error.message}`));
      });
    });
  } catch (error) {
    const err = error as Error;
    throw new Error(`파일 해시 생성 실패 (${filePath}): ${err.message}`);
  }
}

