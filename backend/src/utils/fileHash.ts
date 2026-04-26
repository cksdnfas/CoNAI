import crypto from 'crypto';
import fs from 'fs';
import { promisify } from 'util';

const stat = promisify(fs.stat);

/**
 * MD5 파일 해시 생성
 * 스트리밍 방식으로 대용량 파일 지원
 *
 * @param filePath - 해시를 생성할 파일 경로
 * @returns MD5 해시 (32자 hex 문자열)
 * @throws 파일이 존재하지 않거나 읽기 오류 발생 시
 */
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

