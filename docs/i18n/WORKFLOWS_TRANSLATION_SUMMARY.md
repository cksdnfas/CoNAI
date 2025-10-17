# Workflows & Image Generation Translation Files Summary

## Overview

Comprehensive i18n translation files created for Workflows and Image Generation features across 5 languages (ko, en, ja, zh-CN, zh-TW).

## Created Files

### 1. Workflows Translations
**Path**: `frontend/src/i18n/locales/{lang}/workflows.json`

**Languages**: ko, en, ja, zh-CN, zh-TW

**Content Sections**:
- **page**: Page titles and descriptions
- **card**: Workflow card display (status, field counts, dates)
- **form**: Form fields and validation messages
- **alerts**: Important warnings and success messages
- **markedFields**: Complete guide section with examples
- **fieldForm**: Field configuration form labels
- **generate**: Image generation page content
- **actions**: Common action buttons

**Key Features**:
- Complete Marked Fields usage guide with 4 detailed examples
- Form validation messages
- JSON editor helper text
- Generation status messages
- Server connection status

**Total Keys**: ~100+ translation keys per language

---

### 2. Servers Translations
**Path**: `frontend/src/i18n/locales/{lang}/servers.json`

**Languages**: ko, en, ja, zh-CN, zh-TW

**Content Sections**:
- **page**: Server management page titles
- **card**: Server card display (priority, concurrent jobs, connection status)
- **dialog**: Add/Edit server dialog
- **status**: Connection status messages
- **actions**: Server actions (test, edit, delete)

**Key Features**:
- Server configuration form labels
- Connection test status messages
- Priority and concurrent job settings
- Server management actions

**Total Keys**: ~30+ translation keys per language

---

### 3. Image Generation Translations
**Path**: `frontend/src/i18n/locales/{lang}/imageGeneration.json`

**Languages**: ko, en, ja, zh-CN, zh-TW

**Content Sections**:
- **page**: Main page title and subtitle
- **tabs**: Tab navigation labels

**Key Features**:
- Simple tab navigation
- Main page header content
- ARIA accessibility labels

**Total Keys**: ~5 translation keys per language

---

## Translation Coverage

### Source Files Analyzed
1. ✅ `WorkflowsPage.tsx` - Workflow list page
2. ✅ `WorkflowFormPage.tsx` - Add/Edit workflow form
3. ✅ `WorkflowGeneratePage.tsx` - Image generation page
4. ✅ `MarkedFieldsGuide.tsx` - Marked Fields documentation
5. ✅ `ImageGenerationPage.tsx` - Main image generation page
6. ✅ `ServersTab.tsx` - Server management tab
7. ✅ `WorkflowsTab.tsx` - Workflows management tab

### Korean Text Extracted
All hardcoded Korean strings have been extracted and translated into all 5 languages:

#### Workflows (`workflows.json`)
- "워크플로우 관리" → workflow management title
- "워크플로우 추가" → add workflow button
- "활성/비활성" → active/inactive status
- "Marked Fields 사용 가이드" → complete usage guide
- "생성 설정" → generation settings
- "JSON Path 찾는 방법" → JSON path finding instructions
- Complete field configuration labels
- Validation messages
- Success/error alerts

#### Servers (`servers.json`)
- "ComfyUI 서버 목록" → server list title
- "서버 추가/수정" → add/edit server dialog
- "연결 테스트" → connection test
- "우선순위" → priority settings
- "최대 동시 작업 수" → concurrent jobs
- Connection status messages

#### Image Generation (`imageGeneration.json`)
- "이미지 생성" → main page title
- "워크플로우 관리/서버 관리" → tab labels

---

## Usage Examples

### In React Components

```typescript
import { useTranslation } from 'react-i18next';

function WorkflowsPage() {
  const { t } = useTranslation('workflows');

  return (
    <Typography variant="h4">
      {t('page.title')} {/* "워크플로우 관리" in Korean */}
    </Typography>
  );
}
```

### With Parameters

```typescript
// Card with field count
<Chip label={t('card.fieldsCount', { count: workflow.marked_fields.length })} />
// Output: "5개 필드" in Korean

// Created date
<Typography>
  {t('card.createdDate', { date: new Date(workflow.created_date).toLocaleDateString() })}
</Typography>
// Output: "생성일: 2024-01-15" in Korean
```

### Nested Keys

```typescript
// Marked Fields Guide
<Typography variant="h6">
  {t('markedFields.guideTitle')} {/* "Marked Fields 사용 가이드" */}
</Typography>

<Typography>
  {t('markedFields.whatIs')} {/* "Marked Fields란?" */}
</Typography>

<Typography>
  {t('markedFields.whatIsDesc')} {/* Full description text */}
</Typography>
```

---

## Language-Specific Considerations

