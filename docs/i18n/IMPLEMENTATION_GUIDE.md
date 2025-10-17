# i18n Implementation Guide

Complete guide for implementing internationalization across all pages in ComfyUI Image Manager.

## 📊 Project Status

### ✅ Completed
- **70 translation files** created (14 namespaces × 5 languages)
- **i18n configuration** updated with all namespaces
- **JSON validation** completed - all files pass syntax checks
- **TypeScript compilation** successful

### Languages Supported
- 🇰🇷 Korean (ko) - Primary language
- 🇺🇸 English (en)
- 🇯🇵 Japanese (ja)
- 🇨🇳 Simplified Chinese (zh-CN)
- 🇹🇼 Traditional Chinese (zh-TW)

## 📁 Translation File Structure

```
frontend/src/i18n/locales/
├── ko/
├── en/
├── ja/
├── zh-CN/
└── zh-TW/
    ├── common.json              # Common UI elements (buttons, messages, labels)
    ├── settings.json            # Settings page
    ├── navigation.json          # Header, navigation, footer
    ├── gallery.json             # Gallery page (filters, sorting)
    ├── imageDetail.json         # Image detail viewer modal
    ├── upload.json              # Upload page
    ├── imageGroups.json         # Image groups management
    ├── search.json              # Search page with filters
    ├── promptManagement.json    # Prompt collections and groups
    ├── workflows.json           # Workflow management
    ├── imageGeneration.json     # Image generation page
    ├── servers.json             # ComfyUI server management
    ├── errors.json              # Error messages
    └── validation.json          # Form validation messages
```

## 🔧 Usage in Components

### Basic Usage

```typescript
import { useTranslation } from 'react-i18next';

const MyComponent: React.FC = () => {
  const { t } = useTranslation('namespace');

  return (
    <div>
      <h1>{t('page.title')}</h1>
      <p>{t('page.description')}</p>
    </div>
  );
};
```

### Multiple Namespaces

```typescript
const { t } = useTranslation(['gallery', 'common']);

// Use specific namespace
<Button>{t('common:buttons.save')}</Button>
<Typography>{t('gallery:page.title')}</Typography>
```

### Interpolation (Dynamic Values)

```typescript
// Translation key: "selectedCount": "{{count}}개 항목 선택됨"
<Typography>{t('bulkActions.selectedCount', { count: 5 })}</Typography>
// Output: "5개 항목 선택됨"

// Translation key: "showing": "{{total}}개 중 {{from}}-{{to}}"
<Typography>{t('pagination.showing', { total: 100, from: 1, to: 20 })}</Typography>
// Output: "100개 중 1-20"
```

## 📝 Component Migration Examples

### Example 1: Header Component

**Before:**
```typescript
const navItems = [
  { label: '홈', path: '/' },
  { label: '갤러리', path: '/gallery' },
  { label: '설정', path: '/settings' },
];
```

**After:**
```typescript
import { useTranslation } from 'react-i18next';

const Header: React.FC = () => {
  const { t } = useTranslation('navigation');

  const navItems = [
    { label: t('header.menu.home'), path: '/' },
    { label: t('header.menu.gallery'), path: '/gallery' },
    { label: t('header.menu.settings'), path: '/settings' },
  ];

  return (
    <Typography variant="h6">{t('header.title')}</Typography>
  );
};
```

### Example 2: Gallery Page

**Before:**
```typescript
<Typography variant="h4">이미지 갤러리</Typography>
<Typography variant="body1">
  업로드된 모든 이미지를 확인하고 관리할 수 있습니다.
</Typography>
```

**After:**
```typescript
import { useTranslation } from 'react-i18next';

const GalleryPage: React.FC = () => {
  const { t } = useTranslation('gallery');

  return (
    <>
      <Typography variant="h4">{t('page.title')}</Typography>
      <Typography variant="body1">{t('page.description')}</Typography>
    </>
  );
};
```

### Example 3: Error Handling

**Before:**
```typescript
setError('이미지 로드에 실패했습니다');
```

**After:**
```typescript
import { useTranslation } from 'react-i18next';

const { t } = useTranslation('errors');
setError(t('image.loadFailed'));
```

### Example 4: Form Validation

**Before:**
```typescript
if (!name) {
  return '이름은 필수 항목입니다';
}
if (name.length < 3) {
  return '이름은 최소 3자 이상이어야 합니다';
}
```

**After:**
```typescript
import { useTranslation } from 'react-i18next';

const { t } = useTranslation('validation');

if (!name) {
  return t('required.name');
}
if (name.length < 3) {
  return t('length.min', { min: 3 });
}
```

## 🎯 Priority Implementation Order

### Phase 1: Core Navigation (High Priority)
1. **Header.tsx** - `navigation` namespace
   - Menu items, theme toggle, mobile menu
2. **Footer.tsx** - `navigation` namespace
   - Copyright, version info

### Phase 2: Main Pages (High Priority)
3. **GalleryPage.tsx** - `gallery` + `common` namespaces
   - Page title, filters, sorting, bulk actions
