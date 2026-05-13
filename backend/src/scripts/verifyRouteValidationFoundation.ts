import assert from 'node:assert/strict'
import type { Response } from 'express'
import {
  parseIntegerWithFallback,
  parseNumberWithFallback,
  parsePositiveInteger,
  parseRouteIntegerParam,
  sendRouteBadRequest,
  validateBooleanIfDefined,
  validateIntegerInRangeIfDefined,
  validateNumberGreaterThanIfDefined,
  validateNumberInRangeIfDefined,
  validateStringEnumIfDefined,
} from '../routes/routeValidation'

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

function expectBadRequest(runValidation: (res: Response) => unknown, expectedError: string) {
  const res = createResponse()
  const result = runValidation(res)

  assert.equal(result, false)
  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.payload, {
    success: false,
    error: expectedError,
  })
}

function verifyBadRequestShape() {
  expectBadRequest((res) => sendRouteBadRequest(res, 'Invalid route input'), 'Invalid route input')
}

function verifyOptionalValidationHelpers() {
  const untouched = createResponse()
  assert.equal(validateBooleanIfDefined(untouched, undefined, 'flag must be boolean'), true)
  assert.equal(untouched.statusCode, undefined)

  expectBadRequest((res) => validateBooleanIfDefined(res, 'yes', 'flag must be boolean'), 'flag must be boolean')
  expectBadRequest((res) => validateIntegerInRangeIfDefined(res, 11, 1, 10, 'count must be 1-10'), 'count must be 1-10')
  expectBadRequest((res) => validateIntegerInRangeIfDefined(res, 1.5, 1, 10, 'count must be 1-10'), 'count must be 1-10')
  expectBadRequest((res) => validateNumberInRangeIfDefined(res, Number.POSITIVE_INFINITY, 0, 1, 'ratio must be finite'), 'ratio must be finite')
  expectBadRequest((res) => validateNumberGreaterThanIfDefined(res, 0, 0, 'value must be positive'), 'value must be positive')
  expectBadRequest((res) => validateStringEnumIfDefined(res, 'other', ['one', 'two'] as const, 'mode is invalid'), 'mode is invalid')

  assert.equal(validateIntegerInRangeIfDefined(createResponse(), '3', 1, 10, 'count must be 1-10'), true)
  assert.equal(validateNumberInRangeIfDefined(createResponse(), '0.5', 0, 1, 'ratio must be 0-1'), true)
  assert.equal(validateNumberGreaterThanIfDefined(createResponse(), '1', 0, 'value must be positive'), true)
  assert.equal(validateStringEnumIfDefined(createResponse(), 'one', ['one', 'two'] as const, 'mode is invalid'), true)
}

function verifyIntegerParsers() {
  assert.equal(parsePositiveInteger(undefined), null)
  assert.equal(parsePositiveInteger(null), null)
  assert.equal(parsePositiveInteger(''), null)
  assert.equal(parsePositiveInteger('7'), 7)
  assert.equal(parsePositiveInteger(7), 7)
  assert.equal(parsePositiveInteger('0'), null)
  assert.equal(parsePositiveInteger('-1'), null)
  assert.equal(parsePositiveInteger('1.5'), null)

  assert.equal(parseIntegerWithFallback('12px', 5), 12)
  assert.equal(parseIntegerWithFallback(undefined, 5), 5)
  assert.equal(parseIntegerWithFallback('not-a-number', 5), 5)
  assert.equal(parseNumberWithFallback('1.25', 5), 1.25)
  assert.equal(parseNumberWithFallback('not-a-number', 5), 5)
}

function verifyRouteIntegerParamParsing() {
  assert.equal(parseRouteIntegerParam('42'), 42)
  assert.equal(parseRouteIntegerParam(['42', '99']), 42)
  assert.equal(parseRouteIntegerParam('12px'), 12)
  assert.equal(parseRouteIntegerParam('0x10'), 16)
  assert.equal(parseRouteIntegerParam('0x10', 10), 0)
  assert.equal(Number.isNaN(parseRouteIntegerParam('not-a-number')), true)
  assert.throws(() => parseRouteIntegerParam(undefined), /Route parameter is required/)
  assert.throws(() => parseRouteIntegerParam([]), /Route parameter is required/)
}

verifyBadRequestShape()
verifyOptionalValidationHelpers()
verifyIntegerParsers()
verifyRouteIntegerParamParsing()

console.log('✅ Route validation foundation contracts verified')
