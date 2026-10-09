import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  startImageBatchResizeJob,
  waitForImageBatchResizeJob,
  type ImageBatchResizeResult,
} from '../../services/imageBatchResize/imageBatchResizeService';
import type { RuntimeJobRecord } from '../../types/runtimeJob';
import { isChatMcpSource, type McpRequestContext } from '../context';
import { refreshMcpRequester } from '../toolAccess';

/**
 * resize_images — the library selection action "크기 변경" for agents: resize library images to exactly W×H (Lanczos,
 * alpha kept) into NEW library items filed under a group. Originals are untouched; videos and animations are skipped.
 */

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

function describeJob(job: RuntimeJobRecord | null) {
  if (!job) return { status: 'missing' };
  const result = job.result as ImageBatchResizeResult | null | undefined;
  return {
    job_id: job.jobId,
    status: job.status,
    processed: job.progress.processed,
    total: job.progress.total,
    ...(job.status === 'failed' ? { error: job.failureMessage } : {}),
    ...(result
      ? {
        group_id: result.groupId,
        composite_hashes: result.saved.map((item) => item.compositeHash),
        saved: result.saved.map((item) => ({ source_composite_hash: item.source, composite_hash: item.compositeHash })),
        skipped: result.skipped,
        failed: result.failed,
      }
      : {}),
  };
}

export function registerImageResizeTools(server: McpServer, context: McpRequestContext = { scopes: [] }) {
  server.tool(
    'resize_images',
    'Resize library images to exactly width×height (Lanczos, transparency kept) and save each result as a NEW library image in a group (default "크기 변경"). Originals stay as they are; videos and animated images are skipped. Returns the new composite_hashes when it finishes within the wait, otherwise the job_id.',
    {
      composite_hashes: z.array(z.string().trim().regex(/^[0-9a-f]{32,48}$/i, 'composite_hash must be a library media hash')).min(1).max(500)
        .describe('Library image hashes (1..500, no duplicates)'),
      width: z.number().int().min(1).max(16384).describe('Output width in pixels'),
      height: z.number().int().min(1).max(16384).describe('Output height in pixels (width×height ≤ 67,108,864)'),
      format: z.enum(['png', 'webp']).optional().describe('Output format (default png)'),
      quality: z.number().int().min(1).max(100).optional().describe('WebP quality (default 90)'),
      group_id: z.number().int().positive().optional().describe('Save into this custom image group (default: group "크기 변경")'),
      wait_seconds: z.number().min(0).max(120).optional().describe('Seconds to wait for the result before returning the job id (default 60; chat max 30)'),
    },
    async ({ composite_hashes, width, height, format, quality, group_id, wait_seconds }) => {
      try {
        if (context.requester) refreshMcpRequester(context.requester);
        const job = startImageBatchResizeJob({
          compositeHashes: composite_hashes,
          width,
          height,
          format: format ?? 'png',
          quality: quality ?? 90,
          groupId: group_id ?? null,
          requestedByAccountId: context.requester?.accountId ?? null,
        });
        const budgetMs = Math.max(0, Math.min(wait_seconds ?? 60, isChatMcpSource(context.source) ? 30 : 120)) * 1000;
        return textResult(describeJob(budgetMs > 0 ? await waitForImageBatchResizeJob(job.jobId, budgetMs) : job));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
