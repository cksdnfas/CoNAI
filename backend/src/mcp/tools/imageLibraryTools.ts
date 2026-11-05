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
    { description: 'Save a new image or video from a base64 data_url into the library, optionally with a name and either group_id or group_path (missing path groups are created). Uses the same allowed MIME types, signature and decoder validation as HTTP uploads. Requires images.upload, plus images.edit when assigning a group. Returns composite_hash, group_id, status (processing or ready) and a download descriptor when HTTP downloads and viewing are available. While status is processing, get_image_metadata/get_media_download may temporarily report not found: retry those lookups shortly, do not re-upload. On an unsupported or invalid format, send a valid supported image/video data URL.', inputSchema: z.object({
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
    { description: 'Save the same metadataPatch as the image metadata editor: prompt, negative_prompt, model, steps and sampler; null clears a field, omitted fields are unchanged. Only static images support this operation. Rewrites the stored file and database through the library metadata service and returns the saved image summary. On revision_conflict (409), re-read get_image_metadata and reconcile the patch before retrying; never blindly retry a stale save.', inputSchema: z.object({
      composite_hash: compositeHashSchema,
      metadataPatch: metadataPatchSchema.describe('The UI metadata patch object, not a complete metadata record; automatic tags are managed by tag_images'),
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
    { description: 'Run the configured library auto-tagger on 1..100 image/video composite_hashes, processing duplicate hashes once. Persists automatic tags and the calculated rating through the same service as batch-tag in the UI; returns tags/rating per item and individual failures without aborting the batch. Hidden or model-rating-restricted tag text is not returned. For failed items, fix the reported missing file or tagger configuration, then retry only those hashes.', inputSchema: z.object({
      composite_hashes: z.array(compositeHashSchema).min(1).max(100).describe('Up to 100 library hashes, matching the unprocessed tagging route default batch size'),
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
    { description: 'Only on the user’s explicit request, move the selected library images/videos (all physical copies of each hash) to the restorable recycle bin using the UI deletion service. Accepts 1..500 composite_hashes and returns deleted/failed counts, errors and recycleBinEntries. Pass those exact entries as names to restore_deleted_images to undo. Refuses deletion when recycle-bin protection is disabled; enable it in Settings first. Retry only failed targets after inspecting the errors.', inputSchema: z.object({
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
    { description: 'Undo a user-requested library deletion using the exact recycleBinEntries returned by delete_images. Accepts those identifiers as names (1..1000 per call), not hashes or filesystem paths. Uses the same strict library restore service as the UI: restores files and library associations without overwriting newer files; unrelated recycle-bin entries are refused. Returns done names and per-entry failures. On conflicts inspect the newer item before retrying; split larger identifier lists into batches.', inputSchema: z.object({
      names: z.array(z.string().min(1)).min(1).max(1000).describe('Exact recycle-bin entry names from delete_images.details.recycleBinEntries'),
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
