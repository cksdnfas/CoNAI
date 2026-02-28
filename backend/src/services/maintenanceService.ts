
import { db } from '../database/init';
import { PromptCollectionService } from './promptCollectionService';

export class MaintenanceService {
    private static splitTaglist(raw: unknown): string[] {
        if (typeof raw !== 'string' || raw.trim().length === 0) {
            return [];
        }

        return raw
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
    }

    private static objectKeys(raw: unknown): string[] {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return [];
        }

        return Object.keys(raw as Record<string, unknown>)
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
    }

    private static extractAutoTagsPrompts(tagsData: unknown): string[] {
        if (!tagsData || typeof tagsData !== 'object') {
            return [];
        }

        const data = tagsData as Record<string, unknown>;
        const tagger = (data.tagger && typeof data.tagger === 'object') ? data.tagger as Record<string, unknown> : null;
        const kaloscope = (data.kaloscope && typeof data.kaloscope === 'object') ? data.kaloscope as Record<string, unknown> : null;

        const prompts: string[] = [];

        prompts.push(...this.splitTaglist(data.taglist));
        prompts.push(...this.splitTaglist(tagger?.taglist));
        prompts.push(...this.splitTaglist(kaloscope?.taglist));

        // Kaloscope artist labels
        prompts.push(...this.objectKeys(kaloscope?.artists));
        prompts.push(...this.objectKeys(kaloscope?.artist));

        // Fallbacks when taglist is missing
        if (prompts.length === 0) {
            prompts.push(...this.objectKeys(data.general));
            prompts.push(...this.objectKeys(tagger?.general));
            prompts.push(...this.objectKeys(kaloscope?.general));
        }

        return prompts;
    }

    /**
     * Syncs auto-tags from all images in media_metadata to the auto_prompt_collection table.
     * This is useful if the prompt collection gets out of sync or was not properly populated.
     */
    static async syncAutoTags(): Promise<{ processed: number; collected: number }> {
        console.log('🔄 [Maintenance] Starting auto-tag sync...');
        const startTime = Date.now();

        try {
            // 1. Get all images with auto_tags
            const rows = db.prepare(`
        SELECT auto_tags
        FROM media_metadata
        WHERE auto_tags IS NOT NULL
      `).all() as { auto_tags: string }[];

            console.log(`🔄 [Maintenance] Found ${rows.length} images with auto_tags. Processing...`);

            let totalTags = 0;
            const uniqueTags = new Set<string>();

            // Let's truncate the auto_prompt_collection table first to ensure accuracy.
            // "PromptCollectionService" doesn't have a truncate method, but we can access DB directly here since we are Maintenance.

            console.log('🔄 [Maintenance] Truncating auto_prompt_collection for fresh rebuild...');
            db.prepare('DELETE FROM auto_prompt_collection').run();
            // Reset sequence
            db.prepare("DELETE FROM sqlite_sequence WHERE name='auto_prompt_collection'").run();

            const allPrompts: string[] = [];

            for (const row of rows) {
                try {
                    const tagsData = JSON.parse(row.auto_tags) as unknown;
                    const prompts = this.extractAutoTagsPrompts(tagsData);
                    allPrompts.push(...prompts);
                } catch (e) {
                    // Ignore parse errors
                }
            }

            console.log(`🔄 [Maintenance] Extracted ${allPrompts.length} total tags. Batching insert...`);

            // 3. Batch insert/update
            // We can use PromptCollectionService.batchAddOrIncrementAuto
            // Map strings to required format

            // Since we have a huge list, let's process in chunks of 500
            const CHUNK_SIZE = 500;
            let processed = 0;

            for (let i = 0; i < allPrompts.length; i += CHUNK_SIZE) {
                const chunk = allPrompts.slice(i, i + CHUNK_SIZE);
                const formatForService = chunk.map(p => ({ prompt: p }));

                await PromptCollectionService.batchAddOrIncrementAuto(formatForService);
                processed += chunk.length;
                if (processed % 5000 === 0) {
                    console.log(`🔄 [Maintenance] Processed ${processed}/${allPrompts.length} tags...`);
                }
            }

            console.log(`✅ [Maintenance] Sync complete. Processed ${processed} tags in ${Date.now() - startTime}ms.`);
            return { processed: rows.length, collected: processed };

        } catch (error) {
            console.error('❌ [Maintenance] Sync failed:', error);
            throw error;
        }
    }
}