### Korean (ko)
- Formal tone used for professional interface
- Complete sentences for descriptions
- Counter words: "개" for items, "초" for seconds

### English (en)
- Clear, concise labels
- Action-oriented button text
- Technical terms kept in English

### Japanese (ja)
- Polite form (です/ます)
- Technical terms in katakana where appropriate
- Counter words: "個" for items, "秒" for seconds

### Simplified Chinese (zh-CN)
- Simplified characters (简体中文)
- Mainland China conventions
- Technical terms in Chinese

### Traditional Chinese (zh-TW)
- Traditional characters (繁體中文)
- Taiwan conventions
- Technical terms in Chinese with Taiwan-specific vocabulary

---

## Integration Checklist

### Required Steps
- [x] Create translation files for all 5 languages
- [ ] Update i18n configuration to load new namespaces
- [ ] Replace hardcoded strings in components
- [ ] Test all languages in UI
- [ ] Verify parameter interpolation
- [ ] Check ARIA labels for accessibility
- [ ] Test form validation messages
- [ ] Verify date/time formatting per locale

### Component Updates Needed

#### WorkflowsPage.tsx
```typescript
// Replace:
<Typography variant="h4">워크플로우 관리</Typography>

// With:
<Typography variant="h4">{t('workflows:page.title')}</Typography>
```

#### WorkflowFormPage.tsx
```typescript
// Replace:
<TextField label="워크플로우 이름" />

// With:
<TextField label={t('workflows:form.workflowName')} />
```

#### ServersTab.tsx
```typescript
// Replace:
<Button>서버 추가</Button>

// With:
<Button>{t('servers:page.addButton')}</Button>
```

---

## File Structure

```
frontend/src/i18n/locales/
├── ko/
│   ├── workflows.json        (100+ keys)
│   ├── servers.json          (30+ keys)
│   └── imageGeneration.json  (5 keys)
├── en/
│   ├── workflows.json
│   ├── servers.json
│   └── imageGeneration.json
├── ja/
│   ├── workflows.json
│   ├── servers.json
│   └── imageGeneration.json
├── zh-CN/
│   ├── workflows.json
│   ├── servers.json
│   └── imageGeneration.json
└── zh-TW/
    ├── workflows.json
    ├── servers.json
    └── imageGeneration.json
```

---

## Key Translation Highlights

### Complex Sections

#### 1. Marked Fields Guide
The most comprehensive section with:
- What are Marked Fields?
- How to find JSON Path (3 steps)
- 4 real-world examples:
  1. Prompt field (CLIPTextEncode)
  2. Seed value (KSampler)
  3. Steps (KSampler with min/max)
  4. Sampler (KSampler with options)
- Tips and best practices

#### 2. Form Validation
- Required field validation
- JSON format validation
- Field type descriptions
- Helper text for complex inputs

#### 3. Generation Status
- Server connection states
- Generation progress
- Success/failure messages
- Execution time display

---

## Testing Recommendations

### 1. Visual Testing
- Check text overflow in all languages
- Verify button sizing with longer text (German typically longest, but Chinese/Japanese can be compact)
- Test dialog layouts with different text lengths

### 2. Functional Testing
- Form validation messages in each language
- Error messages display correctly
- Success notifications show properly
- Confirm dialogs work in all languages

### 3. Accessibility Testing
- ARIA labels are translated
- Screen reader compatibility
- Keyboard navigation with translated UI

### 4. Edge Cases
- Very long workflow names
- Server URLs with special characters
- Empty states in all languages
- Loading states with translated text

---

## Future Enhancements

### Potential Additions
1. Context-specific help tooltips
2. Inline validation error messages
3. Tutorial/onboarding text
4. Keyboard shortcuts documentation
5. Error recovery suggestions
6. Advanced field configuration help

### Language Expansion
- Add French (fr)
- Add German (de)
- Add Spanish (es)
- Add Russian (ru)

---

## Maintenance Notes

### When Adding New Features
1. Add translation keys to all 5 language files simultaneously
2. Use consistent key naming patterns
3. Group related translations logically
4. Provide context in key names (e.g., `form.workflowName` not just `name`)

### Best Practices
- Keep keys hierarchical and organized
- Use parameters for dynamic content
- Avoid hardcoded strings in components
- Maintain consistent terminology across features
- Document special formatting requirements

---

## Related Documentation

- Main i18n setup: `frontend/src/i18n/config.ts`
- Existing translations: `frontend/src/i18n/locales/{lang}/*.json`
- Component usage: See individual component files for implementation

---

**Document Version**: 1.0
**Last Updated**: 2025-10-17
**Total Translation Files Created**: 15 (3 files × 5 languages)
**Total Translation Keys**: ~135 per language
**Languages Supported**: Korean (ko), English (en), Japanese (ja), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW)
