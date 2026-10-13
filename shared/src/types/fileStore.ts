/** Shared instance file storage, independent of the image library. IDs survive moves and renames. */
export interface StoredFileEntry {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'file' | 'folder';
  mimeType: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
  /** Opaque current text revision, returned after text writes. */
  revision?: string;
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
  /** PDF/XLSX offsets address the extracted UTF-8 text, not the binary file. */
  extracted?: boolean;
  extractionState?: string;
  note?: string | null;
  revision?: string;
}

/** Pass these fields to read_file_text/linked_read to open the matching passage safely. */
export interface FileSearchReference {
  source: 'extracted';
  offset: number;
  limit: number;
  revision: string;
}

/**
 * Who wrote a text file's content: a person in the editor (or a restore), a chat character's tool (with its chat,
 * profile and reply), the MCP file tools, or the app itself.
 */
export interface FileWriteSource {
  via: 'editor' | 'restore' | 'chat' | 'mcp' | 'app';
  accountId?: number | null;
  threadId?: number;
  profileId?: number;
  /** The chat reply whose tool wrote it. */
  replyId?: string;
  /** Filled in when listed: the chat character's name. */
  profileName?: string;
}

/** An earlier text of a text file, kept when the file was replaced in place. */
export interface StoredFileRevision {
  id: string;
  fileId: string;
  size: number;
  /** When this text was written, and by whom (null: not known). */
  writtenAt: string;
  writtenBy: FileWriteSource | null;
  /** When it was replaced, and by whom. */
  replacedAt: string;
  replacedBy: FileWriteSource | null;
}

/** One search hit: a file or folder whose name or UTF-8 text contains every search term. */
export interface StoredFileSearchHit {
  entry: StoredFileEntry;
  /** Folder path from the store root, e.g. `/설정 문서` (`/` at the top). */
  path: string;
  /** A short excerpt around the first term found in the text, or null when only the name matched. */
  snippet: string | null;
  location?: string | null;
  extractionState?: string;
  extractionNote?: string | null;
  read?: FileSearchReference;
}

export interface FileSearchStatus {
  mode: 'keyword' | 'hybrid';
  semantic: 'not_requested' | 'disabled' | 'unavailable' | 'not_indexed' | 'partial' | 'ready';
  indexedFiles: number;
  searchableFiles: number;
  partialDocuments: number;
  failedDocuments: number;
  unsupportedFiles: number;
  pendingDocuments: number;
  keywordTermsLimited?: boolean;
}

export interface StoredFileSearchResult {
  /** The parsed terms, lowercased; a quoted phrase is one term. */
  terms: string[];
  hits: StoredFileSearchHit[];
  /** More hits exist than were returned. */
  truncated: boolean;
  search?: FileSearchStatus;
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
