/**
 * 메타데이터 추출 오류 타입
 */
export enum MetadataExtractionErrorType {
  /** 파일 접근 오류 (재시도 가능) */
  FILE_ACCESS_ERROR = 'file_access_error',

  /** 권한 오류 (재시도 가능) */
  PERMISSION_ERROR = 'permission_error',

  /** 파일 손상 (재시도 불필요) */
  CORRUPT_FILE = 'corrupt_file',

  /** 메타데이터 없음 (정상 - 재시도 불필요) */
  NO_METADATA = 'no_metadata',

  /** 파싱 오류 (재시도 불필요) */
  PARSING_ERROR = 'parsing_error',

  /** 알 수 없는 오류 (재시도 가능) */
  UNKNOWN_ERROR = 'unknown_error',
}

/**
 * 메타데이터 추출 오류 클래스
 */
export class MetadataExtractionError extends Error {
  constructor(
    message: string,
    public readonly type: MetadataExtractionErrorType,
    public readonly retryable: boolean,
    public readonly filePath?: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'MetadataExtractionError';

    // Error 스택 트레이스 유지
    if (originalError && originalError.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }

  /**
   * 파일 접근 오류 생성
   */
  static fileAccessError(filePath: string, originalError: Error): MetadataExtractionError {
    return new MetadataExtractionError(
      `Cannot access file: ${filePath}`,
      MetadataExtractionErrorType.FILE_ACCESS_ERROR,
      true,
      filePath,
      originalError
    );
  }

  /**
   * 권한 오류 생성
   */
  static permissionError(filePath: string, originalError: Error): MetadataExtractionError {
    return new MetadataExtractionError(
      `Permission denied: ${filePath}`,
      MetadataExtractionErrorType.PERMISSION_ERROR,
      true,
      filePath,
      originalError
    );
  }

  /**
   * 파일 손상 오류 생성
   */
  static corruptFileError(filePath: string, originalError: Error): MetadataExtractionError {
    return new MetadataExtractionError(
      `File is corrupt or invalid: ${filePath}`,
      MetadataExtractionErrorType.CORRUPT_FILE,
      false,
      filePath,
      originalError
    );
  }

  /**
   * 메타데이터 없음 (정상 상태)
   */
  static noMetadata(filePath: string): MetadataExtractionError {
    return new MetadataExtractionError(
      `No metadata found in file: ${filePath}`,
      MetadataExtractionErrorType.NO_METADATA,
      false,
      filePath
    );
  }

  /**
   * 파싱 오류 생성
   */
  static parsingError(filePath: string, originalError: Error): MetadataExtractionError {
    return new MetadataExtractionError(
      `Failed to parse metadata: ${filePath}`,
      MetadataExtractionErrorType.PARSING_ERROR,
      false,
      filePath,
      originalError
    );
  }

  /**
   * 알 수 없는 오류 생성
   */
  static unknownError(filePath: string, originalError: Error): MetadataExtractionError {
    return new MetadataExtractionError(
      `Unknown error while extracting metadata: ${filePath}`,
      MetadataExtractionErrorType.UNKNOWN_ERROR,
      true,
      filePath,
      originalError
    );
  }

  /**
   * Node.js 에러 코드 기반으로 적절한 오류 생성
   */
  static fromNodeError(filePath: string, error: NodeJS.ErrnoException): MetadataExtractionError {
    const code = error.code;

    switch (code) {
      case 'ENOENT':
        return MetadataExtractionError.fileAccessError(filePath, error);
      case 'EACCES':
      case 'EPERM':
        return MetadataExtractionError.permissionError(filePath, error);
      case 'EISDIR':
      case 'ENOTDIR':
        return MetadataExtractionError.fileAccessError(filePath, error);
      default:
        return MetadataExtractionError.unknownError(filePath, error);
    }
  }
}

/**
 * 백그라운드 처리 오류 클래스
 */
export class BackgroundProcessingError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'BackgroundProcessingError';

    if (originalError && originalError.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }
}
