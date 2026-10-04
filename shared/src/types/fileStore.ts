/** Private file storage, independent of the image library. IDs survive moves and renames. */
export interface StoredFileEntry {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'file' | 'folder';
  mimeType: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileStoreListing {
  entries: StoredFileEntry[];
  breadcrumbs: StoredFileEntry[];
  total: number;
  offset: number;
  limit: number;
}

export interface StoredFileText {
  text: string;
  offset: number;
  nextOffset: number | null;
  size: number;
}
