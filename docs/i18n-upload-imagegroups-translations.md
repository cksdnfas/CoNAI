# i18n Translation Files - Upload & ImageGroups

Comprehensive translation files created for Upload and ImageGroups management pages across all 5 supported languages.

## Created Files

### Upload Translations
- `frontend/src/i18n/locales/ko/upload.json` (Korean)
- `frontend/src/i18n/locales/en/upload.json` (English)
- `frontend/src/i18n/locales/ja/upload.json` (Japanese)
- `frontend/src/i18n/locales/zh-CN/upload.json` (Simplified Chinese)
- `frontend/src/i18n/locales/zh-TW/upload.json` (Traditional Chinese)

### ImageGroups Translations
- `frontend/src/i18n/locales/ko/imageGroups.json` (Korean)
- `frontend/src/i18n/locales/en/imageGroups.json` (English)
- `frontend/src/i18n/locales/ja/imageGroups.json` (Japanese)
- `frontend/src/i18n/locales/zh-CN/imageGroups.json` (Simplified Chinese)
- `frontend/src/i18n/locales/zh-TW/imageGroups.json` (Traditional Chinese)

## Translation Coverage

### Upload Page (`upload.json`)

**Sections:**
1. **page**: Title and description
2. **dropzone**: Drag & drop UI, supported formats, feature badges
3. **buttons**: File selection, folder selection
4. **progress**: Upload progress tracking, file counts
5. **stages**: Upload stages (upload, metadata, thumbnail, auto-collect, auto-tag)
6. **status**: File status (waiting, processing, complete, error)
7. **messages**: Success/error messages, completion notifications
8. **guide**: Upload guide with 5 key points

**Key Content:**
- Drag & drop instructions with active/inactive states
- File format support (JPG, PNG, GIF, BMP, WebP, TIFF, MP4, WebM, MOV, AVI, MKV)
- Upload progress with stage indicators
- Success/error/partial success messages with counts
- Comprehensive upload guide covering metadata extraction, video processing, and auto-grouping

### ImageGroups Page (`imageGroups.json`)

**Sections:**
1. **page**: Title, description, empty state
2. **groupCard**: Group statistics display
3. **menu**: Context menu actions
4. **modal**: Create/edit modal UI
5. **conditions**: Auto-collection condition types and settings
   - **groups**: Basic, Prompt, Auto-tag categories
   - **types**: 13 condition types (AI tool, model name, prompts, auto-tags, ratings, etc.)
   - **values**: Boolean values (exists/not exists)
   - **ratings**: 4 rating types (General, Sensitive, Questionable, Explicit)
   - **fields**: Form field labels and help text
   - **placeholders**: Input placeholder text
6. **validation**: Form validation messages (13 validation rules)
7. **messages**: API response messages (success/error notifications)
8. **imageModal**: Group image viewer modal
9. **assignModal**: Group assignment modal

**Key Content:**
- Group management (create, edit, delete, auto-collection)
- 13 auto-collection condition types with detailed settings
- OR condition logic explanation
- Rating types and confidence score ranges
- Manual vs auto-collected image handling
- Group assignment with current group indicator
- Comprehensive validation messages for all edge cases

## Translation Structure

### Common Patterns

**Interpolation variables:**
- `{{count}}` - Item counts
- `{{name}}` - Names (group names, etc.)
- `{{index}}` - Condition index for validation
- `{{added}}`, `{{removed}}`, `{{converted}}`, `{{skipped}}` - Operation counts
- `{{success}}`, `{{failed}}` - Success/failure counts
- `{{min}}`, `{{max}}` - Score ranges
- `{{completed}}`, `{{total}}` - Progress tracking
- `{{from}}`, `{{to}}` - Pagination ranges
- `{{auto}}`, `{{manual}}` - Collection type counts

**Nested structure:**
```json
{
  "section": {
    "subsection": {
      "key": "Translated text"
    }
  }
}
```

## Auto-Collection Condition Types

### Basic Conditions
1. **ai_tool** - AI Tool (ComfyUI, NovelAI, etc.)
2. **model_name** - Model Name from metadata

