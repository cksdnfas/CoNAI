# Generation History Cleanup System

## Overview

Automatic cleanup system for ComfyUI Image Manager generation history records. Removes failed, orphaned, and stale records to prevent database bloat.

## Features

### Automatic Cleanup Rules

1. **Failed Generations** (>24 hours old)
   - Status: `failed`
   - Action: Delete record
   - Reason: Failed generations never created files

2. **Orphaned Records** (missing files)
   - Status: `completed`
   - Has `composite_hash` (proof files were created)
   - Both `original_path` AND `thumbnail_path` files missing from disk
   - Action: Delete record
   - Reason: Image files were manually deleted or moved

3. **No-Hash Records** (>24 hours old)
   - Status: `completed`
   - No `composite_hash` after 24 hours
   - Action: Delete record
   - Reason: Data corruption or incomplete processing

4. **Stale Pending/Processing Records** (>1 hour old)
   - Status: `pending` or `processing`
   - Stuck for more than 1 hour
   - Action: Update status to `failed` with error message
   - Reason: Server crash or network failure during generation

## Usage

### Startup Cleanup (Automatic)

Runs automatically when the server starts:

```bash
npm run dev  # or npm start
```

Console output:
```
🧹 Running generation history startup cleanup...
✅ Startup cleanup: 3 records deleted, 2 records updated
```

### Manual Cleanup (API Endpoint)

#### Preview Mode (Dry Run)

Preview what will be cleaned without making changes:

```bash
curl -X POST "http://localhost:1566/api/generation-history/cleanup?dry_run=true"
```

Response:
```json
{
  "success": true,
  "message": "Cleanup preview completed (no changes made)",
  "dry_run": true,
  "deleted": 5,
  "updated": 2,
  "summary": {
    "failed_deleted": 3,
    "orphaned_deleted": 2,
    "no_hash_deleted": 0,
    "stale_updated": 2
  },
  "details": [
    {
      "id": 123,
      "reason": "failed",
      "service_type": "comfyui",
      "created_at": "2025-11-03T10:00:00.000Z",
      "generation_status": "failed",
      "error_message": "Connection timeout"
    },
    {
      "id": 124,
      "reason": "orphaned",
      "service_type": "novelai",
      "created_at": "2025-11-02T15:30:00.000Z",
      "generation_status": "completed",
      "composite_hash": "abc123...",
      "original_path": "API/images/2025-11-02/novelai_1234567890.png",
      "thumbnail_path": "API/images/2025-11-02/thumb_novelai_1234567890.png"
    }
  ]
}
```

#### Execute Cleanup

Actually delete/update records:

```bash
curl -X POST "http://localhost:1566/api/generation-history/cleanup"
```

Response:
```json
{
  "success": true,
  "message": "Cleanup completed successfully",
  "dry_run": false,
  "deleted": 5,
  "updated": 2,
  "summary": {
    "failed_deleted": 3,
    "orphaned_deleted": 2,
    "no_hash_deleted": 0,
    "stale_updated": 2
  },
  "details": [...]
}
```

## Implementation Details

### Files Modified/Created

1. **`backend/src/services/cleanupService.ts`** (new)
   - Core cleanup logic
   - File existence validation
   - Cleanup reporting

2. **`backend/src/models/GenerationHistory.ts`** (modified)
   - Added `findByStatus()` method
   - Added `findByStatuses()` method
   - Added `deleteMany()` method
   - Added `composite_hash` field to interface

3. **`backend/src/routes/generation-history.routes.ts`** (modified)
   - Added `POST /api/generation-history/cleanup` endpoint

4. **`backend/src/index.ts`** (modified)
   - Added startup cleanup after DB initialization

### Cleanup Logic Flow

```
┌─────────────────────────────────────────┐
│ CleanupService.executeCleanup()         │
└─────────────┬───────────────────────────┘
              │
              ├─→ findFailedRecords(24h)
              │   └─→ Delete records
              │
              ├─→ findOrphanedRecords()
              │   ├─→ Get completed records with hash
              │   ├─→ Check file existence on disk
              │   └─→ Delete if both files missing
              │
              ├─→ findRecordsWithoutHash(24h)
              │   └─→ Delete completed records without hash
              │
              └─→ findStaleRecords(1h)
                  └─→ Update status to 'failed'
```

### Safety Features

- **Dry Run Mode**: Preview changes without modifying data
- **Detailed Reporting**: See exactly what will be cleaned
- **Grace Periods**:
  - Failed records: 24 hours
  - No-hash records: 24 hours
  - Stale records: 1 hour
