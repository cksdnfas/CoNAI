import fs from 'fs';

/**
 * 파일 접근 권한 체크 결과
 */
export interface FileAccessResult {
  exists: boolean;
  readable: boolean;
  writable: boolean;
  error?: string;
  errorCode?: string;
}

/**
 * 파일의 존재 여부 및 읽기/쓰기 권한을 체크합니다.
 *
 * @param filePath 체크할 파일 경로
 * @returns 파일 접근 권한 정보
 */
export async function checkFileAccess(filePath: string): Promise<FileAccessResult> {
  try {
    // 파일 존재 여부 체크
    await fs.promises.access(filePath, fs.constants.F_OK);

    // 읽기 권한 체크
    const readable = await fs.promises.access(filePath, fs.constants.R_OK)
      .then(() => true)
      .catch(() => false);

    // 쓰기 권한 체크
    const writable = await fs.promises.access(filePath, fs.constants.W_OK)
      .then(() => true)
      .catch(() => false);

    return {
      exists: true,
      readable,
      writable,
    };
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    return {
      exists: false,
      readable: false,
      writable: false,
      error: (error as Error).message,
      errorCode: errno,
    };
  }
}

/**
 * 디렉토리의 존재 여부 및 읽기/쓰기 권한을 체크합니다.
 *
 * @param dirPath 체크할 디렉토리 경로
 * @returns 디렉토리 접근 권한 정보
 */
export async function checkDirectoryAccess(dirPath: string): Promise<FileAccessResult> {
  const result = await checkFileAccess(dirPath);

  if (result.exists) {
    // 디렉토리인지 확인
    try {
      const stats = await fs.promises.stat(dirPath);
      if (!stats.isDirectory()) {
        return {
          ...result,
          error: 'Path exists but is not a directory',
          errorCode: 'ENOTDIR',
        };
      }
    } catch (error) {
      return {
        ...result,
        error: (error as Error).message,
        errorCode: (error as NodeJS.ErrnoException).code,
      };
    }
  }

  return result;
}

/**
 * 파일을 읽을 수 있는지 체크합니다.
 * 읽을 수 없으면 에러를 throw합니다.
 *
 * @param filePath 체크할 파일 경로
 * @throws 파일이 존재하지 않거나 읽을 수 없는 경우
 */
export async function assertFileReadable(filePath: string): Promise<void> {
  const access = await checkFileAccess(filePath);

  if (!access.exists) {
    const error: NodeJS.ErrnoException = new Error(`File does not exist: ${filePath}`);
    error.code = 'ENOENT';
    throw error;
  }

  if (!access.readable) {
    const error: NodeJS.ErrnoException = new Error(`Permission denied (read): ${filePath}`);
    error.code = 'EACCES';
    throw error;
  }
}

/**
 * 디렉토리에 쓰기가 가능한지 체크합니다.
 * 쓸 수 없으면 에러를 throw합니다.
 *
 * @param dirPath 체크할 디렉토리 경로
 * @throws 디렉토리가 존재하지 않거나 쓸 수 없는 경우
 */
export async function assertDirectoryWritable(dirPath: string): Promise<void> {
  const access = await checkDirectoryAccess(dirPath);

  if (!access.exists) {
    const error: NodeJS.ErrnoException = new Error(`Directory does not exist: ${dirPath}`);
    error.code = 'ENOENT';
    throw error;
  }

  if (!access.writable) {
    const error: NodeJS.ErrnoException = new Error(`Permission denied (write): ${dirPath}`);
    error.code = 'EACCES';
    throw error;
  }
}