### Prompt Conditions
3. **prompt_contains** - Prompt contains text
4. **prompt_regex** - Prompt regex pattern
5. **negative_prompt_contains** - Negative prompt contains text
6. **negative_prompt_regex** - Negative prompt regex pattern

### Auto-tag Conditions
7. **auto_tag_exists** - Auto-tag exists (boolean)
8. **auto_tag_rating** - Rating type (General/Sensitive/Questionable/Explicit)
9. **auto_tag_rating_score** - Rating score range (weighted, 0-200)
10. **auto_tag_general** - General tag name with confidence score (0.0-1.0)
11. **auto_tag_character** - Character name with confidence score (0.0-1.0)
12. **auto_tag_has_character** - Has character (boolean)
13. **auto_tag_model** - Auto-tag model name

## Language-Specific Notes

### Korean (ko)
- Formal politeness level (해요체)
- Natural Korean phrasing for technical terms
- Proper particle usage (이/가, 을/를)

### English (en)
- Clear, concise technical language
- Active voice preferred
- Consistent terminology

### Japanese (ja)
- Polite form (です・ます体)
- Technical terms in katakana where appropriate
- Natural Japanese sentence structure

### Chinese Simplified (zh-CN)
- Simplified characters (简体)
- Mainland China terminology
- Technical terms with Chinese equivalents

### Chinese Traditional (zh-TW)
- Traditional characters (繁體)
- Taiwan terminology preferences
- Technical terms adapted for Taiwan usage

## Usage Examples

### Upload Page
```typescript
import { useTranslation } from 'react-i18next';

const UploadPage = () => {
  const { t } = useTranslation('upload');

  return (
    <>
      <Typography variant="h4">{t('page.title')}</Typography>
      <Typography>{t('page.description')}</Typography>
      <Typography>{t('dropzone.dragInactive')}</Typography>
      <Alert>{t('messages.uploadSuccess')}</Alert>
    </>
  );
};
```

### ImageGroups Page
```typescript
import { useTranslation } from 'react-i18next';

const ImageGroupsPage = () => {
  const { t } = useTranslation('imageGroups');

  return (
    <>
      <Typography variant="h4">{t('page.title')}</Typography>
      <Typography>{t('page.description')}</Typography>
      <Chip label={t('groupCard.imageCount', { count: 42 })} />
      <Alert>{t('messages.autoCollectSuccess', { added: 5, removed: 2 })}</Alert>
    </>
  );
};
```

## Validation Messages with Index

```typescript
const { t } = useTranslation('imageGroups');

// Validation error with condition index
setError(t('validation.valueRequired', { index: i + 1 }));
setError(t('validation.scoreRangeInvalid', { index: i + 1 }));
```

## Next Steps

1. **Update Components**: Replace hardcoded Korean text with `t()` function calls
2. **Add Translation Keys**: Import and use translation files in components
3. **Test Translations**: Verify all languages display correctly
4. **Add Missing Keys**: If any text is missed, add to translation files
5. **Review Consistency**: Ensure terminology is consistent across all pages

## Translation Quality Checklist

- ✅ All Korean text extracted from components
- ✅ 5 languages fully translated (ko, en, ja, zh-CN, zh-TW)
- ✅ Interpolation variables properly formatted
- ✅ Nested structure for logical grouping
- ✅ Validation messages cover all edge cases
- ✅ Success/error messages for all API operations
- ✅ Auto-collection condition types fully documented
- ✅ Consistent terminology across sections
- ✅ Help text and placeholders included
- ✅ Empty states and loading messages covered

## File Statistics

### upload.json
- **Sections**: 8 major sections
- **Keys**: ~35 translation keys per language
- **Languages**: 5 (ko, en, ja, zh-CN, zh-TW)
- **Total Lines**: ~600 lines across all files

### imageGroups.json
- **Sections**: 9 major sections
- **Keys**: ~100 translation keys per language
- **Condition Types**: 13 auto-collection conditions
- **Languages**: 5 (ko, en, ja, zh-CN, zh-TW)
- **Total Lines**: ~1400 lines across all files

## File Paths

All translation files are located in:
```
frontend/src/i18n/locales/{language}/
├── upload.json
└── imageGroups.json
```

Where `{language}` is one of: `ko`, `en`, `ja`, `zh-CN`, `zh-TW`
