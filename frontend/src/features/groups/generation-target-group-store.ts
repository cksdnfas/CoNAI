import { useCallback, useSyncExternalStore } from 'react'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { hasAuthPermission } from '@/features/auth/auth-permissions'

/**
 * 생성 결과를 넣을 "대상 그룹 경로"(예: 프로젝트/이펙트)를 브라우저에 기억한다.
 * 같은 키를 쓰는 컨트롤끼리는 한 페이지 안에서 즉시 동기화된다.
 * 서버가 경로를 해석하고 없는 그룹을 만들기 때문에 id 가 아니라 경로 문자열만 저장한다.
 */

export const IMAGE_GENERATION_TARGET_GROUP_KEY = 'conai:image-generation:target-group-path:v1'

export function buildGraphWorkflowTargetGroupKey(workflowId: number | string) {
  return `conai:module-graph:target-group-path:v1:${workflowId}`
}

const GROUP_PERMISSION_KEY = 'images.edit'
const listeners = new Map<string, Set<() => void>>()
const memoryFallback = new Map<string, string>()

function readValue(key: string) {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return memoryFallback.get(key) ?? ''
  }
}

function writeValue(key: string, value: string) {
  try {
    if (value) {
      window.localStorage.setItem(key, value)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    memoryFallback.set(key, value)
  }
  listeners.get(key)?.forEach((listener) => listener())
}

function subscribe(key: string, listener: () => void) {
  const keyListeners = listeners.get(key) ?? new Set<() => void>()
  keyListeners.add(listener)
  listeners.set(key, keyListeners)

  const handleStorage = (event: StorageEvent) => {
    if (event.key === key) {
      listener()
    }
  }
  window.addEventListener('storage', handleStorage)

  return () => {
    keyListeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}

/** 훅 밖(실행 콜백 등)에서 저장된 경로를 읽는다. 비어 있으면 undefined. */
export function readGenerationTargetGroupPath(storageKey: string) {
  return readValue(storageKey) || undefined
}

/** 경로 입력을 서버와 같은 규칙으로 정리한다(구분자 주변 공백 제거, 빈 조각 제거). */
export function normalizeGroupPathInput(value: string) {
  return value
    .split(/[/\\]/)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter((segment) => segment.length > 0)
    .join('/')
}

/** 그룹 지정 권한이 있을 때만 쓸 수 있는 대상 그룹 경로 상태. */
export function useGenerationTargetGroupPath(storageKey: string) {
  const authStatusQuery = useAuthStatusQuery()
  const canAssignGroup = hasAuthPermission(authStatusQuery.data?.permissionKeys ?? [], GROUP_PERMISSION_KEY) && hasAuthPermission(authStatusQuery.data?.permissionKeys, 'images.edit')

  const storedPath = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(storageKey, listener), [storageKey]),
    () => readValue(storageKey),
    () => '',
  )

  const setPath = useCallback((value: string) => {
    writeValue(storageKey, normalizeGroupPathInput(value))
  }, [storageKey])

  return {
    canAssignGroup,
    /** 저장된 경로(권한이 없으면 빈 문자열) */
    path: canAssignGroup ? storedPath : '',
    setPath,
    /** 요청에 실을 값. 비어 있으면 undefined */
    requestPath: canAssignGroup && storedPath ? storedPath : undefined,
  }
}
