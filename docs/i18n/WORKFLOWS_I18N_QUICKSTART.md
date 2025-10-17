# Workflows & Image Generation i18n Quick Start Guide

## Quick Reference

### Import Translation Hook

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation(['workflows', 'servers', 'imageGeneration']);

  // Use translations
  return <Typography>{t('workflows:page.title')}</Typography>;
}
```

---

## Common Patterns

### 1. Simple Text Replacement

**Before:**
```typescript
<Typography variant="h4">워크플로우 관리</Typography>
```

**After:**
```typescript
<Typography variant="h4">{t('workflows:page.title')}</Typography>
```

---

### 2. Button Labels

**Before:**
```typescript
<Button startIcon={<AddIcon />}>
  워크플로우 추가
</Button>
```

**After:**
```typescript
<Button startIcon={<AddIcon />}>
  {t('workflows:page.addButton')}
</Button>
```

---

### 3. Status Chips

**Before:**
```typescript
<Chip
  label={workflow.is_active ? '활성' : '비활성'}
  color={workflow.is_active ? 'success' : 'default'}
/>
```

**After:**
```typescript
<Chip
  label={workflow.is_active ? t('workflows:card.active') : t('workflows:card.inactive')}
  color={workflow.is_active ? 'success' : 'default'}
/>
```

---

### 4. Text with Parameters

**Before:**
```typescript
<Chip label={`${workflow.marked_fields.length}개 필드`} />
```

**After:**
```typescript
<Chip label={t('workflows:card.fieldsCount', { count: workflow.marked_fields.length })} />
```

---

### 5. Date Formatting

**Before:**
```typescript
<Typography>
  생성일: {new Date(workflow.created_date).toLocaleDateString()}
</Typography>
```

**After:**
```typescript
<Typography>
  {t('workflows:card.createdDate', {
    date: new Date(workflow.created_date).toLocaleDateString()
  })}
</Typography>
```

---

### 6. Form Labels

**Before:**
```typescript
<TextField
  label="워크플로우 이름"
  helperText="고유 식별자"
  placeholder="prompt_positive"
/>
```

**After:**
```typescript
<TextField
  label={t('workflows:form.workflowName')}
  helperText={t('workflows:fieldForm.fieldIdHelper')}
  placeholder={t('workflows:fieldForm.fieldIdPlaceholder')}
/>
```

---

### 7. Alert Messages

**Before:**
```typescript
<Alert severity="success">
  워크플로우가 생성되었습니다
</Alert>
```

**After:**
```typescript
<Alert severity="success">
  {t('workflows:alerts.created')}
</Alert>
```

---

### 8. Confirm Dialogs

**Before:**
```typescript
if (confirm('정말 이 워크플로우를 삭제하시겠습니까?')) {
  await deleteWorkflow(id);
}
```

**After:**
```typescript
if (confirm(t('workflows:actions.confirmDelete'))) {
  await deleteWorkflow(id);
}
```

---

### 9. Empty States

**Before:**
```typescript
{workflows.length === 0 && (
  <Box sx={{ textAlign: 'center', py: 8 }}>
    <Typography variant="h6">
      등록된 워크플로우가 없습니다
    </Typography>
    <Typography variant="body2">
      "워크플로우 추가" 버튼을 클릭하여 ComfyUI 워크플로우를 추가하세요
    </Typography>
  </Box>
)}
```

**After:**
```typescript
{workflows.length === 0 && (
  <Box sx={{ textAlign: 'center', py: 8 }}>
    <Typography variant="h6">
      {t('workflows:page.noWorkflows')}
    </Typography>
    <Typography variant="body2">
      {t('workflows:page.noWorkflowsDesc')}
    </Typography>
  </Box>
)}
```

---

### 10. Select Options

**Before:**
```typescript
<TextField select>
  <option value="">선택하세요</option>
  <option value="text">텍스트 (한 줄)</option>
  <option value="textarea">긴 텍스트 (여러 줄)</option>
  <option value="number">숫자</option>
  <option value="select">선택 (드롭다운)</option>
</TextField>
```

**After:**
```typescript
<TextField select>
  <option value="">{t('workflows:generate.selectPlaceholder')}</option>
  <option value="text">{t('workflows:fieldForm.typeText')}</option>
  <option value="textarea">{t('workflows:fieldForm.typeTextarea')}</option>
  <option value="number">{t('workflows:fieldForm.typeNumber')}</option>
  <option value="select">{t('workflows:fieldForm.typeSelect')}</option>
</TextField>
```

---

## Translation File Structure

### workflows.json
```json
{
  "page": {
    "title": "워크플로우 관리",
    "addButton": "워크플로우 추가"
  },
  "card": {
    "active": "활성",
    "fieldsCount": "{{count}}개 필드"
  },
  "form": {
    "workflowName": "워크플로우 이름"
  }
}
```

### Access Pattern
```typescript
t('workflows:page.title')          // "워크플로우 관리"
t('workflows:card.active')         // "활성"
t('workflows:card.fieldsCount', { count: 5 })  // "5개 필드"
```

---

## Multiple Namespaces

### Load Multiple Translation Files
```typescript
const { t } = useTranslation(['workflows', 'servers', 'common']);

// Access different namespaces
{t('workflows:page.title')}        // Workflows
{t('servers:page.title')}          // Servers
{t('common:buttons.save')}         // Common
```

---

## Component-Specific Examples

### WorkflowsPage.tsx
```typescript
import { useTranslation } from 'react-i18next';

