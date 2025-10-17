# Workflows & Image Generation i18n Documentation

Complete internationalization (i18n) documentation for Workflows and Image Generation features.

---

## Quick Links

- 🚀 [**Quick Start Guide**](WORKFLOWS_I18N_QUICKSTART.md) - Start here for developer guide
- 📚 [**Complete Summary**](WORKFLOWS_TRANSLATION_SUMMARY.md) - Comprehensive reference
- ✅ [**Creation Report**](TRANSLATION_FILES_CREATED.md) - Task completion details

---

## What's Included

### Translation Files (15 files)

All files created for 5 languages: Korean (ko), English (en), Japanese (ja), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW)

**File Locations**:
- `frontend/src/i18n/locales/{lang}/workflows.json` - Workflow management translations
- `frontend/src/i18n/locales/{lang}/servers.json` - Server management translations
- `frontend/src/i18n/locales/{lang}/imageGeneration.json` - Main page translations

**Total Translation Keys**: ~135 per language (675 total)

---

## Quick Reference

### Import and Use
```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation('workflows');
  return <Typography>{t('page.title')}</Typography>;
}
```

### Access Patterns
```typescript
t('workflows:page.title')              // Page title
t('workflows:card.fieldsCount', { count: 5 })  // With parameters
t('servers:page.addButton')            // Different namespace
```

---

## Documentation Files

### 1. Quick Start Guide
**File**: [WORKFLOWS_I18N_QUICKSTART.md](WORKFLOWS_I18N_QUICKSTART.md)

**For**: Developers implementing translations

**Contains**:
- Common translation patterns
- Before/after code examples
- Component-specific examples
- Form validation patterns
- Testing instructions
- Migration checklist

**Read this first** if you're updating components to use translations.

---

### 2. Complete Summary
**File**: [WORKFLOWS_TRANSLATION_SUMMARY.md](WORKFLOWS_TRANSLATION_SUMMARY.md)

**For**: Comprehensive reference

**Contains**:
- Complete file structure
- All translation keys documented
- Detailed usage examples
- Language-specific considerations
- Integration checklist
- Testing recommendations
- Maintenance guidelines

**Refer to this** for complete documentation of all translation keys and usage patterns.

---

### 3. Creation Report
**File**: [TRANSLATION_FILES_CREATED.md](TRANSLATION_FILES_CREATED.md)

**For**: Project management and overview

**Contains**:
- Task completion summary
- File verification results
- Statistics and metrics
- Next steps and priorities
- Success metrics
- Maintenance recommendations

**Check this** to understand what was created and project impact.

---

## Translation Coverage

### Source Files Analyzed
1. ✅ WorkflowsPage.tsx - Workflow list
2. ✅ WorkflowFormPage.tsx - Add/Edit form
3. ✅ WorkflowGeneratePage.tsx - Generation page
4. ✅ MarkedFieldsGuide.tsx - Usage guide
5. ✅ ImageGenerationPage.tsx - Main page
6. ✅ ServersTab.tsx - Server management
7. ✅ WorkflowsTab.tsx - Workflows tab

### Translation Files Created
- **workflows.json** (100+ keys) - Workflow management, forms, generation
- **servers.json** (30+ keys) - Server management, connection testing
- **imageGeneration.json** (5 keys) - Main page header and tabs

### Languages Supported
- 🇰🇷 Korean (ko) - Base language
- 🇺🇸 English (en) - Full translation
- 🇯🇵 Japanese (ja) - Full translation
- 🇨🇳 Simplified Chinese (zh-CN) - Full translation
- 🇹🇼 Traditional Chinese (zh-TW) - Full translation

---

## Key Features

### 1. Marked Fields Guide
Complete usage guide with:
- What are Marked Fields?
- JSON Path instructions
- 4 detailed examples with node references
- Tips and best practices

### 2. Form Management
- Input labels and placeholders
- Validation messages
- Helper text
- Field type descriptions

### 3. Server Management
- Connection testing
- Status indicators
- Configuration forms
- Priority settings

### 4. Generation Workflow
- Settings forms
- Progress tracking
- Status messages
- Execution metrics

---

## Getting Started

### For Developers Implementing Translations

1. **Read**: [Quick Start Guide](WORKFLOWS_I18N_QUICKSTART.md)
2. **Update Components**: Replace hardcoded strings with `t()` calls
3. **Test**: Verify all languages work correctly
4. **Reference**: Check [Complete Summary](WORKFLOWS_TRANSLATION_SUMMARY.md) for specific keys

### For Project Managers

1. **Review**: [Creation Report](TRANSLATION_FILES_CREATED.md)
2. **Plan**: Follow next steps and priorities
3. **Track**: Use checklist for integration progress
4. **Verify**: Check success metrics and testing results

### For Translators/Reviewers

