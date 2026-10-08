
import { db } from '../database/init';
import { PromptCollectionService } from './promptCollectionService';
import { LIBRARY_BATCH_SIZE, chunkArray, pageBoundary, type LibraryBatchHooks } from './maintenance/libraryBatch';

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
     *
     * Runs as the `auto-tag-collection-sync` job: rows are read one rowid page at a time and their tags are added
     * in chunks of 500, instead of loading every auto_tags blob and every extracted tag into memory first.
     */
    static async syncAutoTags(hooks: LibraryBatchHooks = {}): Promise<{ processed: number; collected: number }> {
        console.log('🔄 [Maintenance] Starting auto-tag sync...');
        const startTime = Date.now();

        try {
            const total = (db.prepare('SELECT COUNT(*) AS c FROM media_metadata WHERE auto_tags IS NOT NULL').get() as { c: number }).c;
            console.log(`🔄 [Maintenance] Found ${total} images with auto_tags. Processing...`);

            // Truncate the auto_prompt_collection table first to ensure accuracy.
            console.log('🔄 [Maintenance] Truncating auto_prompt_collection for fresh rebuild...');
            db.transaction(() => {
                db.prepare('DELETE FROM auto_prompt_collection').run();
                // Reset sequence
                db.prepare("DELETE FROM sqlite_sequence WHERE name='auto_prompt_collection'").run();
            })();

            const nextPage = db.prepare(`
        SELECT rowid AS id, auto_tags
        FROM media_metadata
        WHERE rowid > ? AND auto_tags IS NOT NULL
        ORDER BY rowid
        LIMIT ${LIBRARY_BATCH_SIZE}
      `);

            let cursor = 0;
            let rowsProcessed = 0;
            let collected = 0;
            hooks.progress?.(0, total);
            for (;;) {
                hooks.throwIfCancelled?.();
                const rows = nextPage.all(cursor) as Array<{ id: number; auto_tags: string }>;
                if (rows.length === 0) {
                    break;
                }
                cursor = rows[rows.length - 1].id;

                const pagePrompts: string[] = [];
                for (const row of rows) {
                    try {
                        const tagsData = JSON.parse(row.auto_tags) as unknown;
                        pagePrompts.push(...this.extractAutoTagsPrompts(tagsData));
                    } catch (e) {
                        // Ignore parse errors
                    }
                }

                for (const chunk of chunkArray(pagePrompts)) {
                    await PromptCollectionService.batchAddOrIncrementAuto(chunk.map((prompt) => ({ prompt })));
                    collected += chunk.length;
                }

                rowsProcessed += rows.length;
                hooks.progress?.(rowsProcessed, total);
                await pageBoundary(hooks);
            }

            console.log(`✅ [Maintenance] Sync complete. Processed ${collected} tags in ${Date.now() - startTime}ms.`);
            return { processed: rowsProcessed, collected };

        } catch (error) {
            console.error('❌ [Maintenance] Sync failed:', error);
            throw error;
        }
    }
}
