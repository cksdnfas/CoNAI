
export interface PromptGroupWithChildren extends PromptGroupWithPrompts {
    children?: PromptGroupWithChildren[];
}

import type { PromptGroupWithPrompts } from '@comfyui-image-manager/shared';

export const buildGroupTree = (groups: PromptGroupWithPrompts[]): PromptGroupWithChildren[] => {
    const groupMap = new Map<number, PromptGroupWithChildren>();
    const rootGroups: PromptGroupWithChildren[] = [];

    // Initialize map
    groups.forEach(group => {
        groupMap.set(group.id, { ...group, children: [] });
    });

    // Build tree
    groups.forEach(group => {
        const node = groupMap.get(group.id)!;
        if (group.parent_id && groupMap.has(group.parent_id)) {
            const parent = groupMap.get(group.parent_id)!;
            parent.children = parent.children || [];
            parent.children.push(node);
        } else {
            rootGroups.push(node);
        }
    });

    // Sort by display_order
    const sortGroups = (nodes: PromptGroupWithChildren[]) => {
        nodes.sort((a, b) => a.display_order - b.display_order);
        nodes.forEach(node => {
            if (node.children) {
                sortGroups(node.children);
            }
        });
    };

    sortGroups(rootGroups);
    return rootGroups;
};
