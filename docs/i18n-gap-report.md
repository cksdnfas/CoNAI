# i18n Gap Report

Generated: 2026-03-05T06:00:59.573Z
Base locale: en

## Locale Missing Summary

- ko: missing keys 11, missing namespaces 0
- ja: missing keys 46, missing namespaces 0
- zh-CN: missing keys 46, missing namespaces 0
- zh-TW: missing keys 49, missing namespaces 0

## Missing Keys by Language/Namespace

### ko
- settings: 11 missing keys
  - general.deleteProtection.title
  - general.deleteProtection.description
  - general.deleteProtection.enabled.label
  - general.deleteProtection.enabled.description
  - general.deleteProtection.info
  - similarity.test.imageHash
  - similarity.test.placeholderHash
  - similarity.test.button
  - similarity.test.processing
  - similarity.test.result
  - similarity.test.failed

### ja
- search: 1 missing keys
  - searchBar.buttons.createGroupWithFilter
- settings: 45 missing keys
  - similarity.systemStatus.allCompleteShort
  - similarity.test.resultImage
  - similarity.test.modeLabel
  - similarity.test.matchLabel
  - similarity.test.noPreview
  - similarity.test.validation.requiredHash
  - similarity.test.validation.invalidHashFormat
  - similarity.test.imageDetails.hash
  - similarity.duplicateScan.selectForDelete
  - similarity.duplicateScan.unselectable
  - similarity.duplicateScan.imageFallback
  - common.loading
  - externalApi.providerType
  - externalApi.providerTypes.general
  - externalApi.providerTypes.llm
  - externalApi.llm.title
  - externalApi.llm.addLLMProvider
  - externalApi.llm.selectPreset
  - externalApi.llm.model
  - externalApi.llm.modelPlaceholder
  - externalApi.llm.modelCustomHelper
  - externalApi.llm.refreshModels
  - externalApi.llm.loadingModels
  - externalApi.llm.noModels
  - externalApi.llm.temperature
  - externalApi.llm.temperatureHelper
  - externalApi.llm.maxTokens
  - externalApi.llm.maxTokensHelper
  - externalApi.llm.systemPrompt
  - externalApi.llm.systemPromptPlaceholder
  - ... (15 more)

### zh-CN
- search: 1 missing keys
  - searchBar.buttons.createGroupWithFilter
- settings: 45 missing keys
  - similarity.systemStatus.allCompleteShort
  - similarity.test.resultImage
  - similarity.test.modeLabel
  - similarity.test.matchLabel
  - similarity.test.noPreview
  - similarity.test.validation.requiredHash
  - similarity.test.validation.invalidHashFormat
  - similarity.test.imageDetails.hash
  - similarity.duplicateScan.selectForDelete
  - similarity.duplicateScan.unselectable
  - similarity.duplicateScan.imageFallback
  - common.loading
  - externalApi.providerType
  - externalApi.providerTypes.general
  - externalApi.providerTypes.llm
  - externalApi.llm.title
  - externalApi.llm.addLLMProvider
  - externalApi.llm.selectPreset
  - externalApi.llm.model
  - externalApi.llm.modelPlaceholder
  - externalApi.llm.modelCustomHelper
  - externalApi.llm.refreshModels
  - externalApi.llm.loadingModels
  - externalApi.llm.noModels
  - externalApi.llm.temperature
  - externalApi.llm.temperatureHelper
  - externalApi.llm.maxTokens
  - externalApi.llm.maxTokensHelper
  - externalApi.llm.systemPrompt
  - externalApi.llm.systemPromptPlaceholder
  - ... (15 more)

### zh-TW
- search: 1 missing keys
  - searchBar.buttons.createGroupWithFilter
