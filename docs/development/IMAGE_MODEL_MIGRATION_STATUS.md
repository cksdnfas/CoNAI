# ImageModel Migration Status

**Date**: 2025-11-06
**Status**: Phase 1 - Deprecated Code Removal

## Critical Finding

The `ImageModel` wrapper (`backend/src/models/Image/index.ts`) contains methods that **intentionally throw errors**:

```typescript
static async findById(id: number): Promise<any | null> {
  throw new Error('ImageModel.findById(id) is deprecated. Use ImageMetadataModel.findByHash(compositeHash)');
}

static async create(imageData: any): Promise<number> {
  throw new Error('ImageModel.create() is deprecated. Use ImageUploadService.saveUploadedImage()');
}
```

This means **any code still calling these methods is currently broken in production**.

## Files with Broken Code

### 1. workflows.ts (2 calls)
**Location**: `backend/src/routes/workflows.ts`

**Broken Call #1 (Line 608)**:
```typescript
if (history.linked_image_id) {
  const image = await ImageModel.findById(history.linked_image_id);
  // This throws error - workflow generation status endpoint is broken
}
```

**Broken Call #2 (Line 940)**:
```typescript
const imageId = await ImageModel.create({
  filename: processed.filename,
  // ... more fields
});
// This throws error - workflow image generation saving is broken
```

**Issue**: The database stores numeric `linked_image_id` but the new system uses `composite_hash` strings.

**Proper Fix Required**:
- Migrate `api_generation_history.linked_image_id` column from INT to TEXT
- Store `composite_hash` instead of numeric ID
- Use `ImageMetadataModel.findByHash()` instead of `findById()`
- Use `ImageUploadService.saveUploadedImage()` instead of `create()`

---

### 2. autoCollectionService.ts (1 call)
**Location**: `backend/src/services/autoCollectionService.ts`

**Broken Call (Line 599)**:
```typescript
const image = await ImageModel.findById(imageId);
// This throws error - auto-collection for new images is broken
```

**Issue**: Method `runAutoCollectionForNewImageById(imageId: number)` expects numeric ID.

**Proper Fix Required**:
- Change method signature to accept `composite_hash: string`
- Use `ImageMetadataModel.findByHash(compositeHash)`
- Update all callers to pass composite_hash instead of numeric ID

---

### 3. imageEditorService.ts (3 calls)
**Location**: `backend/src/services/imageEditorService.ts`

**Broken Call #1 (Line 33)**:
```typescript
const image = await ImageModel.findById(imageId);
// This throws error - image editing is broken
```

**Broken Call #2 (Line 119)**:
```typescript
const originalImage = await ImageModel.findById(imageId);
// This throws error - saving edited images is broken
```

**Broken Call #3 (Line 177)**:
```typescript
const newImageId = await ImageModel.create({...});
// This throws error - saving edited images is broken
```

**Issue**: Service expects numeric IDs but system uses composite_hash.

**Proper Fix Required**:
- Change all method signatures to accept `composite_hash: string`
- Use `ImageMetadataModel.findByHash()`
- Use `ImageUploadService.saveUploadedImage()` for saving
- Update all API endpoints calling this service

---

### 4. uploadService.ts (1 call)
**Location**: `backend/src/services/uploadService.ts`

**Broken Call (Line 94)**:
```typescript
const imageId = await ImageModel.create({...});
// This throws error - external URL downloads are broken
```

**Issue**: This service still uses old create method.

**Proper Fix Required**:
- Replace with `ImageUploadService.saveUploadedImage()`
- Return `composite_hash` instead of numeric ID
- Update callers to use composite_hash

---

### 5. similarity.routes.ts (3 calls)
**Location**: `backend/src/routes/images/similarity.routes.ts`

**All 3 calls (Lines 69, 145, 215)**:
```typescript
image = await ImageModel.findById(imageId);
// These throw errors - similarity search by ID is broken
```

**Issue**: Routes accept both composite_hash and legacy numeric ID.

**Proper Fix Required**:
- Remove legacy numeric ID support
- Only accept composite_hash in API
- Use `ImageMetadataModel.findByHash()` exclusively

---

## Phase 1 Solution: Remove Broken Code

Since these calls already throw errors, we can safely:

1. **Comment out broken code** with clear TODO markers
2. **Remove ImageModel imports**
3. **Add error responses** for endpoints that would fail
4. **Document** what needs proper migration

This unblocks other refactoring work without requiring full database migration.

## Phase 2 Solution: Full Migration (Future Work)

Full fix requires:

1. **Database Migration**:
   - Change `api_generation_history.linked_image_id` to TEXT
   - Update any other numeric ID references

2. **API Changes**:
   - Update all endpoints to use composite_hash
   - Remove legacy numeric ID support
   - Update frontend to use composite_hash

3. **Service Updates**:
   - Refactor all services to use composite_hash
   - Use `ImageUploadService` for all uploads
   - Use `ImageMetadataModel` for all queries

## Recommendation

**For Phase 1 (Current)**: Remove the broken ImageModel wrapper to unblock other refactoring. Document what's broken.

**For Phase 2 (Later)**: Full database and API migration to composite_hash system.

## Impact Assessment

**Current State**: These features are **already broken in production**
- Workflow image generation status
- Auto-collection for new images
- Image editing functionality
- External URL downloads
- Similarity search by legacy ID

**After Phase 1**: Same features broken, but code is cleaner and other refactoring can proceed

**After Phase 2**: All features fixed and working with proper composite_hash system
