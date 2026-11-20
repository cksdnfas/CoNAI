import { getUserSettingsDb } from '../database/userSettingsDb';

type Library = 'prompt_presets' | 'wildcards';
type Row = { id: number; parent_id: number | null };
type Node<T> = T & { children?: Node<T>[] };

const branch = (table: Library) => `WITH RECURSIVE branch(id) AS (
  SELECT id FROM ${table} WHERE id = ?
  UNION SELECT child.id FROM ${table} child JOIN branch ON child.parent_id = branch.id
)`;

export function readPromptTreeRows<T extends Row>(table: Library, parentId: number | null): T[] {
  const db = getUserSettingsDb();
  return (parentId === null
    ? db.prepare(`SELECT * FROM ${table} ORDER BY name`).all()
    : db.prepare(`${branch(table)} SELECT * FROM ${table} WHERE id IN (SELECT id FROM branch) AND id <> ? ORDER BY name`).all(parentId, parentId)) as T[];
}

/** Rows arrive in sibling order. An orphan is not a root, just as in the hierarchy queries. */
export function buildPromptTree<T extends Row>(rows: T[], parentId: number | null = null): Node<T>[] {
  const byId = new Map<number, Node<T>>(rows.map(row => [row.id, row]));
  const roots: Node<T>[] = [];
  for (const node of byId.values()) {
    if (node.parent_id === parentId) roots.push(node);
    else if (node.parent_id !== null) {
      const parent = byId.get(node.parent_id);
      if (parent) (parent.children ??= []).push(node);
    }
  }
  return roots;
}

export function attachPromptItems<T extends Row, I>(rows: T[], items: I[], owner: (item: I) => number): Array<T & { items: I[] }> {
  const byId = new Map<number, I[]>();
  for (const item of items) {
    const id = owner(item);
    const group = byId.get(id);
    if (group) group.push(item);
    else byId.set(id, [item]);
  }
  return rows.map(row => ({ ...row, items: byId.get(row.id) ?? [] }));
}

export function deletePromptTreeNode(table: Library, id: number, cascade: boolean): boolean {
  const db = getUserSettingsDb();
  if (cascade) {
    return db.prepare(`${branch(table)} DELETE FROM ${table} WHERE id IN (SELECT id FROM branch)`).run(id).changes > 0;
  }
  return db.transaction(() => {
    const parentId = db.prepare(`SELECT parent_id FROM ${table} WHERE id = ?`).pluck().get(id) as number | null | undefined;
    if (parentId === undefined) return false;
    db.prepare(`UPDATE ${table} SET parent_id = ? WHERE parent_id = ?`).run(parentId, id);
    return db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
  }).immediate();
}
