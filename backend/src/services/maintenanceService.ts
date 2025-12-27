
import { db } from '../database/init';
import { PromptCollectionService } from './promptCollectionService';

export class MaintenanceService {
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

            // 2. Parse tags and collect unique ones
            // Using a Set to dedup first might save DB calls if we were doing single inserts,
            // but PromptCollectionService.batchAddOrIncrementAuto handles increments, so we should allow duplicates
            // across images to count usage correctly?
            // WAIT: "usage_count" represents how many images have this tag.
            // So if I have 100 images with "1girl", usage_count should be ~100.
            // IF resetting, we might over-count if we just add blindly and the DB isn't empty.
            // BUT PromptCollectionService.batchAddOrIncrementAuto increments existing.
            // IF we are just "Backfilling", we risk double-counting if some were already added.
            // Ideally, we should recalculate from scratch or be careful.
            // For a "Sync" (meaning "fix missing"), maybe we should just clear and rebuild?
            // Or just add missing?
            // The user issue is "collection is missing".
            // Clearing and rebuilding is safest for "usage_count" accuracy.

            // Let's truncate the auto_prompt_collection table first to ensure accuracy.
            // "PromptCollectionService" doesn't have a truncate method, but we can access DB directly here since we are Maintenance.

            console.log('🔄 [Maintenance] Truncating auto_prompt_collection for fresh rebuild...');
            db.prepare('DELETE FROM auto_prompt_collection').run();
            // Reset sequence
            db.prepare("DELETE FROM sqlite_sequence WHERE name='auto_prompt_collection'").run();

            const allPrompts: string[] = [];

            for (const row of rows) {
                try {
                    const tagsData = JSON.parse(row.auto_tags);
                    if (tagsData && tagsData.taglist) {
                        // taglist is usually a comma-separated string
                        const tags = tagsData.taglist.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);

                        for (const tag of tags) {
                            allPrompts.push(tag);
                        }
                    }
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
