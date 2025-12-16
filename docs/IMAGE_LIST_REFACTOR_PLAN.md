# Image List Refactoring Plan

## 1. Objective
Refactor the diverse image list implementations across the application into a single, unified, and highly customizable `ImageList` component. This component should support user-configurable settings (layout, density, scrolling mode) that are persisted per usage context (Home, Search, Group, etc.). The "Gallery" page will be deprecated.

## 2. Current State Analysis

| Page/Context | Component Used | Layout | Scrolling | State Support |
|---|---|---|---|---|
| **Home** | `ImageMasonry` | Masonry | Infinite Scroll | Selection, Bulk Actions |
| **Search** | `ImageGrid` | Grid (Fixed) | Pagination | Selection, Bulk Actions |
| **Group Modal** | `GroupImageGridModal` | Grid (Fixed) | Pagination | Selection, Remove/Assign |
| **Gallery** | `ImageMasonry` | Masonry | Infinite Scroll | (To be deleted) |

**Key Pain Points:**
- Inconsistent UX (Masonry vs Grid forced by page).
- No user control over density (columns) or layout preference.
- Duplicated logic for selection and image viewers in `ImageGrid` vs `ImageMasonry`.
- Separate maintenance for two similar display components.

## 3. Proposed Architecture

### 3.1. Unified `ImageList` Component
A single entry point component that handles the display logic based on configuration.

```typescript
interface ImageListProps {
  // Data
  images: ImageRecord[];
  loading: boolean;
  
  // Context for Persistence
  contextId: string; // e.g., 'home', 'search', 'group_modal'
  
  // Pagination / Scroll
  mode?: 'infinite' | 'pagination'; // Override or default from settings
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    pageSize: number;
    onPageSizeChange: (size: number) => void;
  };
  infiniteScroll?: {
    hasMore: boolean;
    loadMore: () => void;
  };
  
  // Selection
  selectable?: boolean;
  selection?: {
    selectedIds: number[];
    onSelectionChange: (ids: number[]) => void;
  };
  
  // Actions
  onImageClick?: (image: ImageRecord, index: number) => void;
  onDelete?: (ids: number[]) => void;
}
```

### 3.2. Settings Management (`useImageListSettings`)
A hook to manage and persist view settings per context key.

**State Structure:**
```typescript
interface ImageListViewSettings {
  viewMode: 'grid' | 'masonry';
  gridColumns: number; // Base columns for xl screen, scaled down for smaller
  imageSize: 'small' | 'medium' | 'large'; // Alternative to columns?
  activeScrollMode: 'infinite' | 'pagination'; // User preference if allowed
}
```

**Persistence:**
- Store in `localStorage`: `image-manager-list-settings`
- JSON object mapping `contextId` to settings.

### 3.3. Component Internals
- **Header/Toolbar**: Optional toolbar above images to toggle View Mode (Grid/Masonry), Column Count slider/dropdown.
- **View Implementations**:
    - `MasonryView`: Wrapper around `react-masonry-css`.
    - `GridView`: Wrapper around MUI `Grid`.
- **Scroll Container**:
    - **Pagination**: Standard MUI `Pagination` at bottom.
    - **Infinite**: `react-infinite-scroll-component` wrapper.

## 4. Migration Strategy

### Phase 1: Core Component Implementation
1.  Create `frontend/src/components/ImageList/ImageList.tsx`.
2.  Create `frontend/src/hooks/useImageListSettings.ts`.
3.  Implement `ImageListToolbar` for user controls.
4.  Extract common "Image Card" logic into a truly unified `UnifiedImageCard` (merging `ImageCard` and `MasonryImageCard` differences).

### Phase 2: Page Migration
1.  **Home Page**: Replace `ImageMasonry` with `ImageList` (Context: `home`).
    - Default: Masonry, Infinite.
2.  **Search Page**: Replace `ImageGrid` with `ImageList` (Context: `search`).
    - Default: Grid, Pagination.
3.  **Group Modal**: Replace internal grid with `ImageList` (Context: `group`).
    - Verify modal scroll behavior.

### Phase 3: Cleanup
1.  Delete `frontend/src/pages/Gallery`.
2.  Remove `ImageGrid` and `ImageMasonry` (old components) once fully replaced.
3.  Update routes to remove Gallery.

## 5. Persistence Requirements
- **LocalStorage Key**: `IM_LIST_SETTINGS_V1`
- **Scopes**:
    - `home`: Independent settings.
    - `search`: Independent settings.
    - `group`: Independent settings (applied to all groups or per group? -> Likely generic "group view" setting).

## 6. Implementation References
- **Masonry**: Re-use `react-masonry-css` logic.
- **Grid**: Re-use MUI `Grid` logic.
- **Virtualization**: (Optional Future) Consider `react-window` if performance is an issue with large lists, but Masonry makes this hard.

## 7. Task Breakdown
1.  **Scaffold**: Create generic `ImageList` and settings hook.
2.  **Settings UI**: Create popover/bar for adjusting columns and mode.
3.  **Integrate Home**: Test infinite scroll + masonry/grid toggle.
4.  **Integrate Search**: Test pagination + grid/masonry toggle.
5.  **Clean up**: Delete unused files.
