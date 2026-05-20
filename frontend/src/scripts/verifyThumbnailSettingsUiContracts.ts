import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'src');
const apiSettings = readFileSync(resolve(root, 'lib/api-settings.ts'), 'utf8');
const settingsPage = readFileSync(resolve(root, 'features/settings/settings-page.tsx'), 'utf8');
const imageSaveTab = readFileSync(resolve(root, 'features/settings/components/image-save-tab.tsx'), 'utf8');

assert.ok(apiSettings.includes('ThumbnailSettings'), 'ThumbnailSettings type must be imported in api-settings');
assert.ok(apiSettings.includes('updateThumbnailSettings'), 'updateThumbnailSettings helper missing');
assert.ok(apiSettings.includes("'/api/settings/thumbnail'"), 'thumbnail settings endpoint missing');
assert.ok(apiSettings.includes("settings.thumbnail.update"), 'thumbnail settings fallback key missing');

assert.ok(settingsPage.includes('updateThumbnailSettings'), 'settings page must import updateThumbnailSettings');
assert.ok(settingsPage.includes('ThumbnailSettings'), 'settings page must import ThumbnailSettings');
assert.ok(settingsPage.includes('thumbnailDraft'), 'settings page must keep thumbnailDraft state');
assert.ok(settingsPage.includes('effectiveThumbnailDraft'), 'settings page must derive effectiveThumbnailDraft from app settings');
assert.ok(settingsPage.includes('thumbnailMutation'), 'settings page must create thumbnail mutation');
assert.ok(settingsPage.includes('setThumbnailDraft(settings.thumbnail)'), 'thumbnail mutation must sync thumbnail draft from saved settings');
assert.ok(settingsPage.includes('patchThumbnailDraft'), 'settings page must expose thumbnail draft patcher');
for (const prop of ['thumbnailDraft={effectiveThumbnailDraft}', 'onPatchThumbnail={patchThumbnailDraft}', 'onSaveThumbnail=', 'isSavingThumbnail={thumbnailMutation.isPending}']) {
  assert.ok(settingsPage.includes(prop), `ImageSaveTab missing prop: ${prop}`);
}

assert.ok(imageSaveTab.includes('ThumbnailSettings'), 'ImageSaveTab props must include ThumbnailSettings');
for (const prop of ['thumbnailDraft', 'onPatchThumbnail', 'onSaveThumbnail', 'isSavingThumbnail']) {
  assert.ok(imageSaveTab.includes(prop), `ImageSaveTab thumbnail prop missing: ${prop}`);
}
for (const text of ['썸네일', 'Thumbnail', '썸네일 크기', 'Thumbnail size', '썸네일 품질', 'Thumbnail quality']) {
  assert.ok(imageSaveTab.includes(text), `missing thumbnail UI text: ${text}`);
}
for (const option of ['original', '2048', '1080', '720', '512']) {
  assert.ok(imageSaveTab.includes(`value="${option}"`), `thumbnail size option missing: ${option}`);
}
assert.match(imageSaveTab, /min=\{60\}[\s\S]*max=\{100\}[\s\S]*value=\{thumbnailDraft\.quality\}/, 'thumbnail quality input must use backend 60-100 range');
assert.ok(imageSaveTab.includes('기존 썸네일은 재생성'), 'UI must warn that existing thumbnails need regeneration');

console.log('✅ Thumbnail settings UI contracts verified');
