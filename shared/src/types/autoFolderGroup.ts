/**
 * 자동 폴더 그룹 타입 정의
 * 파일 시스템 구조를 반영한 읽기 전용 그룹
 */

/**
 * 자동 폴더 그룹 인터페이스
 */
export interface AutoFolderGroup {
  id: number;
  folder_path: string;           // 상대 경로 (예: "API/images/2025-11-01")
  absolute_path: string;          // 절대 경로
  display_name: string;           // 폴더명 (예: "2025-11-01")
  parent_id: number | null;       // 부모 폴더 그룹 ID
  depth: number;                  // 트리 깊이 (루트 = 0)
  has_images: boolean;            // 직접 이미지 포함 여부
  image_count: number;            // 이미지 개수
  color?: string;                 // 그룹 색상 (옵션)
  created_date: string;           // 생성일
  last_updated: string;           // 마지막 업데이트 시간
}

/**
 * 자동 폴더 그룹 생성 데이터
 */
export interface CreateAutoFolderGroupData {
  folder_path: string;
  absolute_path: string;
  display_name: string;
  parent_id?: number | null;
  depth: number;
  has_images?: boolean;
  image_count?: number;
  color?: string;
}

/**
 * 자동 폴더 그룹 통계 포함
 */
export interface AutoFolderGroupWithStats extends AutoFolderGroup {
  child_count?: number;           // 자식 그룹 개수
}

/**
 * 자동 폴더 그룹 계층 구조
 */
export interface AutoFolderGroupHierarchy extends AutoFolderGroup {
  children: AutoFolderGroupHierarchy[];
}

/**
 * 자동 폴더 그룹 이미지 연결
 */
export interface AutoFolderGroupImage {
  id: number;
  group_id: number;
  composite_hash: string;
  added_date: string;
}

/**
 * 자동 폴더 그룹 재구축 결과
 */
export interface AutoFolderGroupRebuildResult {
  success: boolean;
  groups_created: number;
  images_assigned: number;
  duration_ms: number;
  error?: string;
}
