import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'src');
const generalTab = readFileSync(resolve(root, 'features/settings/components/general-tab.tsx'), 'utf8');
const apiSettings = readFileSync(resolve(root, 'lib/api-settings.ts'), 'utf8');

for (const text of ['데이터 재매칭', '썸네일 재생성', '메타데이터 재추출', '해시 재생성']) {
  assert.ok(generalTab.includes(text), `missing UI text: ${text}`);
}

assert.ok(generalTab.includes("updateDataRematchOption('hash'"), 'hash option handler is wired');
assert.ok(generalTab.includes('thumbnail: false, metadata: false, hash: true'), 'hash option must be exclusive');
assert.ok(generalTab.includes('disabled={isDataRematchBusy || dataRematchOptions.hash}'), 'thumbnail/metadata controls must wait while hash mode is selected');
assert.ok(generalTab.includes('confirmHashRegeneration'), 'hash confirmation must be sent to backend');
assert.ok(generalTab.includes('자동 태그/작가 추출은 여기서 실행하지 않음'), 'hash warning must state no auto tag/artist extraction');
assert.ok(generalTab.includes('이미지/GIF만 처리하고 비디오는 제외'), 'hash warning must state image/GIF-only scope');
assert.ok(generalTab.includes('maintenanceLock'), 'maintenance lock status must be surfaced in UI');

assert.ok(apiSettings.includes("'/api/settings/data-rematch/status'"), 'status endpoint missing');
assert.ok(apiSettings.includes("'/api/settings/data-rematch/jobs'"), 'start endpoint missing');
assert.ok(apiSettings.includes('DataRematchJobSnapshot'), 'data rematch status type missing');

console.log('✅ Data rematch UI contracts verified');
