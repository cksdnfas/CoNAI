import type { Response } from 'express'
import { errorResponse } from '@conai/shared'
import { parsePagination, parseRouteIntegerParam } from './routeValidation'

export const WATCHED_FOLDER_ROUTE_MESSAGES = {
  invalidFolderId: '유효하지 않은 폴더 ID입니다',
  folderNotFound: '폴더를 찾을 수 없습니다',
  defaultUploadFolderCannotDelete: '기본 Upload 폴더는 삭제할 수 없습니다',
} as const

export function sendWatchedFolderBadRequest(res: Response, message: string) {
  return res.status(400).json(errorResponse(message))
}

export function sendWatchedFolderNotFound(res: Response) {
  return res.status(404).json(errorResponse(WATCHED_FOLDER_ROUTE_MESSAGES.folderNotFound))
}

export function parseWatchedFolderRouteId(value: string | string[] | undefined, radix?: number) {
  return parseRouteIntegerParam(value, radix)
}

/** Scan-log limit: invalid, missing, or non-positive values fall back; never above 500. */
export function parseWatchedFolderLimit(value: unknown, fallback: number) {
  return parsePagination({ limit: value }, { defaultLimit: fallback, maxLimit: 500 }).limit
}

export function isInvalidWatchedFolderRouteId(id: number) {
  return Number.isNaN(id)
}

export function normalizeWatchedFolderWatcherEnabledUpdate(value: unknown) {
  if (value === true || value === 1) {
    return true
  }

  if (value === false || value === 0) {
    return false
  }

  return undefined
}
