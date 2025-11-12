import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import { normalizePath } from './pathResolver';

/**
 * 폴더 경로 파싱 유틸리티
 * 자동 폴더 그룹 생성을 위한 경로 분석 및 정규화
 */

/**
 * 절대 경로를 uploads 디렉토리 기준 상대 경로로 변환
 * @param absolutePath 절대 파일 경로
 * @returns uploads 기준 상대 경로 (예: "API/images/2025-11-01")
 */
export function extractRelativePathFromUploads(absolutePath: string): string {
  const uploadsDir = normalizePath(runtimePaths.uploadsDir);
  const normalizedPath = normalizePath(absolutePath);

  // uploads 디렉토리 하위가 아니면 전체 경로 반환
  if (!normalizedPath.startsWith(uploadsDir)) {
    return normalizedPath;
  }

  // uploads 기준 상대 경로 추출
  const relativePath = path.relative(uploadsDir, normalizedPath);

  // Windows 경로 구분자를 Unix 스타일로 변환 (일관성)
  return relativePath.split(path.sep).join('/');
}

/**
 * 파일 경로에서 폴더 경로 추출
 * @param filePath 파일 경로 (절대 또는 상대)
 * @returns 폴더 경로 (파일명 제외)
 */
export function extractFolderPath(filePath: string): string {
  return path.dirname(filePath);
}

/**
 * 폴더 경로를 세그먼트로 분리
 * @param folderPath 폴더 경로
 * @returns 폴더 세그먼트 배열 (예: ["API", "images", "2025-11-01"])
 */
export function parseFolderSegments(folderPath: string): string[] {
  if (!folderPath || folderPath === '.' || folderPath === '/') {
    return [];
  }

  // Unix 스타일 경로로 정규화
  const normalized = folderPath.split(path.sep).join('/');

  // 빈 세그먼트 제거 (///)
  return normalized.split('/').filter(segment => segment.length > 0);
}

/**
 * 세그먼트에서 표시 이름 추출 (마지막 세그먼트)
 * @param segments 폴더 세그먼트 배열
 * @returns 표시 이름
 */
export function getDisplayNameFromSegments(segments: string[]): string {
  if (segments.length === 0) {
    return 'Root';
  }
  return segments[segments.length - 1];
}

/**
 * 부모 폴더 경로 계산
 * @param folderPath 현재 폴더 경로
 * @returns 부모 폴더 경로 (없으면 null)
 */
export function getParentFolderPath(folderPath: string): string | null {
  const segments = parseFolderSegments(folderPath);
  if (segments.length <= 1) {
    return null;
  }
  return segments.slice(0, -1).join('/');
}

/**
 * 폴더 경로 깊이 계산
 * @param folderPath 폴더 경로
 * @returns 깊이 (루트 = 0)
 */
export function calculateFolderDepth(folderPath: string): number {
  const segments = parseFolderSegments(folderPath);
  return segments.length;
}

/**
 * 여러 경로의 공통 베이스 경로 찾기
 * @param paths 경로 배열
 * @returns 공통 베이스 경로
 */
export function findCommonBasePath(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) return extractFolderPath(paths[0]);

  // 모든 경로를 세그먼트로 분리
  const allSegments = paths.map(p => parseFolderSegments(extractFolderPath(p)));

  // 최소 길이 찾기
  const minLength = Math.min(...allSegments.map(s => s.length));

  // 공통 세그먼트 찾기
  const commonSegments: string[] = [];
  for (let i = 0; i < minLength; i++) {
    const segment = allSegments[0][i];
    const allMatch = allSegments.every(segments => segments[i] === segment);

    if (allMatch) {
      commonSegments.push(segment);
    } else {
      break;
    }
  }

  return commonSegments.join('/');
}

/**
 * 폴더 경로 정규화 (일관된 형식으로 변환)
 * @param folderPath 폴더 경로
 * @returns 정규화된 경로 (Unix 스타일, 앞뒤 슬래시 제거)
 */
export function normalizeFolderPath(folderPath: string): string {
  const segments = parseFolderSegments(folderPath);
  return segments.join('/');
}

/**
 * 경로가 다른 경로의 하위인지 확인
 * @param childPath 자식 경로
 * @param parentPath 부모 경로
 * @returns 하위 경로 여부
 */
export function isSubPath(childPath: string, parentPath: string): boolean {
  const childSegments = parseFolderSegments(childPath);
  const parentSegments = parseFolderSegments(parentPath);

  if (childSegments.length <= parentSegments.length) {
    return false;
  }

  // 부모 세그먼트가 모두 일치하는지 확인
  return parentSegments.every((segment, index) => childSegments[index] === segment);
}

/**
 * 폴더 경로 트리 구조 데이터
 */
export interface FolderPathNode {
  folderPath: string;          // 전체 상대 경로
  segments: string[];           // 세그먼트 배열
  depth: number;                // 깊이
  displayName: string;          // 표시 이름
  parentPath: string | null;    // 부모 경로
  compositeHashes: Set<string>; // 이미지 해시 집합
}

/**
 * 파일 경로들로부터 폴더 트리 구조 생성
 * @param filePaths 파일 경로와 해시 매핑
 * @returns 폴더 경로 노드 맵
 */
export function buildFolderPathTree(
  filePaths: Array<{ path: string; hash: string }>
): Map<string, FolderPathNode> {
  const folderMap = new Map<string, FolderPathNode>();

  // 1. 이미지가 직접 포함된 폴더 수집
  for (const { path: filePath, hash } of filePaths) {
    const relativePath = extractRelativePathFromUploads(filePath);
    const folderPath = extractFolderPath(relativePath);

    if (!folderMap.has(folderPath)) {
      const segments = parseFolderSegments(folderPath);
      folderMap.set(folderPath, {
        folderPath,
        segments,
        depth: segments.length,
        displayName: getDisplayNameFromSegments(segments),
        parentPath: getParentFolderPath(folderPath),
        compositeHashes: new Set()
      });
    }

    folderMap.get(folderPath)!.compositeHashes.add(hash);
  }

  // 2. 중간 부모 폴더 추가 (이미지 없는 폴더)
  const allFolderPaths = Array.from(folderMap.keys());
  for (const folderPath of allFolderPaths) {
    const segments = parseFolderSegments(folderPath);

    // 각 단계의 부모 폴더 추가
    for (let i = 1; i < segments.length; i++) {
      const parentPath = segments.slice(0, i).join('/');

      if (!folderMap.has(parentPath)) {
        const parentSegments = segments.slice(0, i);
        folderMap.set(parentPath, {
          folderPath: parentPath,
          segments: parentSegments,
          depth: parentSegments.length,
          displayName: getDisplayNameFromSegments(parentSegments),
          parentPath: getParentFolderPath(parentPath),
          compositeHashes: new Set() // 이미지 없음
        });
      }
    }
  }

  return folderMap;
}
