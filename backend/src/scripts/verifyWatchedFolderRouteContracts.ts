import assert from 'node:assert/strict'
import type { Response } from 'express'
import {
  isInvalidWatchedFolderRouteId,
  parseWatchedFolderLimit,
  parseWatchedFolderRouteId,
  sendWatchedFolderBadRequest,
  sendWatchedFolderNotFound,
  WATCHED_FOLDER_ROUTE_MESSAGES,
} from '../routes/watched-folder-route-helpers'

class CapturedResponse {
  statusCode: number | undefined
  payload: unknown

  status(code: number) {
    this.statusCode = code
    return this
  }

  json(payload: unknown) {
    this.payload = payload
    return this
  }
}

function createResponse() {
  return new CapturedResponse() as unknown as Response & CapturedResponse
}

function verifyRouteIdParsing() {
  assert.equal(parseWatchedFolderRouteId('42'), 42)
  assert.equal(parseWatchedFolderRouteId(['42', '99']), 42)
  assert.equal(parseWatchedFolderRouteId('12px'), 12)
  assert.equal(parseWatchedFolderRouteId('0x10'), 16)
  assert.equal(parseWatchedFolderRouteId('0x10', 10), 0)
  assert.equal(isInvalidWatchedFolderRouteId(parseWatchedFolderRouteId('not-a-number')), true)
  assert.equal(isInvalidWatchedFolderRouteId(0), false)
  assert.equal(isInvalidWatchedFolderRouteId(-1), false)
  assert.throws(() => parseWatchedFolderRouteId(undefined), /Route parameter is required/)
}

function verifyScanLogLimitParsing() {
  assert.equal(parseWatchedFolderLimit(undefined, 100), 100)
  assert.equal(parseWatchedFolderLimit('', 100), 100)
  assert.equal(parseWatchedFolderLimit('not-a-number', 100), 100)
  assert.equal(parseWatchedFolderLimit('0', 100), 100)
  assert.equal(parseWatchedFolderLimit('12px', 100), 12)
  assert.equal(parseWatchedFolderLimit(['7', '8'], 100), 7)
  assert.equal(parseWatchedFolderLimit('-1', 100), -1)
}

function verifyBadRequestResponseShape() {
  const res = createResponse()
  const result = sendWatchedFolderBadRequest(res, WATCHED_FOLDER_ROUTE_MESSAGES.invalidFolderId)

  assert.equal(result, res)
  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.payload, {
    success: false,
    error: WATCHED_FOLDER_ROUTE_MESSAGES.invalidFolderId,
  })
}

function verifyNotFoundResponseShape() {
  const res = createResponse()
  const result = sendWatchedFolderNotFound(res)

  assert.equal(result, res)
  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.payload, {
    success: false,
    error: WATCHED_FOLDER_ROUTE_MESSAGES.folderNotFound,
  })
}

function verifySharedMessages() {
  assert.deepEqual(WATCHED_FOLDER_ROUTE_MESSAGES, {
    invalidFolderId: '유효하지 않은 폴더 ID입니다',
    folderNotFound: '폴더를 찾을 수 없습니다',
    defaultUploadFolderCannotDelete: '기본 Upload 폴더는 삭제할 수 없습니다',
  })
}

verifyRouteIdParsing()
verifyScanLogLimitParsing()
verifyBadRequestResponseShape()
verifyNotFoundResponseShape()
verifySharedMessages()

console.log('✅ Watched-folder route contracts verified')
