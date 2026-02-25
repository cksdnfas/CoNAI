export interface AutoFolderGroup {
    id: number;
    folder_path: string;
    absolute_path: string;
    display_name: string;
    parent_id: number | null;
    depth: number;
    has_images: boolean;
    image_count: number;
    color?: string;
    created_date: string;
    last_updated: string;
}
export interface CreateAutoFolderGroupData {
    folder_path: string;
    absolute_path: string;
    display_name: string;
    parent_id?: number | null;
    depth: number;
    has_images?: boolean;
    image_count?: number;
    color?: string;
}
export interface AutoFolderGroupWithStats extends AutoFolderGroup {
    child_count?: number;
}
export interface AutoFolderGroupHierarchy extends AutoFolderGroup {
    children: AutoFolderGroupHierarchy[];
}
export interface AutoFolderGroupImage {
    id: number;
    group_id: number;
    composite_hash: string;
    added_date: string;
}
export interface AutoFolderGroupRebuildResult {
    success: boolean;
    groups_created: number;
    images_assigned: number;
    duration_ms: number;
    error?: string;
}
//# sourceMappingURL=autoFolderGroup.d.ts.map