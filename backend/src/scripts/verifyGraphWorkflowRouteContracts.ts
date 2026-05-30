import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Response } from 'express'
import {
  MAX_BULK_SCHEDULE_ENQUEUE_COUNT,
  parseBoundedScheduleEnqueueCount,
  parseGraphExecutionInputValues,
  parseGraphRouteInteger,
  parseOptionalGraphFolderId,
  parseOptionalTrimmedString,
  parseRequiredGraphRouteId,
  parseScheduleEnqueueCount,
  parseScheduleFailurePolicy,
  parseScheduleInputValues,
  parseScheduleMaxRunCount,
  parseScheduleRunEnqueueCount,
  parseScheduleStatus,
  parseScheduleType,
  sendGraphRouteNotFound,
} from '../routes/graph-workflows/route-helpers'

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

function source(path: string) {
  return readFileSync(`src/${path}`, 'utf8')
}

function createResponse() {
  return new CapturedResponse() as unknown as Response & CapturedResponse
}

function verifyGraphRouteIntegerParsing() {
  assert.equal(parseGraphRouteInteger('42'), 42)
  assert.equal(parseGraphRouteInteger(['42', '99']), 42)
  assert.equal(parseGraphRouteInteger('12px'), 12)
  assert.equal(parseGraphRouteInteger('0x10'), 16)
  assert.equal(Number.isNaN(parseGraphRouteInteger('not-a-number')), true)
  assert.throws(() => parseGraphRouteInteger(undefined), /Route parameter is required/)
  assert.throws(() => parseGraphRouteInteger([]), /Route parameter is required/)
}

function verifyOptionalGraphFolderIdParsing() {
  assert.deepEqual(parseOptionalGraphFolderId(undefined), { ok: true, value: null })
  assert.deepEqual(parseOptionalGraphFolderId(null), { ok: true, value: null })
  assert.deepEqual(parseOptionalGraphFolderId(''), { ok: true, value: null })
  assert.deepEqual(parseOptionalGraphFolderId('7'), { ok: true, value: 7 })
  assert.deepEqual(parseOptionalGraphFolderId(7), { ok: true, value: 7 })
  assert.deepEqual(parseOptionalGraphFolderId('1.5'), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId('0'), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId('-1'), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId('not-a-number'), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId(['7']), { ok: false, value: null })
  assert.deepEqual(parseOptionalGraphFolderId(true), { ok: false, value: null })
}

function verifyRequiredIdBadRequestShape() {
  const res = createResponse()
  const result = parseRequiredGraphRouteId(res, 'not-a-number', 'Invalid folder ID')

  assert.equal(result, null)
  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.payload, {
    success: false,
    error: 'Invalid folder ID',
  })
}

function verifyNotFoundShape() {
  const res = createResponse()
  const result = sendGraphRouteNotFound(res, 'Graph workflow folder not found')

  assert.equal(result, null)
  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.payload, {
    success: false,
    error: 'Graph workflow folder not found',
  })
}

function verifyScheduleEnumParsers() {
  assert.equal(parseScheduleType('once'), 'once')
  assert.equal(parseScheduleType('interval'), 'interval')
  assert.equal(parseScheduleType('daily'), 'daily')
  assert.equal(parseScheduleType('weekly'), null)
  assert.equal(parseScheduleType(undefined), null)

  assert.equal(parseScheduleStatus('active'), 'active')
  assert.equal(parseScheduleStatus('paused'), 'paused')
  assert.equal(parseScheduleStatus('error_stopped'), 'error_stopped')
  assert.equal(parseScheduleStatus('overlap_stopped'), 'overlap_stopped')
  assert.equal(parseScheduleStatus('completed'), 'completed')
  assert.equal(parseScheduleStatus('running'), null)

  assert.equal(parseScheduleFailurePolicy('stop'), 'stop')
  assert.equal(parseScheduleFailurePolicy('continue'), 'continue')
  assert.equal(parseScheduleFailurePolicy('retry'), null)
}

