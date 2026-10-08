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

/** One account's file store as seen by an administrator. */
export interface StoredFileOwner {
  ownerKey: string;
  accountId: number | null;
  username: string | null;
  accountType: 'admin' | 'guest' | null;
  /** `deleted`: files remain for an account that no longer exists. `bootstrap`: the store used before any credentials were configured. */
  status: 'active' | 'disabled' | 'deleted' | 'bootstrap';
  fileCount: number;
  totalSize: number;
  self: boolean;
}

export interface StoredFileText {
  text: string;
  offset: number;
  nextOffset: number | null;
  size: number;
}
