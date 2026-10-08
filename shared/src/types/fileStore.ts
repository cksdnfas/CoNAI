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

/** Server folders administrators can browse next to the file store. Only the RecycleBin can be changed. */
export type SystemFolderRootId = 'recycle-bin' | 'uploads' | 'save' | 'temp' | 'logs';

export interface SystemFolderRoot {
  id: SystemFolderRootId;
  mode: 'recycle' | 'read-only';
  /** False when the folder does not exist on this server yet. */
  available: boolean;
}

/** Where a RecycleBin file came from. `originalPath` is null for files deleted before origins were recorded. */
export interface SystemFolderRecycleInfo {
  originalName: string;
  originalPath: string | null;
  deletedAt: string | null;
  source: string | null;
  restorable: boolean;
}

export interface SystemFolderEntry {
  name: string;
  /** Path inside the root, `/`-separated, without a leading slash. */
  path: string;
  kind: 'file' | 'folder';
  size: number;
  modifiedAt: string;
  mimeType: string | null;
  recycle?: SystemFolderRecycleInfo;
}

export interface SystemFolderListing {
  root: SystemFolderRootId;
  path: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  entries: SystemFolderEntry[];
  total: number;
  offset: number;
  limit: number;
}

/** Why one RecycleBin item failed: the original spot is taken, or no origin was recorded. */
export type SystemFolderFailureCode = 'conflict' | 'no-origin';

export interface SystemFolderBatchResult {
  done: Array<{ name: string; restoredTo?: string }>;
  failed: Array<{ name: string; error: string; code?: SystemFolderFailureCode }>;
}
