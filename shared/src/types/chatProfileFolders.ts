/** Chat profiles have a separate hierarchy from appearance settings. */
export type ChatProfileFolder = {
  id: number
  parentId: number | null
  name: string
  profileCount: number
  createdAt: string
  updatedAt: string
}

/** Optional in public clients for compatibility with hosts predating profile folders. */
export type ChatProfileFolderFields = {
  folderId?: number | null
  folderPath?: Array<{ id: number; name: string }>
  sortOrder?: number
}
