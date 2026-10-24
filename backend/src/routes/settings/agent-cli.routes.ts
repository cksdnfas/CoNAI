import { Router } from 'express'
import { asyncHandler } from '../../middleware/asyncHandler'
import { requireAdmin } from '../../middleware/authMiddleware'
import { getCodexAvailabilityStatus } from '../../services/codexGenerationExecutor'
import { getCodexCliVersionInfo, updateCodexCli } from '../../services/codexCliMaintenance'
import { cancelCodexDeviceLogin, getCodexDeviceLoginState, startCodexDeviceLogin } from '../../services/codexDeviceLogin'
import { cancelClaudeLogin, getClaudeLogin, getClaudeModels, getClaudeStatus, getClaudeVersion, startClaudeLogin, submitClaudeLoginCode, updateClaudeCli } from '../../services/claudeCli'
import { getAgentCliUsage } from '../../services/agentCliUsage'
import { getPiStatus, getPiVersion, updatePi } from '../../services/piRuntime'
import { sendRouteBadRequest } from '../routeValidation'

export const agentCliRoutes = Router()
// pi is the in-process agent SDK of pi chats: status, version and update only (no sign-in or usage). Other pi paths
// fall through to the check below and are refused.
agentCliRoutes.use('/agent-cli/pi', requireAdmin, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
agentCliRoutes.get('/agent-cli/pi/status', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getPiStatus(req.query.check === 'true') })
}))
agentCliRoutes.get('/agent-cli/pi/version', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getPiVersion(req.query.refresh === 'true') })
}))
agentCliRoutes.post('/agent-cli/pi/update', asyncHandler(async (_req, res) => {
  try { res.json({ success: true, data: await updatePi() }) }
  catch (error) { sendRouteBadRequest(res, error instanceof Error ? error.message : 'pi update failed') }
}))
agentCliRoutes.use('/agent-cli/:agent', requireAdmin, (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.params.agent !== 'codex' && req.params.agent !== 'claude') { sendRouteBadRequest(res, 'Unknown agent CLI'); return }
  next()
})
agentCliRoutes.get('/agent-cli/:agent/status', asyncHandler(async (req, res) => {
  const data = req.params.agent === 'claude' ? await getClaudeStatus() : await getCodexAvailabilityStatus().then((status) => ({ installed: status.installed, authenticated: status.authenticated, available: status.available, authMethod: null, message: status.available ? null : 'Codex 설치 또는 로그인 상태를 확인해줘.' }))
  res.json({ success: true, data })
}))
agentCliRoutes.get('/agent-cli/:agent/usage', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getAgentCliUsage(req.params.agent as 'codex' | 'claude', req.query.refresh === 'true') })
}))
// Unlike passive GET polling, this explicit admin action may send a short Claude request to renew OAuth.
agentCliRoutes.post('/agent-cli/:agent/usage/refresh', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getAgentCliUsage(req.params.agent as 'codex' | 'claude', true, true) })
}))
agentCliRoutes.get('/agent-cli/:agent/version', asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.params.agent === 'claude' ? await getClaudeVersion(req.query.refresh === 'true') : await getCodexCliVersionInfo({ refreshLatest: req.query.refresh === 'true' }) })
}))
agentCliRoutes.post('/agent-cli/:agent/update', asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: req.params.agent === 'claude' ? await updateClaudeCli() : await updateCodexCli() }) }
  catch (error) { sendRouteBadRequest(res, error instanceof Error ? error.message : 'CLI update failed') }
}))
agentCliRoutes.get('/agent-cli/claude/models', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getClaudeModels() })
}))
agentCliRoutes.get('/agent-cli/:agent/login', (req, res) => {
  res.json({ success: true, data: req.params.agent === 'claude' ? getClaudeLogin() : getCodexDeviceLoginState() })
})
agentCliRoutes.post('/agent-cli/:agent/login', asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: req.params.agent === 'claude' ? await startClaudeLogin() : await startCodexDeviceLogin() }) }
  catch (error) { sendRouteBadRequest(res, error instanceof Error ? error.message : 'CLI sign-in failed') }
}))
agentCliRoutes.post('/agent-cli/claude/login/code', (req, res) => {
  try { res.json({ success: true, data: submitClaudeLoginCode(req.body?.code) }) }
  catch (error) { sendRouteBadRequest(res, error instanceof Error ? error.message : 'Invalid login code') }
})
agentCliRoutes.delete('/agent-cli/:agent/login', (req, res) => {
  res.json({ success: true, data: req.params.agent === 'claude' ? cancelClaudeLogin() : cancelCodexDeviceLogin() })
})