function verifyScheduleValueParsers() {
  assert.equal(parseOptionalTrimmedString('  ready  '), 'ready')
  assert.equal(parseOptionalTrimmedString('   '), null)
  assert.equal(parseOptionalTrimmedString(123), null)

  assert.deepEqual(parseScheduleInputValues({ prompt: 'a' }), { prompt: 'a' })
  assert.equal(parseScheduleInputValues([]), null)
  assert.equal(parseScheduleInputValues(null), null)

  assert.deepEqual(parseGraphExecutionInputValues({ prompt: 'a' }), { prompt: 'a' })
  assert.deepEqual(parseGraphExecutionInputValues(['legacy-array-input']), ['legacy-array-input'])
  assert.equal(parseGraphExecutionInputValues(null), undefined)

  assert.equal(parseScheduleMaxRunCount(undefined), null)
  assert.equal(parseScheduleMaxRunCount(null), null)
  assert.equal(parseScheduleMaxRunCount(''), null)
  assert.equal(parseScheduleMaxRunCount(-1), null)
  assert.equal(parseScheduleMaxRunCount('-1'), null)
  assert.equal(parseScheduleMaxRunCount('5'), 5)
  assert.equal(parseScheduleMaxRunCount(5), 5)
  assert.equal(parseScheduleMaxRunCount(0), null)
  assert.equal(parseScheduleMaxRunCount('-2'), null)
  assert.equal(parseScheduleMaxRunCount('1.5'), null)
}

function verifyScheduleEnqueueCountParsers() {
  assert.equal(MAX_BULK_SCHEDULE_ENQUEUE_COUNT, 100)

  assert.equal(parseBoundedScheduleEnqueueCount(undefined, 7, 1), 7)
  assert.equal(parseBoundedScheduleEnqueueCount(null, 7, 1), 7)
  assert.equal(parseBoundedScheduleEnqueueCount('', 7, 1), 7)
  assert.equal(parseBoundedScheduleEnqueueCount('not-a-number', 7, 1), null)
  assert.equal(parseBoundedScheduleEnqueueCount('1.5', 7, 1), null)
  assert.equal(parseBoundedScheduleEnqueueCount(0, 7, 1), null)
  assert.equal(parseBoundedScheduleEnqueueCount(1, 7, 1), 1)
  assert.equal(parseBoundedScheduleEnqueueCount(MAX_BULK_SCHEDULE_ENQUEUE_COUNT, 7, 1), MAX_BULK_SCHEDULE_ENQUEUE_COUNT)
  assert.equal(parseBoundedScheduleEnqueueCount(MAX_BULK_SCHEDULE_ENQUEUE_COUNT + 1, 7, 1), null)

  assert.equal(parseScheduleEnqueueCount(undefined), 0)
  assert.equal(parseScheduleEnqueueCount(0), 0)
  assert.equal(parseScheduleEnqueueCount(100), 100)
  assert.equal(parseScheduleEnqueueCount(101), null)
  assert.equal(parseScheduleEnqueueCount(-1), null)

  assert.equal(parseScheduleRunEnqueueCount(undefined), 1)
  assert.equal(parseScheduleRunEnqueueCount(1), 1)
  assert.equal(parseScheduleRunEnqueueCount(100), 100)
  assert.equal(parseScheduleRunEnqueueCount(101), null)
  assert.equal(parseScheduleRunEnqueueCount(0), null)
}

function verifyExecutionListNewestTieBreaker() {
  const graphExecutionModelSource = source('models/GraphExecution.ts')

  assert.match(
    graphExecutionModelSource,
    /static findByWorkflow\([\s\S]*ORDER BY created_date DESC, id DESC[\s\S]*LIMIT \?/,
    'workflow execution list must break same-timestamp ties by id so latest-result selection is deterministic',
  )
}

verifyGraphRouteIntegerParsing()
verifyOptionalGraphFolderIdParsing()
verifyRequiredIdBadRequestShape()
verifyNotFoundShape()
verifyScheduleEnumParsers()
verifyScheduleValueParsers()
verifyScheduleEnqueueCountParsers()
verifyExecutionListNewestTieBreaker()

console.log('✅ Graph workflow route contracts verified')
