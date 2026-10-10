import fs from 'fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { previewImage } from '../../services/imagePreview';
import { requireRequesterPermission } from '../../middleware/featureAccess';
import { z } from 'zod';
import { db } from '../../database/init';
import { GroupModel } from '../../models/Group';
import { MediaMetadataModel } from '../../models/Image/MediaMetadataModel';
import { MEDIA_ROW_ID_COLUMN } from '../../services/autoTagIndexService';
import { EMOTICON_PROMPT_BUDGET, EmoticonService } from '../../services/emoticonService';
import { requireFileStoreOwner } from '../../services/fileStoreAccess';
import { FileStoreService } from '../../services/fileStoreService';
import { GroupPathService } from '../../services/groupPathService';
import { FRAMES_PER_SHEET_DEFAULT, FRAMES_PER_SHEET_MAX, MEDIA_FRAMES_DEFAULT, MEDIA_FRAMES_MAX, extractMediaFrames, frameSheets } from '../../services/mediaFrames';
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService';
import { ImageSafetyService } from '../../services/imageSafetyService';
import { CONTENT_RATING_BLOCKED, libraryMediaAllowed, storedFileAllowed } from '../../services/contentRating';
import { contextContentLimit } from '../../services/codex-chat/chatContentRating';
import type { McpRequestContext } from '../context';

const VIEW_MAX_IMAGES = 6;

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

const groupIdSchema = z.number().int().positive().optional().describe('Custom image group ID');
const groupPathSchema = z.string().trim().min(1).max(1024).optional().describe("Existing custom group path, e.g. 'Emoticons/Kona'. Use instead of group_id.");

function resolveGroup(groupId?: number, groupPath?: string) {
  if ((groupId !== undefined) === (groupPath !== undefined)) throw new Error('Specify exactly one of group_id or group_path');
  const id = groupPath !== undefined ? GroupPathService.resolve(groupPath, { create: false })?.groupId : groupId;
  if (id === undefined || !GroupModel.findById(id)) throw new Error(`Group not found: ${groupPath ?? groupId}`);
  return id;
}

function topTags(compositeHash: string) {
  const rows = db.prepare(`
    SELECT t.tag_key, t.tag_type
    FROM media_metadata m
    JOIN media_auto_tags mat ON mat.media_id = m.${MEDIA_ROW_ID_COLUMN}
    JOIN auto_tag_terms t ON t.term_id = mat.term_id
    WHERE m.composite_hash = ? AND t.tag_type IN ('general', 'character')
    ORDER BY CASE t.tag_type WHEN 'character' THEN 0 ELSE 1 END, mat.score DESC LIMIT 10
  `).all(compositeHash) as Array<{ tag_key: string; tag_type: string }>;
  return rows.map((row) => row.tag_key);
}

