import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { ImageManagementService } from '../../services/imageManagementService';
import { ImageMetadataEditError, ImageMetadataEditService } from '../../services/imageMetadataEditService';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import { saveMediaBytesToLibrary } from '../../services/libraryMediaIngest';
import { parseLibraryMediaDataUrl } from '../../services/libraryMediaDataUrl';
import { validateUploadedMediaBytes } from '../../routes/images/uploadSecurity';
import { processHashTaggingItem } from '../../services/hashTaggingService';
import { QueryCacheService } from '../../services/QueryCacheService';
import { settingsService } from '../../services/settingsService';
import { McpArtifactService } from '../../services/mcpArtifactService';
import { hideRatingRestrictedText, mediaWithinContextRating, ratingRestrictedHashes } from '../../services/codex-chat/chatContentRating';
import type { ImageMetadataRecord } from '../../types/image';
import type { McpRequestContext } from '../context';
import { errorResult, textResult } from '../toolResults';
import { mcpGroupPathSchema, resolveMcpTargetGroup } from './mcpTargetGroup';

const compositeHashSchema = z.string().trim().regex(/^(?:[a-f0-9]{48}|[a-f0-9]{32})$/, 'Use a library composite hash from search_images or upload_image');
const compositeHashesSchema = z.array(compositeHashSchema).min(1).max(500);
const metadataPatchSchema = z.object({
  prompt: z.string().nullable().optional(),
  negative_prompt: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  steps: z.number().int().positive().nullable().optional(),
  sampler: z.string().nullable().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, 'metadataPatch is required');

function requireVisibleMetadata(compositeHash: string): ImageMetadataRecord {
  const metadata = MediaMetadataModel.findByHash(compositeHash);
  if (!metadata || !MediaPostprocessVisibilityService.isReadyRecord(metadata) || ImageSafetyService.isHidden(metadata.rating_score)) {
    throw new Error(`Image with hash ${compositeHash} not found`);
  }
  return metadata;
}

function imageSummary(context: McpRequestContext, image: ImageMetadataRecord) {
  const summary = {
    composite_hash: image.composite_hash,
    width: image.width,
    height: image.height,
    prompt: image.prompt,
    negative_prompt: image.negative_prompt,
    model_name: image.model_name,
    steps: image.steps,
    sampler: image.sampler,
    rating_score: image.rating_score,
    metadata_updated_date: image.metadata_updated_date,
  };
  return ImageSafetyService.isHidden(image.rating_score) || ratingRestrictedHashes(context, [image.composite_hash]).size
    ? hideRatingRestrictedText(summary, ['prompt', 'negative_prompt', 'model_name', 'sampler'])
    : summary;
}

export function registerImageLibraryTools(server: McpServer, context: McpRequestContext): void {
  server.registerTool(
    'upload_image',
    { description: 'Save media to the library; requires images.upload and images.edit for grouping. Returns hash, status and optional download. If processing, retry get_image_metadata/get_media_download, not upload; temporary not-found is expected. Invalid format: supply a supported image/video data URL.', inputSchema: z.object({
      data_url: z.string().regex(/^data:(?:image|video)\/[a-z0-9.+-]+;base64,[\s\S]+$/i).describe('Base64 image/* or video/* data URL; request security enforces the 50 MiB decoded media limit'),
      name: z.string().trim().min(1).regex(/^[^\\/:*?"<>|\u0000-\u001f\u007f]+$/).optional().describe('Optional filename, normalized by the library filename helper; the extension is chosen from the MIME type'),
      group_id: z.number().int().positive().optional().describe('Existing custom image group ID; omit both group fields to leave the upload ungrouped'),
      group_path: mcpGroupPathSchema,
    }) },
    async ({ data_url, name, group_id, group_path }) => {
      try {
        const media = parseLibraryMediaDataUrl(data_url);
        await validateUploadedMediaBytes(media.bytes, media.mimeType);
        const groupId = resolveMcpTargetGroup(group_id, group_path) ?? null;
        const compositeHash = await saveMediaBytesToLibrary({ ...media, name, groupId });
        const metadata = MediaMetadataModel.findByHash(compositeHash);
        const status = MediaPostprocessVisibilityService.isReadyRecord(metadata) ? 'ready' : 'processing';
        const canDownload = context.baseUrl && metadata && !ImageSafetyService.isHidden(metadata.rating_score)
          && await mediaWithinContextRating(context, compositeHash);
        const download = canDownload
          ? await McpArtifactService.createMediaDescriptor(compositeHash, context.baseUrl!, context.requester).catch(() => null)
          : null;
        return textResult({
          composite_hash: compositeHash,
          group_id: groupId,
          status,
          download,
          ...(status === 'processing' ? {
            next_step: 'Background processing is still running. Retry get_image_metadata and get_media_download shortly; a temporary not found response is not an upload failure. Do not re-upload.',
          } : {}),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_image_metadata',
    { description: 'Update a static library image\'s embedded and stored metadata; returns the saved summary. On revision_conflict (409), reread get_image_metadata and reconcile the patch before retrying.', inputSchema: z.object({
      composite_hash: compositeHashSchema,
      metadataPatch: metadataPatchSchema.describe('Partial metadata patch: null clears a field; omitted fields stay unchanged. Automatic tags use tag_images.'),
    }) },
    async ({ composite_hash, metadataPatch }) => {
      try {
        requireVisibleMetadata(composite_hash);
        const result = await ImageMetadataEditService.saveMetadata(composite_hash, { metadataPatch });
        return textResult(imageSummary(context, result.image));
      } catch (error) {
        if (error instanceof ImageMetadataEditError) {
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({
            status: error.status,
            ...(error.status === 409 ? { code: 'revision_conflict' } : {}),
            error: error.status === 409 ? `${error.message} Re-read get_image_metadata and reconcile your patch before retrying.` : error.message,
          }) }] };
        }
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'tag_images',
    { description: 'Save automatic tags and ratings for library media; returns per-item results/errors. Hidden or model-rating-restricted tags are withheld. Fix reported file/tagger issues, then retry only failed hashes.', inputSchema: z.object({
      composite_hashes: z.array(compositeHashSchema).min(1).max(100).describe('Library image/video hashes; duplicates are processed once'),
    }) },
    async ({ composite_hashes }) => {
      const results = [];
      for (const compositeHash of new Set(composite_hashes)) {
        try {
          requireVisibleMetadata(compositeHash);
          const result = await processHashTaggingItem(compositeHash, '[McpTagImages]');
          if (!result.success) {
            results.push(result);
            continue;
          }
          const metadata = MediaMetadataModel.findByHash(compositeHash)!;
          const restricted = ImageSafetyService.isHidden(metadata.rating_score) || ratingRestrictedHashes(context, [compositeHash]).size > 0;
          results.push(restricted
            ? { composite_hash: compositeHash, success: true, rating_score: metadata.rating_score, rating_restricted: true }
            : { ...result, rating_score: metadata.rating_score });
        } catch (error) {
          results.push({ composite_hash: compositeHash, success: false, error: error instanceof Error ? error.message : 'Failed to tag image' });
        }
      }
      QueryCacheService.invalidateImageCache(undefined, true);
      const successCount = results.filter((result) => result.success).length;
      return textResult({ total: results.length, success_count: successCount, fail_count: results.length - successCount, results });
    },
  );

  server.registerTool(
    'delete_images',
    { description: 'Only on explicit user request, recycle all copies of selected media. Returns counts, errors and recycleBinEntries for restore_deleted_images. If recycle-bin protection is off, enable it in Settings; otherwise inspect errors and retry only failed targets.', inputSchema: z.object({
      composite_hashes: compositeHashesSchema.describe('Library hashes explicitly selected by the user for deletion; duplicates are processed once'),
    }) },
    async ({ composite_hashes }) => {
      try {
        if (!settingsService.loadSettings().general.deleteProtection.enabled) {
          throw new Error('Recycle-bin protection is disabled. Enable it in Settings before using delete_images; this tool does not permanently delete originals.');
        }
        const hashes = [...new Set(composite_hashes)];
        const allowed = [];
        const errors = [];
        for (const hash of hashes) {
          try {
            requireVisibleMetadata(hash);
            allowed.push(hash);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : 'Image not found');
          }
        }
        const result = allowed.length ? await ImageManagementService.deleteImagesBulk(allowed) : {
          message: 'Deleted 0 image(s)', details: { deleted: 0, failed: 0, errors: [] as string[], recycleBinEntries: [] as string[] },
        };
        return textResult({ ...result, details: {
          ...result.details,
          failed: result.details.failed + errors.length,
          errors: [...result.details.errors, ...errors],
        } });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'restore_deleted_images',
    { description: 'Undo user-requested deletion, restoring files and library associations without overwriting newer files. Returns done names and per-entry failures; unrelated recycle entries are refused. Inspect the newer item before retrying conflicts.', inputSchema: z.object({
      names: z.array(z.string().min(1)).min(1).max(1000).describe('Exact delete_images.details.recycleBinEntries identifiers, not hashes or paths; split larger lists into batches'),
    }) },
    async ({ names }) => {
      try {
        return textResult(await ImageManagementService.restoreDeletedImages(names));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
