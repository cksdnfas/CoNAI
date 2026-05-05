import { getUserSettingsDb } from '../database/userSettingsDb';

export interface PromptPreset {
  id: number;
  name: string;
  description?: string | null;
  parent_id: number | null;
  created_date: string;
  updated_date: string;
}

export interface PromptPresetItem {
  id: number;
  preset_id: number;
  description: string;
  value: string;
  order_index: number;
  created_date: string;
}

export interface PromptPresetItemInput {
  description: string;
  value: string;
}

export interface PromptPresetCreateData {
  name: string;
  description?: string | null;
  parent_id?: number | null;
  items: PromptPresetItemInput[];
}

export interface PromptPresetUpdateData {
  name?: string;
  description?: string | null;
  parent_id?: number | null;
  items?: PromptPresetItemInput[];
}

export interface PromptPresetWithItems extends PromptPreset {
  items: PromptPresetItem[];
}

export interface PromptPresetWithHierarchy extends PromptPresetWithItems {
  children?: PromptPresetWithHierarchy[];
}

/** Manage prompt-authoring presets stored in user-settings.db. */
export class PromptPresetModel {
  static findAll(): PromptPreset[] {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM prompt_presets ORDER BY name').all() as PromptPreset[];
  }

  static findById(id: number): PromptPreset | undefined {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM prompt_presets WHERE id = ?').get(id) as PromptPreset | undefined;
  }

  static findByName(name: string): PromptPreset | undefined {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM prompt_presets WHERE name = ?').get(name) as PromptPreset | undefined;
  }

  static create(data: PromptPresetCreateData): PromptPreset {
    const db = getUserSettingsDb();

    const result = db.transaction(() => {
      const presetResult = db.prepare(`
        INSERT INTO prompt_presets (name, description, parent_id)
        VALUES (?, ?, ?)
      `).run(data.name, data.description || null, data.parent_id ?? null);

      const presetId = presetResult.lastInsertRowid as number;
      const insertItem = db.prepare(`
        INSERT INTO prompt_preset_items (preset_id, description, value, order_index)
        VALUES (?, ?, ?, ?)
      `);

      data.items.forEach((item, index) => {
        insertItem.run(presetId, item.description, item.value, index);
      });

      return PromptPresetModel.findById(presetId);
    })();

    if (!result) {
      throw new Error('Failed to create prompt preset');
    }

    return result;
  }

  static update(id: number, data: PromptPresetUpdateData): PromptPreset {
    const db = getUserSettingsDb();

    const result = db.transaction(() => {
      const updates: string[] = [];
      const params: unknown[] = [];

      if (data.name !== undefined) {
        updates.push('name = ?');
        params.push(data.name);
      }
      if (data.description !== undefined) {
        updates.push('description = ?');
        params.push(data.description || null);
      }
      if (data.parent_id !== undefined) {
        updates.push('parent_id = ?');
        params.push(data.parent_id);
      }

      updates.push('updated_date = CURRENT_TIMESTAMP');
      params.push(id);

      db.prepare(`
        UPDATE prompt_presets
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params);

      if (data.items !== undefined) {
        db.prepare('DELETE FROM prompt_preset_items WHERE preset_id = ?').run(id);
        const insertItem = db.prepare(`
          INSERT INTO prompt_preset_items (preset_id, description, value, order_index)
          VALUES (?, ?, ?, ?)
        `);

        data.items.forEach((item, index) => {
          insertItem.run(id, item.description, item.value, index);
        });
      }

      return PromptPresetModel.findById(id);
    })();

    if (!result) {
      throw new Error('Failed to update prompt preset');
    }

    return result;
  }

  static delete(id: number, cascade = false): boolean {
    const db = getUserSettingsDb();

    if (cascade) {
      const children = db.prepare('SELECT id FROM prompt_presets WHERE parent_id = ?').all(id) as { id: number }[];
      for (const child of children) {
        this.delete(child.id, true);
      }
      const result = db.prepare('DELETE FROM prompt_presets WHERE id = ?').run(id);
      return result.changes > 0;
    }

    const preset = this.findById(id);
    if (!preset) {
      return false;
    }

    db.prepare('UPDATE prompt_presets SET parent_id = ? WHERE parent_id = ?').run(preset.parent_id, id);
    const result = db.prepare('DELETE FROM prompt_presets WHERE id = ?').run(id);
    return result.changes > 0;
  }

  static findByIdWithItems(id: number): PromptPresetWithItems | undefined {
    const preset = PromptPresetModel.findById(id);
    if (!preset) {
      return undefined;
    }

    return {
      ...preset,
      items: PromptPresetItemModel.findByPresetId(id),
    };
  }

  static findAllWithItems(): PromptPresetWithItems[] {
    return PromptPresetModel.findAll().map((preset) => ({
      ...preset,
      items: PromptPresetItemModel.findByPresetId(preset.id),
    }));
  }

  static findRoots(): PromptPreset[] {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM prompt_presets WHERE parent_id IS NULL ORDER BY name').all() as PromptPreset[];
  }

  static findByParentId(parentId: number): PromptPreset[] {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM prompt_presets WHERE parent_id = ? ORDER BY name').all(parentId) as PromptPreset[];
  }

  static findHierarchy(parentId: number | null = null): PromptPresetWithHierarchy[] {
    const db = getUserSettingsDb();
    const presets = parentId === null
      ? db.prepare('SELECT * FROM prompt_presets WHERE parent_id IS NULL ORDER BY name').all() as PromptPreset[]
      : db.prepare('SELECT * FROM prompt_presets WHERE parent_id = ? ORDER BY name').all(parentId) as PromptPreset[];

    return presets.map((preset) => {
      const items = PromptPresetItemModel.findByPresetId(preset.id);
      const children = PromptPresetModel.findHierarchy(preset.id);
      return {
        ...preset,
        items,
        children: children.length > 0 ? children : undefined,
      };
    });
  }

  static checkCircularReference(id: number, parentId: number): boolean {
    if (id === parentId) {
      return true;
    }

    let currentParentId: number | null = parentId;
    const visited = new Set<number>();

    while (currentParentId !== null) {
      if (visited.has(currentParentId)) {
        return true;
      }
      if (currentParentId === id) {
        return true;
      }

      visited.add(currentParentId);
      const parent = this.findById(currentParentId);
      currentParentId = parent?.parent_id ?? null;
    }

    return false;
  }
}

/** Manage individual description/value pairs for prompt presets. */
export class PromptPresetItemModel {
  static findByPresetId(presetId: number): PromptPresetItem[] {
    const db = getUserSettingsDb();
    return db.prepare('SELECT * FROM prompt_preset_items WHERE preset_id = ? ORDER BY order_index, id').all(presetId) as PromptPresetItem[];
  }
}