export function registerEmoticonTools(server: McpServer, context: McpRequestContext): void {
  server.tool(
    'list_emoticon_groups',
    'List chat emoticon groups (custom groups whose images carry keywords a chat writes as &*keyword*&), with image and keyword counts.',
    {},
    () => {
      try {
        return textResult({ groups: EmoticonService.listGroups(), promptBudget: EMOTICON_PROMPT_BUDGET });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'list_emoticons',
    'List the images of a custom group with their emoticon keywords. Keywords marked explicit=false come from the file name. Includes file name and top auto tags to help choose keywords; use view_images to look at the images.',
    {
      group_id: groupIdSchema,
      group_path: groupPathSchema,
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(100),
    },
    ({ group_id, group_path, offset, limit }) => {
      try {
        const groupId = resolveGroup(group_id, group_path);
        const group = EmoticonService.findGroup(groupId);
        const entries = EmoticonService.listEntries(groupId);
        return textResult({
          group: { id: groupId, name: group?.name, emoticon_enabled: group?.emoticon_enabled === 1 },
          total: entries.length,
          offset,
          entries: entries.slice(offset, offset + limit).map((entry) => ({
            composite_hash: entry.compositeHash,
            keywords: entry.keywords,
            explicit: entry.explicit,
            file_name: entry.fileName,
            mime_type: entry.mimeType,
            tags: topTags(entry.compositeHash),
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'set_emoticon_keywords',
    'Set the keywords of images in a group (several per image; the first is the main one). keywords: null restores the file-name keyword, [] removes all. A keyword can belong to one image per group: clashing items are skipped and reported. Keep words short and natural (e.g. 웃음, 부끄러움, thumbs up).',
    {
      group_id: groupIdSchema,
      group_path: groupPathSchema,
      items: z.array(z.object({
        composite_hash: z.string().trim().min(1),
        keywords: z.array(z.string().trim().min(1).max(40)).max(12).nullable(),
      })).min(1).max(200),
    },
    ({ group_id, group_path, items }) => {
      try {
        const groupId = resolveGroup(group_id, group_path);
        return textResult(EmoticonService.setKeywords(groupId, items.map((item) => ({ compositeHash: item.composite_hash, keywords: item.keywords }))));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'set_emoticon_group',
    'Turn a custom group into a chat emoticon group (or back). Chat profiles can only link emoticon groups.',
    {
      group_id: groupIdSchema,
      group_path: groupPathSchema,
      enabled: z.boolean(),
    },
    ({ group_id, group_path, enabled }) => {
      try {
        const groupId = resolveGroup(group_id, group_path);
        GroupModel.update(groupId, { emoticon_enabled: enabled });
        return textResult({ group_id: groupId, emoticon_enabled: enabled });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'view_images',
    `Look at up to ${VIEW_MAX_IMAGES} images: library images by composite_hash and/or private stored files by file_id. Returns small previews (first frame of animations). Only works when your model can see images.`,
    {
      composite_hashes: z.array(z.string().trim().min(1)).max(VIEW_MAX_IMAGES).optional(),
      file_ids: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(VIEW_MAX_IMAGES).optional(),
    },
    async ({ composite_hashes = [], file_ids = [] }) => {
      if (composite_hashes.length + file_ids.length === 0) return errorResult(new Error('Give composite_hashes or file_ids'));
      if (composite_hashes.length + file_ids.length > VIEW_MAX_IMAGES) return errorResult(new Error(`At most ${VIEW_MAX_IMAGES} images at a time`));
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      const limit = contextContentLimit(context);
      for (const hash of composite_hashes) {
        try {
          const metadata = MediaMetadataModel.findByHash(hash);
          const file = metadata && MediaPostprocessVisibilityService.isReadyRecord(metadata) && !ImageSafetyService.isHidden(metadata.rating_score) ? EmoticonService.activeFile(hash) : null;
          if (!file || !fs.existsSync(file.path) || file.mimeType?.startsWith('video/')) throw new Error('not an available image');
          if (!await libraryMediaAllowed(hash, limit)) throw new Error(CONTENT_RATING_BLOCKED);
          content.push({ type: 'text', text: `composite_hash ${hash}:` });
          content.push({ type: 'image', data: await previewImage(file.path), mimeType: 'image/jpeg' });
        } catch (error) {
          content.push({ type: 'text', text: `composite_hash ${hash}: ${error instanceof Error ? error.message : 'unavailable'}` });
        }
      }
      for (const id of file_ids) {
        try {
          const { entry, filePath } = FileStoreService.resolveFile(requireFileStoreOwner(context.requester), id);
          if (!entry.mimeType?.startsWith('image/')) throw new Error('not an image file');
          if (!await storedFileAllowed(id, limit)) throw new Error(CONTENT_RATING_BLOCKED);
          content.push({ type: 'text', text: `file_id ${id} (${entry.name}):` });
          content.push({ type: 'image', data: await previewImage(filePath), mimeType: 'image/jpeg' });
        } catch (error) {
          content.push({ type: 'text', text: `file_id ${id}: ${error instanceof Error ? error.message : 'unavailable'}` });
        }
      }
      return { content };
    },
  );

  server.tool(
    'view_media_frames',
    `Watch a video or an animated GIF/WebP as still frames: a library item by composite_hash or a private stored file by file_id. Takes up to ${MEDIA_FRAMES_MAX} frames spread evenly over the whole clip or over start_seconds..end_seconds and tiles them, numbered, into pictures of up to ${FRAMES_PER_SHEET_MAX} frames; the frame times come as text. Narrow the range, or use fewer frames per picture, to look closer at a moment. Only works when your model can see images.`,
    {
      composite_hash: z.string().trim().min(1).optional(),
      file_id: z.string().regex(/^[a-f0-9]{32}$/).optional(),
      count: z.number().int().min(1).max(MEDIA_FRAMES_MAX).optional().describe(`Frames to take (default ${MEDIA_FRAMES_DEFAULT})`),
      frames_per_image: z.number().int().min(1).max(FRAMES_PER_SHEET_MAX).optional().describe(`Frames tiled into one picture (default ${FRAMES_PER_SHEET_DEFAULT}); 1 sends each frame alone and larger`),
      start_seconds: z.number().min(0).optional(),
      end_seconds: z.number().positive().optional(),
    },
    async ({ composite_hash, file_id, count, frames_per_image, start_seconds, end_seconds }) => {
      try {
        if (!composite_hash === !file_id) throw new Error('Give exactly one of composite_hash or file_id');
        let filePath: string;
        let mimeType: string | null;
        let label: string;
        if (composite_hash) {
          // The tool itself needs no permission in a chat; library media still needs what viewing it on the web needs.
          if (context.requester) requireRequesterPermission(context.requester, 'images.view');
          const metadata = MediaMetadataModel.findByHash(composite_hash);
          const file = metadata && MediaPostprocessVisibilityService.isReadyRecord(metadata) && !ImageSafetyService.isHidden(metadata.rating_score) ? EmoticonService.activeFile(composite_hash) : null;
          if (!file || !fs.existsSync(file.path)) throw new Error('not an available media item');
          if (!await libraryMediaAllowed(composite_hash, contextContentLimit(context))) throw new Error(CONTENT_RATING_BLOCKED);
          ({ path: filePath, mimeType } = file);
          label = `composite_hash ${composite_hash}`;
        } else {
          const { entry, filePath: storedPath } = FileStoreService.resolveFile(requireFileStoreOwner(context.requester), file_id!);
          if (!await storedFileAllowed(file_id!, contextContentLimit(context))) throw new Error(CONTENT_RATING_BLOCKED);
          filePath = storedPath;
          mimeType = entry.mimeType;
          label = `file_id ${file_id} (${entry.name})`;
        }
        const result = await extractMediaFrames(filePath, mimeType, { count, start: start_seconds, end: end_seconds });
        const sheets = await frameSheets(result.frames, frames_per_image);
        // The pictures carry only the frame numbers; the times (and animation frame indices) travel here as text.
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [{
          type: 'text',
          text: `${label}: ${JSON.stringify({
            kind: result.kind,
            duration_seconds: result.duration,
            total_frames: result.totalFrames,
            frames: result.frames.map((frame, position) => ({ number: position + 1, time_seconds: frame.time, ...(frame.index === null ? {} : { animation_frame: frame.index }) })),
          })}\nEach picture tiles numbered frames in time order, left to right then top to bottom; the number is in each frame's top-left corner.`,
        }];
        for (const sheet of sheets) {
          content.push({ type: 'text', text: sheet.count === 1 ? `frame ${sheet.first}:` : `frames ${sheet.first}-${sheet.first + sheet.count - 1} (${sheet.columns}x${sheet.rows}):` });
          content.push({ type: 'image', data: sheet.data, mimeType: 'image/jpeg' });
        }
        return { content };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
