import { z } from 'zod'
import { skillSectionGroup, skillSectionPathKey, type PluginGenerationPreset, type PluginGuideSkill, type PluginSkillSection } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { isRequesterAdmin } from '../../middleware/featureAccess'
import { ChatGenerationPresetStore, guideSkillLink, type ChatGenerationPreset } from '../codex-chat/chatGenerationPresets'
import { ChatSkillStore, skillGuide, type ChatSkillSummary } from '../codex-chat/chatSkills'
import { PluginError } from './pluginStore'

/**
 * Read-only chat setup for server modules: generation presets and the skills a preset guide can link for
 * administrators (the /admin rule), and the current text of a guide skill section for any account, since every
 * user's assistant reads the guide a plugin page links when it generates.
 */
function pluginPreset({ id, name, instruction, kind, nai, comfyui, prompting }: ChatGenerationPreset): PluginGenerationPreset {
  return { id, name, instruction, kind, nai, comfyui: comfyui && { ...comfyui, promptField: comfyui.promptField ?? null }, prompting }
}

/** What the preset editor's guide picker offers of a skill: each section, and each group as `group/` titled as `skillGuide` titles it. */
function pluginGuideSkill({ id, name, enabled, sections }: ChatSkillSummary): PluginGuideSkill {
  const groups = new Map<string, { path: string; count: number }>()
  for (const { path } of sections) {
    const group = skillSectionGroup(path)
    if (group === null) continue
    const entry = groups.get(skillSectionPathKey(group))
    if (entry) entry.count += 1
    else groups.set(skillSectionPathKey(group), { path: `${group}/`, count: 1 })
  }
  return {
    skillId: id, name, enabled,
    sections: sections.map(({ path, title }) => ({ path, title })),
    groups: [...groups.values()].map(({ path, count }) => ({ path, title: `${path} (${count})`, count })),
  }
}

export function callPluginServerChat(requester: McpRequester | undefined, method: string, raw: unknown): PluginGenerationPreset[] | PluginGenerationPreset | PluginGuideSkill[] | PluginSkillSection {
  if (!requester) throw new PluginError('이 호출에는 계정이 필요해.', 403)
  if (method === 'skills.section') {
    const link = guideSkillLink(raw)
    if (!link) throw new PluginError('스킬 섹션은 { skillId, path }로 골라줘(path: 섹션 또는 "그룹/").')
    const { skillName, title, updatedDate, text } = skillGuide(link.skillId, link.path)
    if (skillName === null || title === null || updatedDate === null) {
      throw new PluginError(skillName === null ? `스킬 #${link.skillId}을 찾을 수 없어.` : `스킬 "${skillName}"에 섹션 "${link.path}"이 없어.`, 404)
    }
    if (text === null) throw new PluginError(`스킬 "${skillName}"이 꺼져 있어(플러그인이 꺼짐) 섹션을 읽을 수 없어.`, 409)
    return { ...link, skillName, title, updatedDate, text }
  }
  if (method !== 'generationPresets.list' && method !== 'generationPresets.get' && method !== 'skills.list') throw new PluginError('알 수 없는 요청이야.')
  if (!isRequesterAdmin(requester)) throw new PluginError(method === 'skills.list' ? '관리자만 스킬 목록을 볼 수 있어.' : '관리자만 생성 프리셋을 볼 수 있어.', 403)
  if (method === 'skills.list') return ChatSkillStore.list().map(pluginGuideSkill)
  if (method === 'generationPresets.list') return ChatGenerationPresetStore.list().map(pluginPreset)
  const { id } = z.object({ id: z.number().int().positive() }).strict().parse(raw)
  const preset = ChatGenerationPresetStore.find(id)
  if (!preset) throw new PluginError('생성 프리셋을 찾을 수 없어.', 404)
  return pluginPreset(preset)
}