- **Conservative File Check**: Only delete if BOTH original and thumbnail are missing

## Testing

### Test Cleanup System

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Check for startup cleanup**:
   Look for console output:
   ```
   🧹 Running generation history startup cleanup...
   ✅ Startup cleanup: X records deleted, Y records updated
   ```

3. **Test manual cleanup (preview)**:
   ```bash
   curl -X POST "http://localhost:1566/api/generation-history/cleanup?dry_run=true"
   ```

4. **Test manual cleanup (execute)**:
   ```bash
   curl -X POST "http://localhost:1566/api/generation-history/cleanup"
   ```

### Create Test Data

To test the cleanup system, you can manually create test records:

```sql
-- Insert failed record (will be cleaned after 24h)
INSERT INTO api_generation_history (
  service_type, generation_status, created_at, error_message
) VALUES (
  'comfyui', 'failed', datetime('now', '-25 hours'), 'Test error'
);

-- Insert stale pending record (will be updated to failed after 1h)
INSERT INTO api_generation_history (
  service_type, generation_status, created_at
) VALUES (
  'comfyui', 'pending', datetime('now', '-2 hours')
);

-- Insert orphaned record (will be cleaned if files are missing)
INSERT INTO api_generation_history (
  service_type, generation_status, created_at, composite_hash,
  original_path, thumbnail_path
) VALUES (
  'novelai', 'completed', datetime('now', '-1 day'),
  'abc123def456...',
  'API/images/2025-01-01/test_missing.png',
  'API/images/2025-01-01/thumb_test_missing.png'
);
```

## Monitoring

### Check Cleanup Statistics

Get generation history statistics:

```bash
curl "http://localhost:1566/api/generation-history/statistics"
```

Response:
```json
{
  "success": true,
  "statistics": {
    "total": 150,
    "comfyui": 100,
    "novelai": 50,
    "completed": 140,
    "failed": 8,
    "pending": 2
  }
}
```

### View Cleanup Details

After running cleanup, check the `details` array in the response to see:
- Which records were affected
- Why they were cleaned (reason field)
- When they were created
- Their generation status

## Troubleshooting

### Issue: Cleanup not running on startup

**Symptoms**: No cleanup log messages on server start

**Solution**: Check that the CleanupService import is working:
```bash
# Check for errors in console output
npm run dev 2>&1 | grep -i cleanup
```

### Issue: Files being deleted incorrectly

**Symptoms**: Records with existing files are being marked as orphaned

**Solution**:
1. Verify file paths in database match actual file locations
2. Check file permissions (server must have read access)
3. Ensure `uploads/` directory is correctly configured

### Issue: Too many records being cleaned

**Symptoms**: More records deleted than expected

**Solution**:
1. Use dry-run mode first: `?dry_run=true`
2. Check the `details` array to see what would be deleted
3. Adjust grace periods if needed (modify cleanupService.ts)

## Configuration

### Adjust Grace Periods

Edit `backend/src/services/cleanupService.ts`:

```typescript
// Change failed records retention
const failedRecords = this.findFailedRecords(48); // 48 hours instead of 24

// Change stale records timeout
const staleRecords = this.findStaleRecords(2); // 2 hours instead of 1

// Change no-hash records grace period
const noHashRecords = this.findRecordsWithoutHash(48); // 48 hours instead of 24
```

### Disable Startup Cleanup

Edit `backend/src/index.ts`:

```typescript
// Comment out this section
// // 5-1. Generation History Cleanup (startup)
// console.log('🧹 Running generation history startup cleanup...');
// try {
//   const { CleanupService } = await import('./services/cleanupService');
//   await CleanupService.runStartupCleanup();
// } catch (error) {
//   console.warn('⚠️  Failed to run startup cleanup:', error instanceof Error ? error.message : error);
// }
```

## Best Practices

1. **Regular Monitoring**: Check cleanup statistics weekly
2. **Dry Run First**: Always preview changes before executing
3. **Review Details**: Examine the `details` array to understand what's being cleaned
4. **Backup Before Cleanup**: For production systems, backup database before cleanup
5. **Adjust Grace Periods**: Tune retention periods based on your generation workflow

## Related Documentation

- [Generation History API](../development/api.md#generation-history)
- [Database Schema](../development/architecture.md#database-schema)
- [ComfyUI Integration](../user/features.md#comfyui-generation)
