import assert from 'node:assert/strict';
import { PAGINATION } from '@conai/shared';
import { normalizeGroupImagePositiveInteger } from '../models/GroupImageQueries';
import { parsePositiveIntegerQuery } from '../routes/routeValidation';

const PREVIEW_COUNT_ERROR = 'count must be an integer between 1 and 20';
const PAGE_ERROR = 'page must be a positive integer';
const LIMIT_ERROR = `limit must be an integer between 1 and ${PAGINATION.MAX_LIMIT}`;

function verifyStrictGroupImageQueryParsing() {
  assert.deepEqual(parsePositiveIntegerQuery(undefined, 8, { max: 20, error: PREVIEW_COUNT_ERROR }), { ok: true, value: 8 });
  assert.deepEqual(parsePositiveIntegerQuery('20', 8, { max: 20, error: PREVIEW_COUNT_ERROR }), { ok: true, value: 20 });
  assert.deepEqual(parsePositiveIntegerQuery('21', 8, { max: 20, error: PREVIEW_COUNT_ERROR }), { ok: false, error: PREVIEW_COUNT_ERROR });
  assert.deepEqual(parsePositiveIntegerQuery('1.5', 8, { max: 20, error: PREVIEW_COUNT_ERROR }), { ok: false, error: PREVIEW_COUNT_ERROR });
  assert.deepEqual(parsePositiveIntegerQuery(['8', '9'], 8, { max: 20, error: PREVIEW_COUNT_ERROR }), { ok: false, error: PREVIEW_COUNT_ERROR });
  assert.deepEqual(parsePositiveIntegerQuery('8px', 8, { max: 20, error: PREVIEW_COUNT_ERROR }), { ok: false, error: PREVIEW_COUNT_ERROR });
  assert.deepEqual(parsePositiveIntegerQuery('0', 8, { max: 20, error: PREVIEW_COUNT_ERROR }), { ok: false, error: PREVIEW_COUNT_ERROR });

  assert.deepEqual(parsePositiveIntegerQuery(undefined, PAGINATION.DEFAULT_PAGE, { error: PAGE_ERROR }), { ok: true, value: 1 });
  assert.deepEqual(parsePositiveIntegerQuery('2', PAGINATION.DEFAULT_PAGE, { error: PAGE_ERROR }), { ok: true, value: 2 });
  assert.deepEqual(parsePositiveIntegerQuery('2.5', PAGINATION.DEFAULT_PAGE, { error: PAGE_ERROR }), { ok: false, error: PAGE_ERROR });
  assert.deepEqual(parsePositiveIntegerQuery('-1', PAGINATION.DEFAULT_PAGE, { error: PAGE_ERROR }), { ok: false, error: PAGE_ERROR });

  assert.deepEqual(parsePositiveIntegerQuery(undefined, PAGINATION.GROUP_IMAGES_LIMIT, { max: PAGINATION.MAX_LIMIT, error: LIMIT_ERROR }), { ok: true, value: 20 });
  assert.deepEqual(parsePositiveIntegerQuery(String(PAGINATION.MAX_LIMIT), PAGINATION.GROUP_IMAGES_LIMIT, { max: PAGINATION.MAX_LIMIT, error: LIMIT_ERROR }), { ok: true, value: PAGINATION.MAX_LIMIT });
  assert.deepEqual(parsePositiveIntegerQuery(String(PAGINATION.MAX_LIMIT + 1), PAGINATION.GROUP_IMAGES_LIMIT, { max: PAGINATION.MAX_LIMIT, error: LIMIT_ERROR }), { ok: false, error: LIMIT_ERROR });
  assert.deepEqual(parsePositiveIntegerQuery('20x', PAGINATION.GROUP_IMAGES_LIMIT, { max: PAGINATION.MAX_LIMIT, error: LIMIT_ERROR }), { ok: false, error: LIMIT_ERROR });
}

function verifyDirectModelPaginationNormalization() {
  assert.equal(normalizeGroupImagePositiveInteger(2.9, 1), 2);
  assert.equal(normalizeGroupImagePositiveInteger('3.9', 1), 3);
  assert.equal(normalizeGroupImagePositiveInteger(0, 1), 1);
  assert.equal(normalizeGroupImagePositiveInteger(-10, 1), 1);
  assert.equal(normalizeGroupImagePositiveInteger('bad', 20), 20);
  assert.equal(normalizeGroupImagePositiveInteger(true, 20), 20);
  assert.equal(normalizeGroupImagePositiveInteger(null, 20), 20);
  assert.equal(normalizeGroupImagePositiveInteger('', 20), 20);
  assert.equal(normalizeGroupImagePositiveInteger(250, 20, PAGINATION.MAX_LIMIT), PAGINATION.MAX_LIMIT);
  assert.equal(normalizeGroupImagePositiveInteger(50, 20, PAGINATION.MAX_LIMIT), 50);
}

verifyStrictGroupImageQueryParsing();
verifyDirectModelPaginationNormalization();

console.log('✅ Group image route contracts verified');
