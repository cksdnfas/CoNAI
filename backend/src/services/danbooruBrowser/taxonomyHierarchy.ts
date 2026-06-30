export interface TaxonomyHierarchyNodeRow {
  id: number;
  node_key: string;
  description: string | null;
  direct_member_tag_count: number;
  member_tag_count: number;
}

function resolveTaxonomyParentKeyFromNodeKey(nodeKey: string, nodeKeySet: Set<string>): string | null {
  const parts = nodeKey.split('__');

  for (let length = parts.length - 1; length > 0; length -= 1) {
    const candidate = parts.slice(0, length).join('__');
    if (nodeKeySet.has(candidate)) {
      return candidate;
    }
  }

  if ((parts[0] === 'manual' || parts[0] === 'proposed') && parts.length >= 3) {
    const groupKey = parts[1];
    const candidates = [
      groupKey,
      `${parts[0]}__${groupKey}`,
      `manual__${groupKey}`,
      groupKey.startsWith('manual_') ? `manual__${groupKey.slice('manual_'.length)}` : `manual__${groupKey}`,
    ];

    for (const candidate of candidates) {
      if (nodeKeySet.has(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function findExactMemberCountSubset<TNode extends TaxonomyHierarchyNodeRow>(
  candidates: TNode[],
  targetCount: number
): TNode[] {
  const sorted = [...candidates].sort((left, right) => right.member_tag_count - left.member_tag_count || left.id - right.id);
  const memo = new Set<string>();

  const search = (index: number, remaining: number): TNode[] | null => {
    if (remaining === 0) return [];
    if (remaining < 0 || index >= sorted.length) return null;

    const memoKey = `${index}:${remaining}`;
    if (memo.has(memoKey)) return null;

    const current = sorted[index];
    if (current.member_tag_count <= remaining) {
      const withCurrent = search(index + 1, remaining - current.member_tag_count);
      if (withCurrent) return [current, ...withCurrent];
    }

    const withoutCurrent = search(index + 1, remaining);
    if (withoutCurrent) return withoutCurrent;

    memo.add(memoKey);
    return null;
  };

  return search(0, targetCount) ?? [];
}

export function buildTaxonomyParentKeyByKey<TNode extends TaxonomyHierarchyNodeRow>(rows: TNode[]): Map<string, string> {
  const nodeKeySet = new Set(rows.map((row) => row.node_key));
  const parentKeyByKey = new Map<string, string>();

  for (const row of rows) {
    const parentKey = resolveTaxonomyParentKeyFromNodeKey(row.node_key, nodeKeySet);
    if (parentKey) {
      parentKeyByKey.set(row.node_key, parentKey);
    }
  }

  const tagLabParentGroups = rows.filter((row) => row.description?.startsWith('TAG LAB parent group:'));
  const tagLabCategories = rows.filter((row) =>
    row.description?.startsWith('TAG LAB category:')
    && row.direct_member_tag_count === 0
    && !row.description.startsWith('TAG LAB parent group:')
    && !parentKeyByKey.has(row.node_key),
  );

  for (const parentGroup of tagLabParentGroups) {
    const children = findExactMemberCountSubset(tagLabCategories, parentGroup.member_tag_count);
    for (const child of children) {
      parentKeyByKey.set(child.node_key, parentGroup.node_key);
    }
  }

  return parentKeyByKey;
}
