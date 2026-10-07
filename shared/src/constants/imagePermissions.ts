/** Image reads are a feature shared by every page, including chat and public workflows. */
export const IMAGE_VIEW_PERMISSION = 'images.view' as const;

export const IMAGE_PERMISSION_CATALOG = [
  { permissionKey: IMAGE_VIEW_PERMISSION, resource: 'images', action: 'view', description: 'List and view images, thumbnails, originals and image detail across the app.' },
] as const;
