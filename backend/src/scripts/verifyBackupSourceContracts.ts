import assert from 'node:assert/strict'
import {
  getBackupSourceUpdateValidationPlan,
  normalizeOptionalBackupSourceFlag,
} from '../services/backupSourceValueHelpers'

function verifyFlagNormalization() {
  assert.equal(normalizeOptionalBackupSourceFlag(true, false), true)
  assert.equal(normalizeOptionalBackupSourceFlag(1, false), true)
  assert.equal(normalizeOptionalBackupSourceFlag(false, true), false)
  assert.equal(normalizeOptionalBackupSourceFlag(0, true), false)
  assert.equal(normalizeOptionalBackupSourceFlag(undefined, true), true)
  assert.equal(normalizeOptionalBackupSourceFlag(null, false), false)
}

function verifyUpdateValidationPlan() {
  const watcherOnlyUpdate = { watcher_enabled: false }

  assert.deepEqual(getBackupSourceUpdateValidationPlan(watcherOnlyUpdate), {
    validateSourcePath: false,
    ensureTargetDirectory: false,
    checkDuplicateSourcePath: false,
  })

  assert.deepEqual(getBackupSourceUpdateValidationPlan({ source_path: '/source' }), {
    validateSourcePath: true,
    ensureTargetDirectory: false,
    checkDuplicateSourcePath: true,
  })

  assert.deepEqual(getBackupSourceUpdateValidationPlan({ target_folder_name: 'archive' }), {
    validateSourcePath: false,
    ensureTargetDirectory: true,
    checkDuplicateSourcePath: false,
  })

  assert.deepEqual(getBackupSourceUpdateValidationPlan({ source_path: '/source', target_folder_name: 'archive' }), {
    validateSourcePath: true,
    ensureTargetDirectory: true,
    checkDuplicateSourcePath: true,
  })
}

verifyFlagNormalization()
verifyUpdateValidationPlan()

console.log('✅ Backup source contracts verified')