1. **Files**: `frontend/src/i18n/locales/{lang}/*.json`
2. **Context**: Review components in `frontend/src/pages/`
3. **Reference**: English (en) translations for meaning
4. **Verify**: Technical terms and consistency

---

## Integration Checklist

### Configuration
- [ ] Update i18n config to load new namespaces
- [ ] Verify language switching works
- [ ] Test namespace loading

### Component Updates
- [ ] WorkflowFormPage.tsx (40+ replacements)
- [ ] WorkflowGeneratePage.tsx (30+ replacements)
- [ ] MarkedFieldsGuide.tsx (35+ replacements)
- [ ] ServersTab.tsx (25+ replacements)
- [ ] WorkflowsPage.tsx (15 replacements)
- [ ] WorkflowsTab.tsx (15 replacements)
- [ ] ImageGenerationPage.tsx (5 replacements)

### Testing
- [ ] Test Korean (base language)
- [ ] Test English
- [ ] Test Japanese
- [ ] Test Simplified Chinese
- [ ] Test Traditional Chinese
- [ ] Verify parameter interpolation
- [ ] Test form validation messages
- [ ] Check empty states
- [ ] Test ARIA labels

### Quality Assurance
- [ ] Native speaker review (recommended)
- [ ] Context verification
- [ ] Consistency check
- [ ] Technical accuracy
- [ ] Professional tone

---

## File Structure

```
frontend/src/i18n/locales/
├── ko/
│   ├── workflows.json          # 100+ keys
│   ├── servers.json            # 30+ keys
│   └── imageGeneration.json    # 5 keys
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

docs/i18n/
├── README.md (this file)
├── WORKFLOWS_I18N_QUICKSTART.md
├── WORKFLOWS_TRANSLATION_SUMMARY.md
└── TRANSLATION_FILES_CREATED.md
```

---

## Common Patterns

### Simple Text
```typescript
{t('workflows:page.title')}
```

### With Parameters
```typescript
{t('workflows:card.fieldsCount', { count: 5 })}
```

### Multiple Namespaces
```typescript
const { t } = useTranslation(['workflows', 'servers', 'common']);
```

### Conditional Text
```typescript
{workflow.is_active ? t('workflows:card.active') : t('workflows:card.inactive')}
```

---

## Examples

### Workflow List Page
```typescript
<Typography variant="h4">
  {t('workflows:page.title')}
</Typography>
<Button startIcon={<AddIcon />}>
  {t('workflows:page.addButton')}
</Button>
```

### Server Management
```typescript
<Typography variant="h6">
  {t('servers:page.listTitle')}
</Typography>
<Chip label={t('servers:card.priority', { priority: server.priority })} />
```

### Generation Page
```typescript
<Typography>
  {t('workflows:generate.settingsTitle')}
</Typography>
<Alert severity="success">
  {t('workflows:generate.generationComplete')}
</Alert>
```

---

## Resources

### Internal Documentation
- [Quick Start Guide](WORKFLOWS_I18N_QUICKSTART.md) - Developer implementation guide
- [Complete Summary](WORKFLOWS_TRANSLATION_SUMMARY.md) - Full reference documentation
- [Creation Report](TRANSLATION_FILES_CREATED.md) - Task completion details

### Translation Files
- Korean: `frontend/src/i18n/locales/ko/`
- English: `frontend/src/i18n/locales/en/`
- Japanese: `frontend/src/i18n/locales/ja/`
- Chinese (Simplified): `frontend/src/i18n/locales/zh-CN/`
- Chinese (Traditional): `frontend/src/i18n/locales/zh-TW/`

### External Resources
- [react-i18next Documentation](https://react.i18next.com/)
- [i18next Documentation](https://www.i18next.com/)

---

## Support

### Need Help?
1. Check the [Quick Start Guide](WORKFLOWS_I18N_QUICKSTART.md) for common patterns
2. Review the [Complete Summary](WORKFLOWS_TRANSLATION_SUMMARY.md) for specific keys
3. Look at existing translations in `frontend/src/i18n/locales/`
4. Check component examples in the documentation

### Found an Issue?
1. Verify translation key exists in all language files
2. Check parameter interpolation syntax
3. Confirm namespace is loaded in component
4. Test in development environment

---

## Statistics

- **Total Files Created**: 18 (15 translation + 3 documentation)
- **Translation Keys**: ~675 across all languages (~135 per language)
- **Languages Supported**: 5 (ko, en, ja, zh-CN, zh-TW)
- **Source Files Analyzed**: 7 TypeScript components
- **Components to Update**: 7 components (~165 replacements)

---

## Status

✅ **All translation files created and verified**
✅ **Documentation complete**
✅ **Ready for integration**

**Next Step**: Begin component migration following [Quick Start Guide](WORKFLOWS_I18N_QUICKSTART.md)

---

**Last Updated**: 2025-10-17
**Version**: 1.0