- settings: 48 missing keys
  - tagger.batch.confirmDialog.resetMessage
  - tagger.batch.alerts.resetComplete
  - tagger.batch.alerts.resetFailed
  - similarity.systemStatus.allCompleteShort
  - similarity.test.resultImage
  - similarity.test.modeLabel
  - similarity.test.matchLabel
  - similarity.test.noPreview
  - similarity.test.validation.requiredHash
  - similarity.test.validation.invalidHashFormat
  - similarity.test.imageDetails.hash
  - similarity.duplicateScan.selectForDelete
  - similarity.duplicateScan.unselectable
  - similarity.duplicateScan.imageFallback
  - common.loading
  - externalApi.providerType
  - externalApi.providerTypes.general
  - externalApi.providerTypes.llm
  - externalApi.llm.title
  - externalApi.llm.addLLMProvider
  - externalApi.llm.selectPreset
  - externalApi.llm.model
  - externalApi.llm.modelPlaceholder
  - externalApi.llm.modelCustomHelper
  - externalApi.llm.refreshModels
  - externalApi.llm.loadingModels
  - externalApi.llm.noModels
  - externalApi.llm.temperature
  - externalApi.llm.temperatureHelper
  - externalApi.llm.maxTokens
  - ... (18 more)

## Hardcoded String Findings (Heuristic)

- Files with findings: 93
- Total findings: 500

### By Feature (Top)
- settings: 109
- image-generation: 103
- image-groups: 73
- workflows: 63
- images: 49
- prompt-explorer: 37
- auth: 16
- upload: 16
- api-playground: 10
- home: 9
- dashboard: 8
- image-detail: 7

### File Details (Top 40)
- frontend/src/features/api-playground/api-playground-page.tsx (10)
  - [jsx-text] API Playground
  - [jsx-text] 프록시(`/api`, `/uploads`, `/temp`) 경로가 기존 백엔드와 정상 연결되는지 즉시 검증합니다.
  - [jsx-text] Request
  - [jsx-text] GET/POST 테스트용 미니 클라이언트
  - [jsx-text] GET
  - [jsx-text] POST
  - [jsx-text] Run
  - [jsx-text] Clear
- frontend/src/features/auth/login-page.tsx (16)
  - [jsx-text] ComfyUI Image Manager
  - [jsx-text] Sign in to continue
  - [jsx-text] Login failed
  - [jsx-text] Username
  - [jsx-text] Password
  - [jsx-text] Account recovery guide
  - [jsx-text] Account recovery
  - [jsx-text] If you lost your account password, remove the auth database and restart the server.
- frontend/src/features/dashboard/dashboard-page.tsx (8)
  - [jsx-text] Dashboard
  - [jsx-text] 기존 백엔드(`:1666`) 연동 상태를 점검하기 위한 shadcn/ui 테스트 대시보드입니다.
  - [jsx-text] Backend connection failed
  - [jsx-text] Route coverage (test frontend scope)
  - [jsx-text] 기존 프론트의 다중 기능 구조를 분리 프론트에서 테스트 가능한 형태로 재현했습니다.
  - [jsx-text] Images
  - [jsx-text] Settings
  - [jsx-text] API Playground
- frontend/src/features/home/components/bulk-action-bar.tsx (1)
  - [attr] close
