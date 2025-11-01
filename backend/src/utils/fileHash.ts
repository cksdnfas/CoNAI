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

/**
 * 여러 파일의 해시를 동시에 생성
 *
 * @param filePaths - 해시를 생성할 파일 경로 배열
 * @returns 파일 경로와 해시 매핑 객체
 */
export async function generateMultipleFileHashes(
  filePaths: string[]
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        results[filePath] = await generateFileHash(filePath);
      } catch (error) {
        console.error(`파일 해시 생성 실패: ${filePath}`, error);
        // 에러 발생 시 빈 문자열 저장
        results[filePath] = '';
      }
    })
  );

  return results;
}

/**
 * 파일 해시 검증 (기존 해시와 비교)
 *
 * @param filePath - 검증할 파일 경로
 * @param expectedHash - 예상되는 MD5 해시
 * @returns 해시가 일치하면 true
 */
export async function verifyFileHash(
  filePath: string,
  expectedHash: string
): Promise<boolean> {
  try {
    const actualHash = await generateFileHash(filePath);
    return actualHash === expectedHash;
  } catch (error) {
    console.error(`파일 해시 검증 실패: ${filePath}`, error);
    return false;
  }
}