export default function WorkflowsPage() {
  const { t } = useTranslation('workflows');

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4">
        {t('page.title')}
      </Typography>
      <Button startIcon={<AddIcon />}>
        {t('page.addButton')}
      </Button>

      {workflows.map(workflow => (
        <Chip label={
          workflow.is_active ? t('card.active') : t('card.inactive')
        } />
      ))}
    </Box>
  );
}
```

### ServersTab.tsx
```typescript
import { useTranslation } from 'react-i18next';

export default function ServersTab() {
  const { t } = useTranslation('servers');

  return (
    <Box>
      <Typography variant="h6">
        {t('page.listTitle')}
      </Typography>
      <Button onClick={() => handleOpenDialog()}>
        {t('page.addButton')}
      </Button>

      <Button onClick={() => handleTestConnection(server.id)}>
        {testingServerId === server.id ? (
          <CircularProgress size={16} />
        ) : (
          t('card.testConnection')
        )}
      </Button>
    </Box>
  );
}
```

### WorkflowGeneratePage.tsx
```typescript
import { useTranslation } from 'react-i18next';

export default function WorkflowGeneratePage() {
  const { t } = useTranslation(['workflows', 'servers']);

  const missingFields = workflow.marked_fields.filter(f => f.required && !formData[f.id]);

  if (missingFields.length > 0) {
    setError(t('workflows:generate.missingFields', {
      fields: missingFields.map(f => f.label).join(', ')
    }));
  }

  return (
    <Box>
      <Typography variant="h6">
        {t('workflows:generate.settingsTitle')}
      </Typography>

      <Button onClick={handleGenerateOnAllServers}>
        {t('workflows:generate.generateAll', {
          count: servers.filter(s => serverStatus[s.id]?.connected).length
        })}
      </Button>

      {genStatus?.status === 'completed' && (
        <Alert severity="success">
          {t('workflows:generate.generationComplete')}
        </Alert>
      )}
    </Box>
  );
}
```

---

## Validation Messages

### Form Validation
```typescript
// Name required
if (!name.trim()) {
  setError(t('workflows:form.nameRequired'));
  return;
}

// JSON required
if (!workflowJson.trim()) {
  setError(t('workflows:form.jsonRequired'));
  return;
}

// JSON format error
if (jsonError) {
  setError(t('workflows:form.validateJson'));
  return;
}
```

---

## Dynamic Content Examples

### Server Response Time
```typescript
{status?.responseTime && (
  <Typography variant="caption">
    {t('workflows:generate.responseTime', { time: status.responseTime })}
  </Typography>
)}
```

### Execution Time
```typescript
{genStatus.executionTime && (
  <Typography variant="caption">
    {t('workflows:generate.executionTime', { time: genStatus.executionTime })}
  </Typography>
)}
```

### Missing Fields List
```typescript
const missingFieldNames = missingFields.map(f => f.label).join(', ');
setError(t('workflows:generate.missingFields', { fields: missingFieldNames }));
```

---

## Testing Translations

### Switch Language in Browser
```typescript
import { useTranslation } from 'react-i18next';

function LanguageSwitcher() {
  const { i18n } = useTranslation();

  return (
    <Select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>
      <MenuItem value="ko">한국어</MenuItem>
      <MenuItem value="en">English</MenuItem>
      <MenuItem value="ja">日本語</MenuItem>
      <MenuItem value="zh-CN">简体中文</MenuItem>
      <MenuItem value="zh-TW">繁體中文</MenuItem>
    </Select>
  );
}
```

---

## Common Mistakes to Avoid

### ❌ Don't do this:
```typescript
// Hardcoded Korean text
<Typography>워크플로우 관리</Typography>

// String concatenation
<Chip label={count + "개 필드"} />

// Missing namespace
{t('page.title')} // Will look in default namespace

// Forgetting parameters
{t('card.fieldsCount')} // Missing {{count}} parameter
```

### ✅ Do this:
```typescript
// Use translation hook
<Typography>{t('workflows:page.title')}</Typography>

// Use parameter interpolation
<Chip label={t('workflows:card.fieldsCount', { count })} />

// Include namespace
{t('workflows:page.title')}

// Provide all parameters
{t('workflows:card.fieldsCount', { count: workflow.marked_fields.length })}
```

---

## Migration Checklist

- [ ] Import `useTranslation` hook
- [ ] Load required namespaces: `workflows`, `servers`, `imageGeneration`
- [ ] Replace all hardcoded Korean strings
- [ ] Test parameter interpolation
- [ ] Verify date/time formatting
- [ ] Check form validation messages
- [ ] Test empty states
- [ ] Verify button labels
- [ ] Test all languages in UI
- [ ] Check text overflow/truncation

---

## Resources

- Translation files: `frontend/src/i18n/locales/{lang}/`
- i18n config: `frontend/src/i18n/config.ts`
- react-i18next docs: https://react.i18next.com/
- Complete summary: `docs/i18n/WORKFLOWS_TRANSLATION_SUMMARY.md`

---

**Quick Tips:**
1. Always use namespace prefix: `workflows:`, `servers:`, `imageGeneration:`
2. Group related translations hierarchically
3. Use parameters `{{variable}}` for dynamic content
4. Test all languages before committing
5. Keep translations in sync across all 5 language files
