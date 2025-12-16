
import { Database } from 'better-sqlite3';

export const up = async (db: Database): Promise<void> => {
    console.log('🔄 Running migration: 007_add_parent_id_to_groups.ts');

    // 1. prompt_groups에 parent_id 추가
    try {
        db.prepare('ALTER TABLE prompt_groups ADD COLUMN parent_id INTEGER DEFAULT NULL').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_prompt_groups_parent ON prompt_groups(parent_id)').run();
    } catch (error: any) {
        if (!error.message.includes('duplicate column name')) {
            throw error;
        }
    }

    // 2. negative_prompt_groups에 parent_id 추가
    try {
        db.prepare('ALTER TABLE negative_prompt_groups ADD COLUMN parent_id INTEGER DEFAULT NULL').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_negative_prompt_groups_parent ON negative_prompt_groups(parent_id)').run();
    } catch (error: any) {
        if (!error.message.includes('duplicate column name')) {
            throw error;
        }
    }
};

export const down = async (db: Database): Promise<void> => {
    // SQLite는 DROP COLUMN을 지원하지 않는 버전이 있을 수 있으나, modern SQLite는 지원함.
    // 에러 발생 시 무시 (Migration rollback은 제한적일 수 있음)
    try {
        db.prepare('ALTER TABLE prompt_groups DROP COLUMN parent_id').run();
    } catch (e) { console.warn('Failed to drop column from prompt_groups', e); }

    try {
        db.prepare('ALTER TABLE negative_prompt_groups DROP COLUMN parent_id').run();
    } catch (e) { console.warn('Failed to drop column from negative_prompt_groups', e); }
};