4. **UploadPage.tsx** - `upload` + `common` namespaces
   - Upload instructions, progress, validation
5. **ImageDetailPage.tsx** - `imageDetail` + `common` namespaces
   - Viewer controls, metadata display

### Phase 3: Management Pages (Medium Priority)
6. **ImageGroupsPage.tsx** - `imageGroups` + `common` namespaces
   - Group list, create/edit modal, auto-collection
7. **SearchPage.tsx** - `search` + `common` namespaces
   - Search filters, results display
8. **SettingsPage.tsx** - Already implemented ✅

### Phase 4: Advanced Features (Medium Priority)
9. **WorkflowsPage.tsx** - `workflows` + `common` namespaces
   - Workflow list, form, marked fields guide
10. **ImageGenerationPage.tsx** - `imageGeneration` + `servers` + `workflows` + `common`
    - Server management, workflow selection, generation controls

### Phase 5: Shared Components (Low Priority)
11. **ImageCard.tsx** - `common` namespace
12. **BulkActionBar.tsx** - `common` namespace
13. **PromptDisplay.tsx** - `promptManagement` + `common` namespaces
14. **ImageViewerModal components** - `imageDetail` + `common` namespaces

## 🔍 Testing Checklist

### Language Switching
- [ ] Language selection in Settings page works
- [ ] All text updates when language changes
- [ ] Selected language persists in localStorage
- [ ] Page refresh maintains selected language

### Content Verification (per language)
- [ ] All navigation menu items display correctly
- [ ] Page titles and descriptions are translated
- [ ] Button labels are in correct language
- [ ] Error messages display in correct language
- [ ] Validation messages work with interpolation
- [ ] Pluralization works correctly for count-based text

### Layout and UI
- [ ] Text doesn't overflow containers (especially in German/Japanese)
- [ ] RTL languages display correctly (if supported)
- [ ] Tooltips and ARIA labels are translated
- [ ] Date/time formats match language conventions

### Functionality
- [ ] Search functionality works in all languages
- [ ] Form submissions work correctly
- [ ] API error messages display properly
- [ ] Toast notifications use correct language

## 📚 Translation Key Naming Conventions

### Structure
```
namespace.category.subcategory.key
```

### Examples
```json
{
  "page": {
    "title": "...",
    "description": "..."
  },
  "buttons": {
    "save": "...",
    "cancel": "..."
  },
  "messages": {
    "success": "...",
    "error": "..."
  },
  "form": {
    "labels": {
      "name": "...",
      "email": "..."
    },
    "placeholders": {
      "enterName": "...",
      "enterEmail": "..."
    }
  }
}
```

### Best Practices
1. **Be Specific**: Use descriptive keys like `confirmDeleteImage` not just `confirm`
2. **Group Related Keys**: Keep similar content together
3. **Use Consistent Naming**: `button.save` not `btn.save` or `buttons.saveButton`
4. **Avoid Deep Nesting**: Maximum 4 levels deep
5. **Use Interpolation**: For dynamic content like `"Selected {{count}} items"`

## 🌐 Adding a New Language

1. **Create language directory:**
   ```bash
   mkdir frontend/src/i18n/locales/fr
   ```

2. **Copy and translate files:**
   ```bash
   cp frontend/src/i18n/locales/en/*.json frontend/src/i18n/locales/fr/
   # Then translate all JSON files
   ```

3. **Update i18n configuration:**
   ```typescript
   // frontend/src/i18n/index.ts
   import frCommon from './locales/fr/common.json';
   // ... import all other fr files

   const resources = {
     // ... other languages
     fr: {
       common: frCommon,
       // ... add all namespaces
     },
   };
   ```

4. **Add to language selector:**
   ```typescript
   // frontend/src/pages/Settings/components/GeneralSettings.tsx
   <MenuItem value="fr">Français</MenuItem>
   ```

## 🐛 Troubleshooting

### Missing Translation Key Error
**Problem**: Console shows "Missing translation key"
**Solution**: Check if the key exists in the JSON file and namespace is loaded

### Translation Not Updating
**Problem**: Text doesn't change when switching languages
**Solution**:
1. Check if component uses `useTranslation` hook
2. Verify localStorage has correct language code
3. Clear browser cache and localStorage

### Build Errors with JSON Files
**Problem**: TypeScript compilation fails with JSON syntax errors
**Solution**:
1. Validate JSON syntax using online tools
2. Check for smart quotes - use straight quotes only
3. Ensure all strings are properly escaped

### Interpolation Not Working
**Problem**: Shows `{{variable}}` instead of value
**Solution**:
1. Pass variables as second parameter: `t('key', { variable: value })`
2. Check variable name matches exactly

## 📖 Additional Resources

- **i18next Documentation**: https://www.i18next.com/
- **react-i18next Guide**: https://react.i18next.com/
- **Translation Management**: Consider tools like Crowdin or Lokalise for team collaboration

## 📞 Support

For questions or issues with i18n implementation:
1. Check this guide first
2. Review translation JSON files in `frontend/src/i18n/locales/`
3. Test with different languages to identify the issue
4. Check browser console for i18n warnings/errors