- frontend/src/features/home/components/search-bar.tsx (2)
  - [jsx-text] (null)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [groupInitialConditions, setGroupInitialConditions] = useState
  - [jsx-text] 0

  return (
- frontend/src/features/home/home-page.tsx (5)
  - [jsx-text] Math.max(1, Math.min(10, Math.floor(value)))

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState
  - [jsx-text] ('info')
  const [layoutOptionsOpen, setLayoutOptionsOpen] = useState(false)
  const [layoutDraftContext, setLayoutDraftContext] = useState
  - [jsx-text] ('home')
  const [draftViewMode, setDraftViewMode] = useState
  - [jsx-text] ('masonry')
  const [draftGridColumns, setDraftGridColumns] = useState(4)
  const layoutPanelRef = useRef
  - [jsx-text] (null)
  const layoutFabRef = useRef
- frontend/src/features/home/hooks/use-bulk-actions.ts (1)
  - [jsx-text] (null)

  const deleteImages = useCallback(async (fileIds: number[]): Promise
- frontend/src/features/image-detail/image-detail-page.tsx (7)
  - [jsx-text] ()
  const navigate = useNavigate()
  const backendOrigin = getBackendOrigin()

  const [image, setImage] = useState
  - [jsx-text] (null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState
  - [jsx-text] Image Hash
  - [jsx-text] Hash generation pending...
  - [jsx-text] Hash copied successfully.
  - [attr] Go back
  - [attr] Copy hash
- frontend/src/features/image-generation/bridges/custom-dropdown-lists-section.tsx (21)
  - [jsx-text] ([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState
  - [jsx-text] (null)
  const [tab, setTab] = useState
  - [jsx-text] Custom Dropdown Lists
  - [jsx-text] Add List
  - [jsx-text] Custom dropdown error
  - [jsx-text] Close
  - [jsx-text] Loading custom dropdown lists...
  - [jsx-text] ) : activeLists.length === 0 ? (
- frontend/src/features/image-generation/bridges/nai-group-selector.tsx (2)
  - [jsx-text] Select Group
  - [jsx-text] Clear
- frontend/src/features/image-generation/bridges/use-nai-generation.ts (1)
  - [jsx-text] (null)
  const [userData, setUserData] = useState
- frontend/src/features/image-generation/bridges/use-repeat-execution.ts (3)
  - [jsx-text] Promise
  - [jsx-text] (DEFAULT_REPEAT_CONFIG)
  const [repeatState, setRepeatState] = useState
  - [jsx-text] (DEFAULT_REPEAT_STATE)
  const timerRef = useRef
- frontend/src/features/image-generation/bridges/wildcard-page.tsx (18)
  - [jsx-text] ([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState
  - [jsx-text] (nodes)

  const [copyNotice, setCopyNotice] = useState
  - [jsx-text] (null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorError, setEditorError] = useState
  - [jsx-text] (null)
  const [editingNode, setEditingNode] = useState
  - [jsx-text] (null)
  const [form, setForm] = useState
  - [jsx-text] (defaultForm)
  const [editorToolTab, setEditorToolTab] = useState
  - [jsx-text] ('comfyui')

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewTool, setPreviewTool] = useState
  - [jsx-text] ('comfyui')
  const [previewText, setPreviewText] = useState('')
  const [previewResults, setPreviewResults] = useState
- frontend/src/features/image-generation/nai/components/nai-basic-settings.tsx (10)
  - [jsx-text] NAI Basic Settings
  - [jsx-text] Model
  - [jsx-text] NAI Diffusion 4.5 Curated
  - [jsx-text] NAI Diffusion 4.5 Full
  - [jsx-text] NAI Diffusion 3
  - [jsx-text] Resolution
  - [jsx-text] Prompt
  - [jsx-text] Negative prompt
- frontend/src/features/image-generation/nai/components/nai-image-generator-v2.tsx (1)
  - [jsx-text] Generation failed
- frontend/src/features/image-generation/nai/components/nai-output-settings.tsx (4)
  - [jsx-text] NAI Output Settings
  - [jsx-text] Number of samples
  - [jsx-text] Update output samples
  - [attr] NAI output samples
- frontend/src/features/image-generation/nai/components/nai-sampling-settings.tsx (17)
  - [jsx-text] NAI Sampling Settings
  - [jsx-text] Sampler
  - [jsx-text] Euler
  - [jsx-text] Euler Ancestral
  - [jsx-text] DPM++ 2M
  - [jsx-text] DDIM
  - [jsx-text] Noise schedule
  - [jsx-text] Karras
- frontend/src/features/image-generation/nai/hooks/use-nai-group-selection.ts (1)
  - [jsx-text] (getInitialGroupId)
  const [selectedGroup, setSelectedGroup] = useState
- frontend/src/features/image-generation/tabs/comfyui-tab.tsx (6)
  - [jsx-text] ([])
  const [workflowsLoading, setWorkflowsLoading] = useState(true)
  const [workflowsError, setWorkflowsError] = useState
  - [jsx-text] (null)

  const [servers, setServers] = useState
  - [jsx-text] ([])
  const [serversLoading, setServersLoading] = useState(true)
  const [serversError, setServersError] = useState
  - [jsx-text] (null)
  const [openDialog, setOpenDialog] = useState(false)
  const [editingServer, setEditingServer] = useState
  - [jsx-text] (null)
  const [testingServerId, setTestingServerId] = useState
  - [jsx-text] (null)
  const [connectionStatus, setConnectionStatus] = useState
- frontend/src/features/image-generation/wildcards/components/wildcard-delete-confirm-dialog.tsx (10)
  - [jsx-text] Confirm Wildcard Deletion
  - [jsx-text] This wildcard has child wildcards.
  - [jsx-text] Choose whether to move children up or delete everything.
  - [jsx-text] Choose deletion option:
  - [jsx-text] Delete this item only
  - [jsx-text] Child wildcards will move one level up
  - [jsx-text] Delete with children
  - [jsx-text] This action cannot be undone.
- frontend/src/features/image-generation/wildcards/components/wildcard-detail-panel.tsx (3)
  - [jsx-text] Wildcard Detail
  - [jsx-text] No items
  - [attr] Copy wildcard token
- frontend/src/features/image-generation/wildcards/components/wildcard-tree-panel.tsx (6)
  - [jsx-text] 0
  const isExpanded = expandedIds.has(node.id)
  const isSelected = selectedId === node.id
  const sortedChildren = hasChildren ? [...(node.children ?? [])].sort(sortChildren) : []

  return (
  - [jsx-text] Expand all
  - [jsx-text] Collapse all
  - [attr] Search...
  - [attr] Clear search
  - [attr] Wildcard tree
- frontend/src/features/image-groups/components/auto-folder-groups-content.tsx (7)
  - [jsx-text] (null)
  const [currentGroupInfo, setCurrentGroupInfo] = useState
  - [jsx-text] (null)
  const [breadcrumb, setBreadcrumb] = useState
  - [jsx-text] (currentParentId === null ? rootGroupsData : childGroupsData) || [],
    [childGroupsData, currentParentId, rootGroupsData],
  )
  const loading = currentParentId === null ? rootGroupsLoading : childGroupsLoading

  const [groupImagesModalOpen, setGroupImagesModalOpen] = useState(false)
  const [selectedGroupForImages, setSelectedGroupForImages] = useState
  - [jsx-text] (null)
  const [groupImages, setGroupImages] = useState
  - [jsx-text] ([])
  const [groupImagesLoading, setGroupImagesLoading] = useState(false)
  const [groupImagesPage, setGroupImagesPage] = useState(1)
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1)
  const [groupImagesTotal, setGroupImagesTotal] = useState(0)
  const [groupImagesPageSize, setGroupImagesPageSize] = useState
  - [jsx-text] 0

  return (
  - [jsx-text] ) : hasVisibleCards ? (
- frontend/src/features/image-groups/components/group-assign-modal.tsx (2)
  - [jsx-text] void | Promise
  - [jsx-text] ) : assignableGroups.length === 0 ? (
- frontend/src/features/image-groups/components/group-create-edit-modal.tsx (2)
  - [jsx-text] getInitialFormData(group, initialAutoCollectConditions))
  const [conditions, setConditions] = useState
  - [jsx-text] getInitialConditions(group, initialAutoCollectConditions))
  const [error, setError] = useState
- frontend/src/features/image-groups/components/group-image-grid-modal.tsx (26)
  - [jsx-text] )

const Typography: React.FC
  - [jsx-text] )

const CircularProgress: React.FC
  - [jsx-text] const Button: React.FC
  - [jsx-text] )

const Dialog: React.FC
  - [jsx-text] = Dialog

const DialogTitle: React.FC
  - [jsx-text] const DialogContent: React.FC
  - [jsx-text] const DialogActions: React.FC
  - [jsx-text] const DialogContentText: React.FC
- frontend/src/features/image-groups/components/group-parent-selector.tsx (2)
  - [jsx-text] 0 && (
  - [attr] Search...
- frontend/src/features/image-groups/components/group-tree-item.tsx (2)
  - [jsx-text] 0 && (
  - [attr] Auto-collect enabled
- frontend/src/features/image-groups/components/image-view-card-meta.tsx (1)
  - [jsx-text] ),
    badges: (
- frontend/src/features/image-groups/components/image-view-card-shell.tsx (1)
  - [jsx-text] Promise
- frontend/src/features/image-groups/components/search-auto-complete.tsx (5)
  - [jsx-text] ('positive')
  const [suggestions, setSuggestions] = useState
  - [jsx-text] ([])
  const [loading, setLoading] = useState(false)
  const [currentTerm, setCurrentTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)

  const [stats, setStats] = useState
  - [jsx-text] (null)
  const inputRef = useRef
  - [jsx-text] 0 || activeTab === 'rating') ? (
  - [jsx-text] Loading...
- frontend/src/features/image-groups/components/simple-search-tab.tsx (12)
  - [jsx-text] void
  onUpdateToken: (id: string, updates: Partial
  - [jsx-text] void
  onUpdate: (id: string, updates: Partial
  - [jsx-text] case 'AND':
        return
  - [jsx-text] case 'NOT':
        return
  - [jsx-text] default:
        return
  - [jsx-text] case 'negative':
        return
  - [jsx-text] case 'auto':
        return
  - [jsx-text] case 'rating':
        return
- frontend/src/features/image-groups/hooks/use-group-preview-image.ts (1)
  - [jsx-text] Promise
- frontend/src/features/image-groups/hooks/use-group-tree.ts (2)
  - [jsx-text] (new Set());
    const [internalSelectedIds, setInternalSelectedIds] = useState
  - [jsx-text] !excludeIds.includes(g.id));

        // Create a map for quick lookup
        const groupMap = new Map
- frontend/src/features/image-groups/image-groups-page.tsx (10)
  - [jsx-text] ('custom')
  const [selectedGroup, setSelectedGroup] = useState
  - [jsx-text] (null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [snackbar, setSnackbar] = useState
  - [jsx-text] (null)
  const [currentGroupInfo, setCurrentGroupInfo] = useState
  - [jsx-text] (null)
  const [breadcrumb, setBreadcrumb] = useState
  - [jsx-text] ((currentParentId === null ? rootGroupsData : childGroupsData) || []) as NavigableGroup[],
    [childGroupsData, currentParentId, rootGroupsData],
  )
  const loading = currentParentId === null ? rootGroupsLoading : childGroupsLoading

  const [groupImagesModalOpen, setGroupImagesModalOpen] = useState(false)
  const [selectedGroupForImages, setSelectedGroupForImages] = useState
  - [jsx-text] (null)
  const [groupImages, setGroupImages] = useState
  - [jsx-text] ([])
  const [groupImagesLoading, setGroupImagesLoading] = useState(false)
  const [groupImagesPage, setGroupImagesPage] = useState(1)
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1)
  const [groupImagesTotal, setGroupImagesTotal] = useState(0)
  const [groupImagesPageSize, setGroupImagesPageSize] = useState
  - [jsx-text] 0

  return (
- frontend/src/features/images/components/image-list-contract.ts (1)
  - [jsx-text] void | Promise
- frontend/src/features/images/components/image-list.tsx (7)
  - [jsx-text] (null)
  const [viewerImages, setViewerImages] = useState
  - [jsx-text] (images)
  const [editorSession, setEditorSession] = useState
  - [jsx-text] (null)
  const [lastCheckedIndex, setLastCheckedIndex] = useState
  - [jsx-text] Loading images...
  - [jsx-text] No images available.
  - [jsx-text] Prev
  - [jsx-text] Next
- frontend/src/features/images/editor/image-editor-modal.tsx (7)
  - [jsx-text] void | Promise
  - [jsx-text] (null)
  const drawingRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState
  - [jsx-text] Image Editor
  - [jsx-text] Draw directly on the image, then save to apply changes.
  - [jsx-text] Loading editor image...
  - [jsx-text] Clear
  - [jsx-text] Cancel
- frontend/src/features/images/images-page.tsx (10)
  - [jsx-text] Images
  - [jsx-text] `/api/images` 데이터를 shadcn table/card로 렌더링하는 분리 테스트 화면
  - [jsx-text] Image List
  - [jsx-text] Thumbnail
  - [jsx-text] Composite Hash
  - [jsx-text] Resolution
  - [jsx-text] Size
  - [jsx-text] Model
- frontend/src/features/images/viewer/image-viewer-dialog.tsx (22)
  - [jsx-text] (null)
  const [isTaggerEnabled, setIsTaggerEnabled] = useState(false)
  const [fileInfoMode, setFileInfoMode] = useState
  - [jsx-text] = 0 && viewerIndex
  - [jsx-text] File info
  - [jsx-text] Prompt Details
  - [jsx-text] Generation
  - [jsx-text] Groups:
  - [attr] Zoom In
  - [attr] Zoom Out

## Priority TODO (Actionable Units)

1. P0: Fill missing keys in locales where missing count > 0 (keep en schema lockstep).
2. P0: Replace hardcoded strings in feature pages with t() calls (start from top hardcoded features).
3. P1: Add CI step npm run i18n:check and fail on missing keys.
4. P1: Add component-level lint rule/codemod for hardcoded JSX text patterns.
5. P2: Expand check script with AST parsing to reduce false positives.
