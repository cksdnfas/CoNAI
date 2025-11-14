import { useState, useEffect, useMemo } from 'react';
import { GroupWithHierarchy } from '@comfyui-image-manager/shared';

interface TreeNode {
  group: GroupWithHierarchy;
  children: TreeNode[];
  level: number;
}

interface UseGroupTreeOptions {
  groups: GroupWithHierarchy[];
  excludeIds?: number[];
  selectedIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
  multiSelect?: boolean;
}

export const useGroupTree = ({
  groups,
  excludeIds = [],
  selectedIds = [],
  onSelectionChange,
  multiSelect = false,
}: UseGroupTreeOptions) => {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<number>>(
    new Set(selectedIds)
  );

  // Update internal selected IDs when prop changes
  useEffect(() => {
    setInternalSelectedIds(new Set(selectedIds));
  }, [selectedIds]);

  // Build tree structure from flat group list
  const treeData = useMemo(() => {
    // Filter out excluded groups
    const filteredGroups = groups.filter((g) => !excludeIds.includes(g.id));

    // Create a map for quick lookup
    const groupMap = new Map<number, TreeNode>();
    filteredGroups.forEach((group) => {
      groupMap.set(group.id, {
        group,
        children: [],
        level: 0,
      });
    });

    // Build parent-child relationships
    const roots: TreeNode[] = [];
    filteredGroups.forEach((group) => {
      const node = groupMap.get(group.id);
      if (!node) return;

      if (group.parent_id && groupMap.has(group.parent_id)) {
        const parentNode = groupMap.get(group.parent_id)!;
        node.level = parentNode.level + 1;
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Sort roots and children by name
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.group.name.localeCompare(b.group.name));
      nodes.forEach((node) => sortNodes(node.children));
    };
    sortNodes(roots);

    return roots;
  }, [groups, excludeIds]);

  // Toggle expand/collapse
  const toggleExpand = (groupId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Expand all nodes
  const expandAll = () => {
    const allIds = new Set<number>();
    const collectIds = (nodes: TreeNode[]) => {
      nodes.forEach((node) => {
        if (node.children.length > 0) {
          allIds.add(node.group.id);
          collectIds(node.children);
        }
      });
    };
    collectIds(treeData);
    setExpandedIds(allIds);
  };

  // Collapse all nodes
  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  // Handle selection
  const handleSelect = (groupId: number) => {
    let newSelection: Set<number>;

    if (multiSelect) {
      newSelection = new Set(internalSelectedIds);
      if (newSelection.has(groupId)) {
        newSelection.delete(groupId);
      } else {
        newSelection.add(groupId);
      }
    } else {
      newSelection = new Set([groupId]);
    }

    setInternalSelectedIds(newSelection);
    onSelectionChange?.(Array.from(newSelection));
  };

  // Get all descendant IDs of a group
  const getDescendantIds = (groupId: number): number[] => {
    const descendants: number[] = [];
    const node = findNode(treeData, groupId);
    if (!node) return descendants;

    const collectDescendants = (node: TreeNode) => {
      node.children.forEach((child) => {
        descendants.push(child.group.id);
        collectDescendants(child);
      });
    };
    collectDescendants(node);

    return descendants;
  };

  // Find a node by ID
  const findNode = (nodes: TreeNode[], groupId: number): TreeNode | null => {
    for (const node of nodes) {
      if (node.group.id === groupId) return node;
      const found = findNode(node.children, groupId);
      if (found) return found;
    }
    return null;
  };

  // Check if a group is expanded
  const isExpanded = (groupId: number) => expandedIds.has(groupId);

  // Check if a group is selected
  const isSelected = (groupId: number) => internalSelectedIds.has(groupId);

  return {
    treeData,
    expandedIds,
    selectedIds: Array.from(internalSelectedIds),
    toggleExpand,
    expandAll,
    collapseAll,
    handleSelect,
    isExpanded,
    isSelected,
    getDescendantIds,
  };
};
