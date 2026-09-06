import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { normalizeMaterialFormat, parseMaterialContent, profileGaps, validateDraftUpdate, validRatios, validateMaterialInput, validateSourceRefs } from './validation.mjs'
import { createRedFoxAdapter, demoHotSearch, demoProhibitedCheck, demoSearchWork, demoSimilarAccounts, demoTrending, prohibitedWordlist } from './redfox.mjs'
import { buildChecklist, deterministicAdaptation, fitScore, retrospectDeterministic } from './growth.mjs'
import { createMysqlPool, loadCollections, loadMysqlState, loadUserDocs, saveCollections, saveMysqlState, saveUserDocs, collectionNames, userDocNames } from './mysql.mjs'
import { emptyPublicApiConfigs, emptyPublicRedfoxConfig, parseApiConfigKey, publicApiConfig, publicRedfoxConfig, runtimeApiConfig, runtimeRedfoxConfig, updateApiConfig, updateRedfoxConfig } from './api-settings.mjs'
import { publicPrivateFile, readPrivateFile, storePrivateFile, validatePrivateFile } from './private-files.mjs'
import { callLlmWithFallback, callVision, testApiCapability } from './llm.mjs'
import { buildContentContext } from './content-context.mjs'
import { defaultTopicFields, evaluateTopic } from './topic-evaluation.mjs'
import { defaultDraftWorkflowFields, generateHookCandidates, selectHook, validateHookText } from './draft-workflow.mjs'
import { checkPersona, checkQuality, checkPublishChecklist } from './draft-checks.mjs'
import { approveDraftRecord, defaultApproval, revokeDraftRecord, validateApprovalReadiness } from './draft-approval.mjs'

const port = Number(process.env.PORT || 3001)
const sessions = new Map()
const developmentMode = process.env.NODE_ENV !== 'production'
const allowedOrigin = process.env.APP_ORIGIN || 'http://localhost:5173'
const allowedOrigins = new Set([allowedOrigin])
if (developmentMode) {
  try {
    const localOrigin = new URL(allowedOrigin)
    if (localOrigin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(localOrigin.hostname)) {
      for (const hostname of ['localhost', '127.0.0.1']) allowedOrigins.add(`http://${hostname}:${localOrigin.port}`)
    }
  } catch {
    /* APP_ORIGIN is validated by the origin comparison below. */
  }
}
const responseCorsOrigin = Symbol('responseCorsOrigin')
const dataFile = process.env.DATA_FILE || fileURLToPath(new URL('./data.json', import.meta.url))
const privateFileRoot = process.env.PRIVATE_FILE_ROOT || fileURLToPath(new URL('./private-files/', import.meta.url))
const privateFileMaxBytes = Number(process.env.PRIVATE_FILE_MAX_BYTES || 25 * 1024 * 1024)
const apiConfigMasterKey = parseApiConfigKey(process.env.API_CONFIG_ENCRYPTION_KEY || '00'.repeat(32))
const mysqlEnabled = Boolean(process.env.PROJECT_DB_HOST && process.env.PROJECT_DB_NAME && process.env.PROJECT_DB_USER && process.env.PROJECT_DB_PASSWORD)
const mysqlPool = mysqlEnabled ? createMysqlPool() : null
const rateLimitWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000)
const rateLimitMax = Number(process.env.API_RATE_LIMIT_MAX || 120)
const rateLimitBuckets = new Map()
const defaultState = {
  positioning: {
    status: 'draft',
    monetization_goals: [],
    acquisition_goals: [],
    other_goals: [],
    interview_answers: {},
    updated_at: new Date().toISOString(),
  },
  strategy: {
    stage: 'cold_start',
    layer_ratios: { reach: 50, trust: 30, conversion: 20 },
    publishing_rhythm: '每周 4-6 条',
    review_period: 'P14D',
    platform_preferences: ['小红书', '抖音', '视频号', '公众号'],
    version: 1,
    history: [],
  },
  profile: {
    role: '', audiences: [], problems: [], pillars: [], viewpoints: [], tone_preferences: [], prohibited_patterns: [], source_refs: [], version: 1,
  },
  profile_reviews: [],
  users: [],
  usage_daily: [],
  materials: [],
  research: [],
  structures: [],
  topics: [],
  drafts: [],
  shooting: [],
  sync_jobs: [],
  sync_directories: [], devices: [], private_files: [], api_configs: [], vision_tasks: [], performance_snapshots: [],
  conflicts: [],
}
const shootingStatuses = new Set(['ready_to_shoot', 'in_progress', 'completed', 'needs_revision', 'published'])
const draftStatuses = new Set(['draft', 'ready_to_shoot', 'published'])
const fileState = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : {}
let persistedState = fileState
if (mysqlPool) {
  await loadMysqlState(mysqlPool, fileState)
  const collectionState = await loadCollections(mysqlPool)
  const userDocStores = await loadUserDocs(mysqlPool)
  const hasRows = Object.values(collectionState).some(items => items.length) || Object.values(userDocStores).some(store => Object.keys(store).length)
  persistedState = hasRows ? { ...fileState, ...collectionState, ...Object.fromEntries(Object.entries(userDocStores).map(([key, store]) => [`${key}_by_user`, store])) } : await loadMysqlState(mysqlPool, fileState)
  if (!hasRows) {
    await saveCollections(mysqlPool, persistedState, collectionNames)
    await saveUserDocs(mysqlPool, {
      positioning_by_user: persistedState.positioning_by_user || {},
      strategy_by_user: persistedState.strategy_by_user || {},
      profile_by_user: persistedState.profile_by_user || {},
    }, userDocNames)
  }
}
const state = {
  ...defaultState,
  ...persistedState,
  positioning: { ...defaultState.positioning, ...(persistedState.positioning || {}) },
  strategy: { ...defaultState.strategy, ...(persistedState.strategy || {}), history: persistedState.strategy?.history || [] },
  profile: { ...defaultState.profile, ...(persistedState.profile || {}) },
  materials: persistedState.materials || [],
  research: persistedState.research || [],
  structures: persistedState.structures || [],
  topics: persistedState.topics || [],
  drafts: persistedState.drafts || [],
  shooting: persistedState.shooting || [],
  sync_jobs: persistedState.sync_jobs || [],
  profile_reviews: persistedState.profile_reviews || [],
  conflicts: persistedState.conflicts || [],
  memories: persistedState.memories || [],
  users: persistedState.users || [],
  usage_daily: persistedState.usage_daily || [],
  sync_directories: persistedState.sync_directories || [], devices: persistedState.devices || [], private_files: persistedState.private_files || [], api_configs: persistedState.api_configs || [], vision_tasks: persistedState.vision_tasks || [], performance_snapshots: persistedState.performance_snapshots || [],
}
for (const collection of ['users', 'materials', 'research', 'structures', 'topics', 'drafts', 'shooting', 'sync_jobs', 'sync_directories', 'devices', 'private_files', 'api_configs', 'vision_tasks', 'performance_snapshots']) {
  state[collection] = state[collection].map(item => ({ ...item, owner_id: collection === 'users' ? (item.id || item.owner_id || 'system') : (item.owner_id || 'demo-user'), ...(collection === 'topics' ? defaultTopicFields(item) : {}), ...(collection === 'drafts' ? defaultDraftWorkflowFields(item) : {}), ...(collection === 'shooting' && item.status === 'todo' ? { status: 'ready_to_shoot' } : {}) }))
}
for (const collection of ['positioning', 'strategy', 'profile']) {
  const storeKey = `${collection}_by_user`
  state[storeKey] = persistedState[storeKey] || { 'demo-user': structuredClone(state[collection]) }
}

async function saveState(...collections) {
  if (mysqlPool) {
    if (collections.length) {
      const collectionUpdates = collections.filter(name => collectionNames.includes(name))
      const userDocUpdates = collections.filter(name => userDocNames.includes(name))
      if (collectionUpdates.length) await saveCollections(mysqlPool, state, collectionUpdates)
      if (userDocUpdates.length) await saveUserDocs(mysqlPool, state, userDocUpdates)
      return
    }
    await saveCollections(mysqlPool, state, collectionNames)
    await saveUserDocs(mysqlPool, state, userDocNames)
    return
  }
  writeFileSync(dataFile, `${JSON.stringify(state, null, 2)}\n`)
}

function send(response, status, payload, extraHeaders = {}) {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('cross-origin-resource-policy', 'same-origin')
  response.setHeader('cross-origin-opener-policy', 'same-origin')
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': response[responseCorsOrigin] || allowedOrigin, 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, x-user-id', 'access-control-allow-credentials': 'true', 'vary': 'Origin', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', ...extraHeaders })
  response.end(status === 204 ? undefined : JSON.stringify(payload))
}

function isRateLimited(request) {
  const now = Date.now()
  const clientKey = request.socket.remoteAddress || 'unknown'
  const recent = (rateLimitBuckets.get(clientKey) || []).filter(timestamp => now - timestamp < rateLimitWindowMs)
  recent.push(now)
  rateLimitBuckets.set(clientKey, recent)
  if (rateLimitBuckets.size > 10_000) {
    for (const [key, timestamps] of rateLimitBuckets) {
      if (!timestamps.some(timestamp => now - timestamp < rateLimitWindowMs)) rateLimitBuckets.delete(key)
    }
  }
  return recent.length > rateLimitMax
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2_500_000) throw new Error('请求体超过 2.5 MB 限制')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function readBody(request, maxBytes = 2_500_000) {
  const chunks = []; let size = 0
  for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw new Error(`请求体超过 ${maxBytes} 字节限制`); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
function sendPrivateFile(response, content, record, download) {
  response.writeHead(200, { 'content-type': record.mime_type, 'content-length': String(content.length), 'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(record.original_name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); response.end(content)
}
function apiConfigsFor(request) { return owned('api_configs', request) }
function runtimeConfig(request, slot) {
  const item = apiConfigsFor(request).find(value => value.slot === slot)
  if (item) { const config = runtimeApiConfig(item, apiConfigMasterKey); if (config) return config }
  if (slot === 'text_primary' && sharedLlm.api_key && sharedLlm.base_url && sharedLlm.model) return { ...sharedLlm }
  return null
}

const redfoxDailyLimit = Number(process.env.REDFOX_DAILY_LIMIT || 10)
const llmDailyLimit = Number(process.env.LLM_DAILY_LIMIT || 20)
const sharedLlm = { base_url: process.env.PROJECT_LLM_BASE_URL || '', api_key: process.env.PROJECT_LLM_API_KEY || '', model: process.env.PROJECT_LLM_MODEL || '' }

function cstDayKey() { return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) }
function quotaUsed(request, kind) {
  const id = `${cstDayKey()}:${userId(request)}:${kind}`
  return state.usage_daily.find(item => item.id === id)?.count || 0
}
async function consumeQuota(request, kind, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true, used: quotaUsed(request, kind), limit }
  const cutoff = new Date(Date.now() + 8 * 3_600_000 - 3 * 86400000).toISOString().slice(0, 10)
  state.usage_daily = state.usage_daily.filter(item => item.date >= cutoff)
  const id = `${cstDayKey()}:${userId(request)}:${kind}`
  let record = state.usage_daily.find(item => item.id === id)
  if (!record) { record = { id, owner_id: userId(request), date: cstDayKey(), kind, count: 0 }; state.usage_daily.push(record) }
  if (record.count >= limit) return { allowed: false, used: record.count, limit }
  record.count += 1
  await saveState('usage_daily')
  return { allowed: true, used: record.count, limit }
}
function hasAccountRedfox(request) { return owned('api_configs', request).some(item => item.slot === 'redfox' && item.encrypted_api_key) }
function hasAccountLlm(request) { return apiConfigsFor(request).some(item => (item.slot === 'text_primary' || item.slot === 'text_fallback') && item.encrypted_api_key && item.enabled !== false) }
function sharedQuotaError(message) { const error = new Error(message); error.code = 'QUOTA_EXCEEDED'; error.retryable = false; return error }

function nextId(collection) {
  return collection.length ? Math.max(...collection.map(item => item.id || 0)) + 1 : 1
}

function sourceRef(type, id) {
  return { type, id, captured_at: new Date().toISOString() }
}

function activeMemories(userId) {
  return (state.memories || []).filter(item => item.owner_id === userId && item.status === 'active')
}

const SESSION_TTL_MS = 30 * 24 * 3_600_000

function userId(request) {
  const session = sessionFor(request)
  if (session && session.expiresAt > Date.now()) return session.userId
  if (developmentMode) return request.headers['x-user-id'] || 'demo-user'
  return null
}

function findUserByUsername(username) {
  const key = String(username || '').trim().toLowerCase()
  return state.users.find(user => user.username === key && user.status !== 'disabled') || null
}

function verifyUserPassword(user, password) {
  const candidate = scryptSync(String(password || ''), user.password_salt || '', 64)
  const expected = Buffer.from(user.password_hash || '', 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

function issueSession(response, id) {
  const token = randomUUID()
  sessions.set(token, { userId: id, expiresAt: Date.now() + SESSION_TTL_MS })
  return send(response, 200, { user_id: id, role: 'creator', expires_in: SESSION_TTL_MS / 1000 }, { 'set-cookie': `content_ip_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${!developmentMode ? '; Secure' : ''}` })
}

function sessionFor(request) {
  const cookies = Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(value => value.trim().split('=')))
  const session = sessions.get(cookies.content_ip_session)
  if (session && session.expiresAt <= Date.now()) sessions.delete(cookies.content_ip_session)
  return session && session.expiresAt > Date.now() ? session : null
}

function owned(collection, request) {
  return state[collection].filter(item => item.owner_id === userId(request) && !item.deleted_at)
}

function userDocument(collection, request) {
  const store = state[`${collection}_by_user`]
  const id = userId(request)
  if (!store[id]) store[id] = structuredClone(defaultState[collection])
  return store[id]
}

function createConflict(request, resourceType, resourceId, baseVersion, localPatch, remote) {
  const conflict = { id: randomUUID(), owner_id: userId(request), resource_type: resourceType, resource_id: resourceId, base_version: baseVersion, local_version: baseVersion, remote_version: remote.version, local_patch: localPatch, remote_snapshot: structuredClone(remote), conflicting_fields: Object.keys(localPatch).filter(key => key !== 'version'), status: 'open', created_at: new Date().toISOString() }
  state.conflicts.push(conflict)
  return conflict
}

function redfoxConfigFor(request) {
  const headerBaseUrl = String(request.headers['x-redfox-base-url'] || '').trim()
  const headerApiKey = String(request.headers['x-redfox-api-key'] || '').trim()
  const stored = apiConfigsFor(request).find(value => value.slot === 'redfox')
  const runtime = runtimeRedfoxConfig(stored, apiConfigMasterKey)
  return {
    baseUrl: headerBaseUrl || runtime?.base_url || process.env.REDFOX_API_URL || '',
    apiKey: headerApiKey || runtime?.api_key || process.env.PROJECT_REDFOX_API_KEY || '',
  }
}

const researchPlatforms = ['全平台', '小红书', '抖音', '视频号', '公众号', 'B站', '微博', '快手', '今日头条', 'X']

async function runRedFox(request, { demo, apply }) {
  const { baseUrl, apiKey } = redfoxConfigFor(request)
  const adapter = createRedFoxAdapter({ baseUrl, apiKey })
  if (!adapter.configured) return { ok: true, demo: true, result: demo() }
  if (!hasAccountRedfox(request)) {
    const quota = await consumeQuota(request, 'redfox', redfoxDailyLimit)
    if (!quota.allowed) return { ok: false, error: sharedQuotaError(`今日共享搜索额度已用完（每人每天 ${redfoxDailyLimit} 次）。可在 API 中心配置自己的红狐 Key 解除限制`) }
  }
  try {
    return { ok: true, result: await apply(adapter) }
  } catch (error) {
    return { ok: false, error }
  }
}

function persistResearch(userId, entries, { query = '', sourceTag = 'redfox', capturedAt } = {}) {
  const items = entries.map((entry, index) => {
    const research = { id: nextId(state.research) + index, owner_id: userId, platform: entry.platform, title: entry.title, author: entry.author || '', url: entry.url || null, metrics: entry.metrics || { discussions: 0, growth: 0 }, query: entry.query || query, analysis: null, strategy_layer: 'reach', content_job: '进入更大的兴趣流量池', goal_refs: [], captured_at: capturedAt, source: entry.source || sourceTag, source_refs: [sourceRef(sourceTag, `${entry.title}`)] }
    return research
  })
  state.research = [...items, ...state.research.filter(existing => existing.owner_id !== userId || !items.some(item => item.title === existing.title))]
  return items
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const requestId = randomUUID()
  const startedAt = Date.now()
  response.setHeader('x-request-id', requestId)
  response.once('finish', () => console.log(JSON.stringify({ event: 'http_request', request_id: requestId, method: request.method, path: url.pathname, status: response.statusCode, duration_ms: Date.now() - startedAt })))
  if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) return send(response, 403, { error: '请求来源不被允许' })
  response[responseCorsOrigin] = request.headers.origin || allowedOrigin
  if (request.method === 'OPTIONS') return send(response, 204, {})
  if (['/healthz', '/api/health'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) return send(response, 200, { status: 'ok', storage: mysqlPool ? 'mysql' : 'json-mvp' })
  if (url.pathname.startsWith('/api/') && isRateLimited(request)) return send(response, 429, { error: '请求过于频繁', retryable: true }, { 'retry-after': String(Math.ceil(rateLimitWindowMs / 1000)) })

  try {
    if (url.pathname === '/api/auth/session' && request.method === 'GET') {
      const session = sessionFor(request)
      if (!session) {
        if (developmentMode) return send(response, 200, { auth_required: false })
        return send(response, 401, { error: '需要登录', auth_required: true, registration_open: true })
      }
      const user = findUserByUsername(session.userId)
      return send(response, 200, { user_id: session.userId, role: 'creator', display_name: user?.display_name || session.userId, expires_in: Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000)) })
    }
    if (url.pathname === '/api/auth/session' && request.method === 'DELETE') {
      const cookies = Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(value => value.trim().split('=')))
      if (cookies.content_ip_session) sessions.delete(cookies.content_ip_session)
      return send(response, 204, {}, { 'set-cookie': `content_ip_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${!developmentMode ? '; Secure' : ''}` })
    }
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      const body = await readJson(request).catch(() => ({}))
      const username = String(body.username || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (!/^[a-z0-9_-]{2,32}$/.test(username)) return send(response, 422, { error: '用户名需为 2-32 位字母、数字、下划线或中划线' })
      if (['owner', 'demo-user'].includes(username)) return send(response, 422, { error: '该用户名不可用' })
      if (password.length < 8 || password.length > 128) return send(response, 422, { error: '密码长度需为 8-128 位' })
      if (findUserByUsername(username)) return send(response, 409, { error: '用户名已被注册' })
      const passwordSalt = randomBytes(16).toString('hex')
      const user = { id: username, owner_id: username, username, display_name: String(body.display_name || '').trim().slice(0, 40) || username, password_salt: passwordSalt, password_hash: scryptSync(password, passwordSalt, 64).toString('hex'), status: 'active', created_at: new Date().toISOString() }
      state.users.push(user)
      await saveState('users')
      return issueSession(response, user.id)
    }
    if (url.pathname === '/api/auth/session' && request.method === 'POST') {
      const body = await readJson(request).catch(() => ({}))
      const username = String(body.username || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (username) {
        const user = findUserByUsername(username)
        if (!user || !verifyUserPassword(user, password)) return send(response, 401, { error: '用户名或密码不正确', retryable: true })
        return issueSession(response, user.id)
      }
      const accessPassword = process.env.PRODUCT_ACCESS_PASSWORD
      if (accessPassword) {
        const expected = Buffer.from(accessPassword)
        const provided = Buffer.from(String(body.password || request.headers['x-access-password'] || ''))
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          return send(response, 401, { error: '访问密码不正确', retryable: true })
        }
        return issueSession(response, 'owner')
      }
      if (developmentMode) return issueSession(response, request.headers['x-user-id'] || 'demo-user')
      return send(response, 401, { error: '请输入用户名和密码登录，或注册新账号', auth_required: true, registration_open: true })
    }
    if (!developmentMode && !sessionFor(request)) return send(response, 401, { error: '需要登录', auth_required: true })
    if (url.pathname === '/api/redfox-settings' && request.method === 'GET') { const stored = owned('api_configs', request).find(item => item.slot === 'redfox'); return send(response, 200, stored ? publicRedfoxConfig(stored) : emptyPublicRedfoxConfig()) }
    if (url.pathname === '/api/redfox-settings' && request.method === 'PUT') { try { const existing = owned('api_configs', request).find(item => item.slot === 'redfox'); const next = { ...updateRedfoxConfig(existing, await readJson(request), apiConfigMasterKey), owner_id: userId(request) }; if (existing) Object.assign(existing, next); else state.api_configs.push(next); await saveState('api_configs'); return send(response, 200, publicRedfoxConfig(next)) } catch (error) { return send(response, 422, { error: error.message }) } }
    if (url.pathname === '/api/redfox-settings' && request.method === 'POST' && url.searchParams.get('action') === 'test') { const stored = owned('api_configs', request).find(item => item.slot === 'redfox'); const runtime = runtimeRedfoxConfig(stored, apiConfigMasterKey); if (!runtime) return send(response, 422, { error: '红狐 API 配置不完整' }); try { await createRedFoxAdapter({ baseUrl: runtime.base_url, apiKey: runtime.api_key }).trending(); return send(response, 200, { ok: true, capability: 'redfox' }) } catch (error) { return send(response, 200, { ok: false, error: error instanceof Error ? error.message : '红狐 API 测试失败' }) } }
    if (url.pathname === '/api/api-settings' && request.method === 'GET') { const values = owned('api_configs', request); return send(response, 200, emptyPublicApiConfigs().map(item => publicApiConfig(values.find(value => value.slot === item.slot) || item))) }
    const apiSettingsMatch = url.pathname.match(/^\/api\/api-settings\/([^/]+)$/)
    if (apiSettingsMatch && request.method === 'POST' && url.searchParams.get('action') === 'test') {
      const slot = ['text_primary', 'text_fallback', 'vision'].includes(apiSettingsMatch[1]) ? apiSettingsMatch[1] : null
      if (!slot) return send(response, 404, { error: 'API 配置槽不存在' })
      const stored = owned('api_configs', request).find(item => item.slot === slot)
      const runtime = runtimeApiConfig(stored, apiConfigMasterKey, { requireEnabled: false })
      if (!runtime) return send(response, 422, { error: 'API 配置不完整' })
      try {
        const result = await testApiCapability(slot, runtime)
        return send(response, 200, { ok: true, ...result })
      } catch (error) {
        return send(response, 200, { ok: false, error: error instanceof Error ? error.message : '上游 API 测试失败' })
      }
    }
    if (apiSettingsMatch && request.method === 'PUT') { const slot = ['text_primary', 'text_fallback', 'vision'].includes(apiSettingsMatch[1]) ? apiSettingsMatch[1] : null; if (!slot) return send(response, 404, { error: 'API 配置槽不存在' }); try { const existing = owned('api_configs', request).find(item => item.slot === slot); const next = { ...updateApiConfig(existing, slot, await readJson(request), apiConfigMasterKey), owner_id: userId(request) }; if (existing) Object.assign(existing, next); else state.api_configs.push(next); await saveState('api_configs'); return send(response, 200, publicApiConfig(next)) } catch (error) { return send(response, 422, { error: error.message }) } }
    if (url.pathname === '/api/api-settings/migrate' && request.method === 'POST') { const body = await readJson(request); try { for (const slot of ['text_primary', 'text_fallback', 'vision']) if (body[slot]) { const existing = owned('api_configs', request).find(item => item.slot === slot); const next = { ...updateApiConfig(existing, slot, body[slot], apiConfigMasterKey), owner_id: userId(request) }; if (existing) Object.assign(existing, next); else state.api_configs.push(next) }; await saveState('api_configs'); const values = owned('api_configs', request); return send(response, 200, emptyPublicApiConfigs().map(item => publicApiConfig(values.find(value => value.slot === item.slot) || item))) } catch (error) { return send(response, 422, { error: error.message }) } }
    if (url.pathname === '/api/private-files' && request.method === 'POST') { try { const content = await readBody(request, privateFileMaxBytes + 1); const validated = validatePrivateFile({ fileName: request.headers['x-file-name'], mimeType: request.headers['content-type'], content, maxBytes: privateFileMaxBytes }); const duplicate = owned('private_files', request).find(item => item.checksum === validated.checksum); if (duplicate) return send(response, 200, { ...publicPrivateFile(duplicate), duplicate: true }); const storagePath = storePrivateFile(privateFileRoot, userId(request), validated, content); const record = { id: randomUUID(), owner_id: userId(request), original_name: validated.safeName, mime_type: validated.mimeType, size: content.length, checksum: validated.checksum, storage_path: storagePath, created_at: new Date().toISOString() }; state.private_files.push(record); await saveState('private_files'); return send(response, 201, publicPrivateFile(record)) } catch (error) { return send(response, 422, { error: error.message }) } }
    const privateFileMatch = url.pathname.match(/^\/api\/private-files\/([^/]+)\/(preview|download)$/)
    if (privateFileMatch && request.method === 'GET') { const record = owned('private_files', request).find(item => item.id === privateFileMatch[1]); if (!record) return send(response, 404, { error: '文件不存在' }); try { return sendPrivateFile(response, readPrivateFile(privateFileRoot, record.storage_path), record, privateFileMatch[2] === 'download') } catch { return send(response, 410, { error: '文件内容不可用' }) } }
    if (url.pathname === '/api/positioning' && request.method === 'GET') return send(response, 200, userDocument('positioning', request))
    if (url.pathname === '/api/positioning' && request.method === 'PUT') {
      const body = await readJson(request)
      const positioning = userDocument('positioning', request)
      state.positioning_by_user[userId(request)] = { ...positioning, ...body, interview_answers: { ...positioning.interview_answers, ...body.interview_answers }, updated_at: new Date().toISOString() }
      await saveState('positioning')
      return send(response, 200, state.positioning_by_user[userId(request)])
    }
    if (url.pathname === '/api/positioning/generate-keywords' && request.method === 'POST') {
      const positioning = userDocument('positioning', request)
      const profile = userDocument('profile', request)
      const role = positioning.role || profile.role || '个人 IP 创作者'
      const audiences = positioning.audiences?.length ? positioning.audiences : profile.audiences
      const pillars = positioning.pillars?.length ? positioning.pillars : profile.pillars
      const topics = pillars.length ? pillars : ['真实经验', '过程复盘', '方法拆解']
      const generated = {
        keyword_groups: [{ name: '核心定位', keywords: [role, ...audiences.slice(0, 3)] }, { name: '内容主题', keywords: topics.slice(0, 5) }],
        topic_groups: topics.map(topic => ({ name: topic, examples: [`${topic}中的常见误区`, `${topic}的真实过程`] })),
        material_types: ['案例记录', '过程截图', '客户反馈', '数据复盘'],
        research_suggestions: ['研究目标平台的同类高互动内容', '收集目标人群反复提问的具体场景'],
        generated_at: new Date().toISOString(),
      }
      state.positioning_by_user[userId(request)] = { ...positioning, ...generated, version: (positioning.version || 1) + 1, updated_at: new Date().toISOString() }
       await saveState('positioning')
      return send(response, 200, state.positioning_by_user[userId(request)])
    }
    if (url.pathname === '/api/positioning/candidates' && request.method === 'POST') {
      const positioning = userDocument('positioning', request)
      const answers = Object.values(positioning.interview_answers || {}).filter(Boolean)
      if (!answers.length) return send(response, 422, { error: '请先完成定位发现访谈', retryable: true })
      const evidence = answers.slice(0, 3).map((answer, index) => sourceRef('positioning_answer', `${userId(request)}-${index}`))
      const candidates = [
        ['真实经验型专家', '把反复做成的事转化为别人可以照做的方法。', '过程记录、方法拆解、经验复盘'],
        ['独特视角型创作者', '围绕独特经历和观察持续输出高辨识度观点。', '观察评论、反常识、个人故事'],
        ['陪伴成长型引导者', '陪伴与过去的自己相似的人走过一段具体路径。', '行动建议、案例陪跑、成长记录'],
      ].map(([name, value, pillars], index) => ({ id: randomUUID(), name, positioning_statement: value, audiences: positioning.audiences || [], pillars: pillars.split('、'), scores: { advantage: 4 - index, demand: 4, evidence: answers.length >= 3 ? 4 : 2, differentiation: 3 + (index === 1 ? 1 : 0), sustainability: 4 }, goal_refs: positioning.monetization_goals?.length || positioning.acquisition_goals?.length ? ['ip_goal'] : [], source_refs: evidence, status: 'pending', created_at: new Date().toISOString() }))
      state.positioning_candidates_by_user ||= {}
      state.positioning_candidates_by_user[userId(request)] = candidates
       await saveState('positioning_candidates')
      return send(response, 201, candidates)
    }
    const candidateMatch = url.pathname.match(/^\/api\/positioning\/candidates\/([^/]+)$/)
    if (candidateMatch && request.method === 'PUT') {
      const candidates = state.positioning_candidates_by_user?.[userId(request)] || []
      const candidate = candidates.find(item => item.id === candidateMatch[1])
      if (!candidate) return send(response, 404, { error: '定位候选不存在' })
      const body = await readJson(request)
      if (!['confirmed', 'rejected'].includes(body.status)) return send(response, 422, { error: '候选状态必须是 confirmed 或 rejected' })
      candidate.status = body.status
      if (body.status === 'confirmed') {
        const positioning = userDocument('positioning', request)
        state.positioning_by_user[userId(request)] = { ...positioning, role: candidate.name, pillars: candidate.pillars, candidate_id: candidate.id, status: 'complete', source_refs: candidate.source_refs, version: (positioning.version || 1) + 1, updated_at: new Date().toISOString() }
      }
       await saveState('positioning', 'positioning_candidates')
      return send(response, 200, candidate)
    }
    if (url.pathname === '/api/content-strategy' && request.method === 'GET') return send(response, 200, userDocument('strategy', request))
    if (url.pathname === '/api/content-strategy' && request.method === 'PUT') {
      const body = await readJson(request)
      if (body.layer_ratios && !validRatios(body.layer_ratios)) return send(response, 422, { error: 'layer_ratios 必须是总和为 100 的非负整数' })
      const strategy = userDocument('strategy', request)
      const previous = { ...strategy, history: undefined }
      state.strategy_by_user[userId(request)] = { ...strategy, ...body, version: strategy.version + 1 }
      const current = { ...state.strategy_by_user[userId(request)], history: undefined }
      state.strategy_by_user[userId(request)].history.push({ version: state.strategy_by_user[userId(request)].version, previous, current, change_reason: body.change_reason || '用户调整', created_at: new Date().toISOString() })
      await saveState('strategy')
      return send(response, 200, state.strategy_by_user[userId(request)])
    }
    if (url.pathname === '/api/content-strategy/reviews' && request.method === 'POST') {
      return send(response, 200, { period: '最近 14 天', strategy_version: userDocument('strategy', request).version, layer_metrics: { reach: { exposure_change: 42 }, trust: { saves_change: 18 }, conversion: { qualified_leads: 6 } }, recommendations: [{ layer_ratios: { reach: 40, trust: 35, conversion: 25 }, reason: '泛流量表现稳定，垂直内容带来的收藏和线索质量更高。' }] })
    }
    if (url.pathname === '/api/content-strategy/recommend' && request.method === 'POST') {
      return send(response, 200, { stage: userDocument('strategy', request).stage, layer_ratios: { reach: 40, trust: 35, conversion: 25 }, content_jobs: ['用广泛兴趣入口获得首次互动', '用真实过程建立专业信任', '用明确行动入口承接核心目标'], reason: '当前复盘数据支持将部分触达投入转向信任和转化。' })
    }
    if (url.pathname === '/api/content-strategy/versions' && request.method === 'POST') {
      const body = await readJson(request)
      if (!body.layer_ratios || !validRatios(body.layer_ratios)) return send(response, 422, { error: '策略版本比例必须总和为 100' })
      const strategy = userDocument('strategy', request)
      const previous = { ...strategy, history: undefined }
      state.strategy_by_user[userId(request)] = { ...strategy, ...body, version: strategy.version + 1 }
      const current = { ...state.strategy_by_user[userId(request)], history: undefined }
      state.strategy_by_user[userId(request)].history.push({ version: state.strategy_by_user[userId(request)].version, previous, current, change_reason: body.change_reason || '复盘确认', created_at: new Date().toISOString() })
       await saveState('strategy')
      return send(response, 201, state.strategy_by_user[userId(request)])
    }
    if (url.pathname === '/api/content-strategy/versions' && request.method === 'GET') return send(response, 200, userDocument('strategy', request).history)
    if (url.pathname === '/api/profile' && request.method === 'GET') return send(response, 200, userDocument('profile', request))
    if (url.pathname === '/api/profile' && request.method === 'PUT') {
      const body = await readJson(request)
      const profile = userDocument('profile', request)
      if (body.role !== undefined && !String(body.role).trim()) return send(response, 422, { error: '角色不能为空' })
      const history = [...(profile.history || [])]
      for (const [field, next] of Object.entries(body)) if (JSON.stringify(profile[field]) !== JSON.stringify(next)) history.push({ field, previous: profile[field] ?? null, next, changed_at: new Date().toISOString() })
      state.profile_by_user[userId(request)] = { ...profile, ...body, history, version: profile.version + 1, updated_at: new Date().toISOString() }
       await saveState('profile')
      return send(response, 200, state.profile_by_user[userId(request)])
    }
    if (url.pathname === '/api/profile/import' && request.method === 'POST') {
      const body = await readJson(request)
      const text = String(body.content || '')
      const fields = { role: text.match(/(?:角色|身份)[:：]\s*(.+)/)?.[1] || '', audiences: text.match(/(?:受众|服务对象)[:：]\s*(.+)/)?.[1]?.split(/[、,，]/).filter(Boolean) || [], pillars: text.match(/(?:支柱|主题)[:：]\s*(.+)/)?.[1]?.split(/[、,，]/).filter(Boolean) || [], viewpoints: text.match(/(?:观点)[:：]\s*(.+)/)?.[1]?.split(/[、,，]/).filter(Boolean) || [] }
      const importedSource = sourceRef('profile_import', body.name || randomUUID())
      const review = { id: randomUUID(), owner_id: userId(request), file_name: body.name || '未命名档案', fields, extracted: fields, unrecognized: text.split(/\r?\n/).filter(line => line.trim() && !/[:：]/.test(line)), status: 'pending', source_ref: importedSource, source_refs: [importedSource], created_at: new Date().toISOString() }
      state.profile_reviews.push(review)
       await saveState('profile_reviews')
      return send(response, 201, review)
    }
    if (url.pathname === '/api/profile/reviews' && request.method === 'GET') return send(response, 200, state.profile_reviews.filter(item => item.owner_id === userId(request)))
    const profileReviewMatch = url.pathname.match(/^\/api\/profile\/reviews\/([^/]+)$/)
    if (profileReviewMatch && request.method === 'PUT') {
      const review = state.profile_reviews.find(item => item.id === profileReviewMatch[1] && item.owner_id === userId(request))
      if (!review) return send(response, 404, { error: '待审核档案不存在' })
       const body = await readJson(request)
       if (!['confirmed', 'approved', 'rejected'].includes(body.status)) return send(response, 422, { error: '审核状态必须是 confirmed、approved 或 rejected' })
       const editableFields = ['role', 'audiences', 'pillars', 'viewpoints']
       if (body.fields !== undefined && (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields))) return send(response, 422, { error: '审核字段必须是对象' })
       if (body.fields) {
         review.fields = { ...review.fields, ...Object.fromEntries(editableFields.filter(key => body.fields[key] !== undefined).map(key => [key, Array.isArray(body.fields[key]) ? body.fields[key].map(String) : String(body.fields[key])])) }
         review.extracted = review.fields
       }
       review.status = body.status
       if (body.status === 'confirmed' || body.status === 'approved') {
         review.status = 'confirmed'
        const profile = userDocument('profile', request)
        state.profile_by_user[userId(request)] = { ...profile, ...review.fields, source_refs: [...(profile.source_refs || []), review.source_ref], version: (profile.version || 1) + 1, updated_at: new Date().toISOString() }
      }
       await saveState('profile_reviews', 'profile')
      return send(response, 200, review)
    }
    if (url.pathname === '/api/materials' && request.method === 'GET') {
      const params = url.searchParams
      const hasQuery = ['q', 'format', 'status', 'review_status', 'sort', 'page', 'kind', 'kind_counts'].some(key => params.get(key))
      if (!hasQuery) return send(response, 200, owned('materials', request))
      if (params.get('kind_counts')) {
        const counts = { article: 0, quote: 0, hotspot: 0, insight: 0, experience: 0 }
        for (const item of owned('materials', request)) counts[item.material_kind || 'article'] = (counts[item.material_kind || 'article'] || 0) + 1
        return send(response, 200, { kind_counts: counts })
      }
      const query = (params.get('q') || '').trim().toLowerCase()
      const format = params.get('format') || ''
      const status = params.get('status') || ''
      const reviewStatus = params.get('review_status') || ''
      const kind = params.get('kind') || ''
      const sort = ['latest', 'name'].includes(params.get('sort')) ? params.get('sort') : 'latest'
      const page = Math.max(1, Number(params.get('page')) || 1)
      const pageSize = 50
      let items = owned('materials', request)
      if (query) items = items.filter(item => String(item.name).toLowerCase().includes(query) || String(item.content || '').toLowerCase().includes(query))
      if (format) items = items.filter(item => item.format === format)
      if (status) items = items.filter(item => item.status === status)
      if (reviewStatus) items = items.filter(item => item.review_status === reviewStatus)
      if (kind) items = items.filter(item => (item.material_kind || 'article') === kind)
      items = [...items].sort((a, b) => sort === 'name' ? String(a.name).localeCompare(String(b.name), 'zh') : String(b.imported_at || b.created_at || '').localeCompare(String(a.imported_at || a.created_at || '')))
      const total = items.length
      const start = (page - 1) * pageSize
      return send(response, 200, { items: items.slice(start, start + pageSize), total, page, page_size: pageSize })
    }
    if (url.pathname === '/api/materials/atoms' && request.method === 'POST') {
      const body = await readJson(request)
      const atomKinds = ['quote', 'hotspot', 'insight', 'experience']
      const text = String(body.text || '').trim()
      if (!atomKinds.includes(body.kind)) return send(response, 422, { error: '素材类型无效' })
      if (!text) return send(response, 422, { error: '素材内容不能为空' })
      let originSource = null
      if (body.source_id !== undefined && body.source_id !== null) {
        originSource = owned('materials', request).find(item => item.id === Number(body.source_id) && !item.deleted_at)
        if (!originSource) return send(response, 422, { error: '来源素材不存在' })
      }
      const duplicate = originSource ? state.materials.find(item => item.owner_id === userId(request) && !item.deleted_at && item.origin_source_id === originSource.id && item.origin_text === text) : null
      if (duplicate) return send(response, 200, { ...duplicate, duplicate: true })
      const material = { id: nextId(state.materials), owner_id: userId(request), name: String(body.name || '').trim() || text.slice(0, 40), source_path: null, format: 'text', content: text, url: null, checksum: createHash('sha256').update(`atom:${originSource ? originSource.id : ''}:${text}`).digest('hex'), status: 'ready', error: null, retry_count: 0, extracted_fields: { segments: [], candidate_topics: [], quotes: [] }, review_status: 'pending', strategy_layer: originSource?.strategy_layer || 'trust', goal_refs: originSource?.goal_refs || [], material_kind: body.kind, origin_source_id: originSource ? originSource.id : null, origin_text: text, origin_material_name: originSource ? originSource.name : null, source_refs: originSource ? [sourceRef('material', originSource.id)] : [], imported_at: new Date().toISOString() }
      state.materials.push(material)
      if (originSource && (body.kind === 'quote' || body.kind === 'hotspot')) {
        if (!originSource.extracted_fields) originSource.extracted_fields = {}
        if (!originSource.extracted_fields.collected) originSource.extracted_fields.collected = { quote: [], hotspot: [] }
        const bucket = originSource.extracted_fields.collected[body.kind]
        if (!bucket.includes(text)) bucket.push(text)
      }
      await saveState('materials')
      return send(response, 201, material)
    }
    const atomDeleteMatch = url.pathname.match(/^\/api\/materials\/atoms\/(\d+)$/)
    if (atomDeleteMatch && request.method === 'DELETE') {
      const material = state.materials.find(item => item.id === Number(atomDeleteMatch[1]) && item.owner_id === userId(request) && !item.deleted_at)
      if (!material || material.material_kind === 'article') return send(response, 404, { error: '原子素材不存在' })
      material.deleted_at = new Date().toISOString()
      material.status = 'withdrawn'
      const originSource = material.origin_source_id ? state.materials.find(item => item.id === material.origin_source_id && item.owner_id === userId(request)) : null
      if (originSource?.extracted_fields?.collected?.[material.material_kind]) {
        originSource.extracted_fields.collected[material.material_kind] = originSource.extracted_fields.collected[material.material_kind].filter(text => text !== material.origin_text)
      }
      await saveState('materials')
      return send(response, 200, material)
    }
    if ((url.pathname === '/api/materials/import' || url.pathname === '/api/materials/upload') && request.method === 'POST') {
       const body = await readJson(request)
      const validationError = validateMaterialInput(body)
      if (validationError) return send(response, 422, { error: validationError })
      const format = normalizeMaterialFormat(body.name, body.format)
      const parsed = parseMaterialContent({ format, content: body.content, url: body.url })
      const content = parsed.content
      const checksum = body.checksum || createHash('sha256').update(`${body.name || ''}:${content}`).digest('hex')
      const duplicate = owned('materials', request).find(item => item.checksum === checksum)
      if (duplicate) return send(response, 200, { ...duplicate, duplicate: true })
      const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      const uploadKinds = ['article', 'quote', 'hotspot', 'insight', 'experience']
        const material = { id: nextId(state.materials), owner_id: userId(request), name: body.name || '未命名素材', source_path: body.path || null, format, content, url: body.url || null, checksum, status: parsed.status, error: parsed.error, retry_count: 0, extracted_fields: { segments: lines.slice(0, 8), candidate_topics: lines.filter(line => line.length >= 8).slice(0, 5), quotes: lines.filter(line => line.length >= 12).slice(0, 5) }, review_status: 'pending', strategy_layer: body.strategy_layer || 'trust', goal_refs: body.goal_refs || [], material_kind: uploadKinds.includes(body.material_kind) ? body.material_kind : 'article', source_refs: [sourceRef('material', checksum)], imported_at: new Date().toISOString() }
      state.materials.push(material)
       await saveState('materials')
      return send(response, 201, material)
    }
    const materialMatch = url.pathname.match(/^\/api\/materials\/(\d+)$/)
    if (materialMatch && request.method === 'DELETE') {
      const material = state.materials.find(item => item.id === Number(materialMatch[1]) && item.owner_id === userId(request))
      if (!material || material.deleted_at) return send(response, 404, { error: '素材不存在' })
      material.deleted_at = new Date().toISOString()
      material.status = 'withdrawn'
       await saveState('materials')
      return send(response, 200, material)
    }
    const materialRetryMatch = url.pathname.match(/^\/api\/materials\/(\d+)\/retry$/)
    if (materialRetryMatch && request.method === 'POST') {
      const material = state.materials.find(item => item.id === Number(materialRetryMatch[1]) && item.owner_id === userId(request) && !item.deleted_at)
      if (!material) return send(response, 404, { error: '素材不存在' })
      const body = await readJson(request)
      const parsed = parseMaterialContent({ format: material.format, content: body.content ?? material.content, url: body.url ?? material.url })
      material.content = parsed.content
      material.url = body.url ?? material.url
      material.status = parsed.status
      material.error = parsed.error
      material.retry_count = (material.retry_count || 0) + 1
      material.updated_at = new Date().toISOString()
       await saveState('materials')
      return send(response, 200, material)
    }
    if (url.pathname === '/api/devices' && request.method === 'GET') return send(response, 200, owned('devices', request))
    if (url.pathname === '/api/devices/heartbeat' && request.method === 'POST') { const body = await readJson(request); const id = String(body.id || '').trim(); if (!id) return send(response, 422, { error: '设备标识无效' }); let device = owned('devices', request).find(item => item.id === id); if (!device) { device = { id, owner_id: userId(request), name: String(body.name || id), last_seen_at: new Date().toISOString() }; state.devices.push(device) } else { device.last_seen_at = new Date().toISOString() }; await saveState('devices'); return send(response, 200, device) }
    if (url.pathname === '/api/sync-directories' && request.method === 'GET') return send(response, 200, owned('sync_directories', request))
    if (url.pathname === '/api/sync-directories' && request.method === 'POST') { const body = await readJson(request); const path = String(body.local_path || '').trim(); if (!path) return send(response, 422, { error: '本地路径无效' }); const directory = { id: randomUUID(), owner_id: userId(request), device_id: String(body.device_id || 'local-device'), local_path: path, enabled: body.enabled !== false, sync_status: 'pending_verification', sync_error: null, last_scanned_at: null, created_at: new Date().toISOString() }; state.sync_directories.push(directory); await saveState('sync_directories'); return send(response, 201, directory) }
    const syncDirectoryMatch = url.pathname.match(/^\/api\/sync-directories\/([^/]+)$/)
    if (syncDirectoryMatch && request.method === 'PUT') { const directory = owned('sync_directories', request).find(item => item.id === syncDirectoryMatch[1]); if (!directory) return send(response, 404, { error: '同步目录不存在' }); const body = await readJson(request); if (body.enabled !== undefined) { directory.enabled = Boolean(body.enabled); if (!directory.enabled) directory.sync_status = 'paused' }; if (body.sync_status) directory.sync_status = body.sync_status; if (body.sync_error !== undefined) directory.sync_error = body.sync_error; if (body.last_scanned_at) directory.last_scanned_at = body.last_scanned_at; await saveState('sync_directories'); return send(response, 200, directory) }
    if (syncDirectoryMatch && request.method === 'DELETE') { state.sync_directories = state.sync_directories.filter(item => !(item.id === syncDirectoryMatch[1] && item.owner_id === userId(request))); await saveState('sync_directories'); return send(response, 200, { ok: true }) }
    if (url.pathname === '/api/materials/sync' && request.method === 'POST') {
      const body = await readJson(request)
      const files = Array.isArray(body.files) ? body.files : []
      const owner = userId(request)
      const deviceId = body.device_id || 'local-device'
      const results = []
      for (const file of files) {
        if (!file.name && !file.path) {
          const failedJob = { id: randomUUID(), owner_id: owner, device_id: deviceId, path: '', name: '未命名素材', checksum: file.checksum || '', content: '', status: 'failed', attempts: 1, error: '同步条目缺少文件名或相对路径', created_at: new Date().toISOString() }
          state.sync_jobs.push(failedJob)
          results.push({ name: failedJob.name, checksum: failedJob.checksum, status: failedJob.status, job_id: failedJob.id, error: failedJob.error })
          continue
        }
        const checksum = file.checksum || createHash('sha256').update(`${file.path || file.name || ''}:${file.content || ''}`).digest('hex')
        if (file.type === 'deleted') {
          const material = state.materials.find(item => item.owner_id === owner && !item.deleted_at && (item.source_path === file.path || item.name === file.name))
          if (!material) {
            results.push({ name: file.name, checksum, status: 'missing' })
            continue
          }
          material.deleted_at = new Date().toISOString()
          material.status = 'withdrawn'
          results.push({ name: file.name, checksum, status: 'withdrawn', material_id: material.id })
          continue
        }
        const duplicate = state.materials.find(item => item.owner_id === owner && !item.deleted_at && item.checksum === checksum)
        if (duplicate) {
          results.push({ name: file.name, checksum, status: 'duplicate', material_id: duplicate.id })
          continue
        }
        const existingJob = state.sync_jobs.find(job => job.owner_id === owner && job.device_id === deviceId && job.checksum === checksum && job.status !== 'failed')
        if (existingJob) {
          results.push({ name: file.name, checksum, status: existingJob.status, job_id: existingJob.id })
          continue
        }
        const job = { id: randomUUID(), owner_id: owner, device_id: deviceId, path: file.path || file.name || '', name: file.name || '未命名素材', checksum, content: String(file.content || ''), status: 'queued', attempts: 0, error: null, created_at: new Date().toISOString() }
        state.sync_jobs.push(job)
        results.push({ name: job.name, checksum, status: job.status, job_id: job.id })
      }
       await saveState('sync_jobs')
      return send(response, 202, { device_id: deviceId, results })
    }
    if (url.pathname === '/api/materials/sync' && request.method === 'GET') return send(response, 200, state.sync_jobs.filter(item => item.owner_id === userId(request)))
    const syncRetryMatch = url.pathname.match(/^\/api\/materials\/sync\/([^/]+)\/retry$/)
    if (syncRetryMatch && request.method === 'POST') {
      const job = state.sync_jobs.find(item => item.id === syncRetryMatch[1] && item.owner_id === userId(request))
      if (!job) return send(response, 404, { error: '同步任务不存在' })
      job.status = 'queued'
      job.error = null
      job.attempts += 1
       await saveState('sync_jobs')
      return send(response, 202, job)
    }
    if (url.pathname === '/api/structures' && request.method === 'GET') {
      const params = url.searchParams
      const query = (params.get('q') || '').trim().toLowerCase()
      const platform = params.get('platform') || ''
      const contentType = params.get('content_type') || ''
      const methodCategory = params.get('method_category') || ''
      const favorite = params.get('favorite') === '1'
      const sort = ['latest', 'usage', 'favorite'].includes(params.get('sort')) ? params.get('sort') : 'latest'
      const page = Math.max(1, Number(params.get('page')) || 1)
      const pageSize = 50
      let items = owned('structures', request)
      if (query) items = items.filter(item => item.title.toLowerCase().includes(query) || item.steps.some(step => step.toLowerCase().includes(query)))
      if (platform) items = items.filter(item => item.platform === platform)
      if (contentType) items = items.filter(item => item.content_type === contentType)
      if (methodCategory) items = items.filter(item => item.method_category === methodCategory || (methodCategory === '开头方法' && item.steps[0]?.includes('开场')) || (methodCategory === '内容结构' && !item.steps[0]?.includes('开场')))
      if (favorite) items = items.filter(item => item.favorite)
      items = [...items].sort((a, b) => sort === 'usage' ? b.usage_count - a.usage_count : sort === 'favorite' ? Number(b.favorite) - Number(a.favorite) || b.usage_count - a.usage_count : String(b.updated_at).localeCompare(String(a.updated_at)))
      const total = items.length
      const start = (page - 1) * pageSize
      return send(response, 200, { items: items.slice(start, start + pageSize), total, page, page_size: pageSize })
    }
    if (url.pathname === '/api/structures' && request.method === 'POST') {
      const body = await readJson(request)
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const steps = Array.isArray(body.steps) ? body.steps.map(step => (typeof step === 'string' ? step.trim() : '')).filter(Boolean) : []
      if (!title || !steps.length) return send(response, 400, { error: '标题与步骤为必填项' })
      const structure = { id: nextId(state.structures), owner_id: userId(request), title, steps, platform: typeof body.platform === 'string' && body.platform ? body.platform : '通用', content_type: typeof body.content_type === 'string' && body.content_type ? body.content_type : '观点', source_kind: 'manual', source_id: null, source_refs: [], method_category: steps[0]?.includes('开场') ? '开头方法' : '内容结构', favorite: false, usage_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      state.structures.push(structure)
      await saveState('structures')
      return send(response, 201, structure)
    }
    const structureMatch = url.pathname.match(/^\/api\/structures\/(\d+)$/)
    if (structureMatch && request.method === 'PUT') {
      const structure = owned('structures', request).find(item => item.id === Number(structureMatch[1]))
      if (!structure) return send(response, 404, { error: '结构条目不存在' })
      const body = await readJson(request)
      if (body.record_usage === true) {
        structure.usage_count += 1
      } else {
        if (body.title !== undefined) {
          const title = typeof body.title === 'string' ? body.title.trim() : ''
          if (!title) return send(response, 400, { error: '标题为必填项' })
          structure.title = title
        }
        if (body.steps !== undefined) {
          const steps = Array.isArray(body.steps) ? body.steps.map(step => (typeof step === 'string' ? step.trim() : '')).filter(Boolean) : []
          if (!steps.length) return send(response, 400, { error: '步骤为必填项' })
          structure.steps = steps
        }
        if (typeof body.platform === 'string' && body.platform) structure.platform = body.platform
        if (typeof body.content_type === 'string' && body.content_type) structure.content_type = body.content_type
        if (typeof body.favorite === 'boolean') structure.favorite = body.favorite
        structure.updated_at = new Date().toISOString()
      }
      await saveState('structures')
      return send(response, 200, structure)
    }
    if (structureMatch && request.method === 'DELETE') {
      const structure = owned('structures', request).find(item => item.id === Number(structureMatch[1]))
      if (structure) {
        state.structures = state.structures.filter(item => item !== structure)
        await saveState('structures')
      }
      return send(response, 204, {})
    }
    if (url.pathname === '/api/memories' && request.method === 'GET') {
      const type = url.searchParams.get('type') || ''
      let items = owned('memories', request)
      if (type) items = items.filter(item => item.memory_type === type)
      items = [...items].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return send(response, 200, items)
    }
    if (url.pathname === '/api/memories' && request.method === 'POST') {
      const body = await readJson(request)
      const memoryTypes = ['style', 'topic', 'feedback']
      const content = String(body.content || '').trim()
      if (!memoryTypes.includes(body.memory_type)) return send(response, 422, { error: '记忆类型无效' })
      if (!content) return send(response, 422, { error: '记忆内容不能为空' })
      const duplicate = owned('memories', request).find(item => item.memory_type === body.memory_type && item.content === content && item.status === 'active')
      if (duplicate) return send(response, 200, { ...duplicate, duplicate: true })
      const memory = { id: nextId(state.memories), owner_id: userId(request), memory_type: body.memory_type, content, source: 'manual', provider: 'builtin', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      state.memories.push(memory)
      await saveState('memories')
      return send(response, 201, memory)
    }
    const memoryMatch = url.pathname.match(/^\/api\/memories\/(\d+)$/)
    if (memoryMatch && request.method === 'PUT') {
      const memory = owned('memories', request).find(item => item.id === Number(memoryMatch[1]))
      if (!memory) return send(response, 404, { error: '记忆不存在' })
      const body = await readJson(request)
      if (body.content !== undefined) {
        const content = String(body.content).trim()
        if (!content) return send(response, 422, { error: '记忆内容不能为空' })
        memory.content = content
      }
      if (body.status !== undefined) {
        if (!['active', 'archived'].includes(body.status)) return send(response, 422, { error: '记忆状态无效' })
        memory.status = body.status
      }
      memory.updated_at = new Date().toISOString()
      await saveState('memories')
      return send(response, 200, memory)
    }
    if (memoryMatch && request.method === 'DELETE') {
      const memory = owned('memories', request).find(item => item.id === Number(memoryMatch[1]))
      if (!memory) return send(response, 404, { error: '记忆不存在' })
      state.memories = state.memories.filter(item => item !== memory)
      await saveState('memories')
      return send(response, 204, {})
    }
    if (url.pathname === '/api/memories/extract' && request.method === 'POST') {
      const body = await readJson(request)
      const text = String(body.text || '').trim()
      if (!text) return send(response, 422, { error: '请粘贴要提炼的对话、访谈或复盘文本' })
      const configs = { primary: runtimeConfig(request, 'text_primary'), fallback: runtimeConfig(request, 'text_fallback') }
      if (!configs.primary && !configs.fallback) return send(response, 422, { error: '自动提炼需要先在 API 中心配置大模型', reason: 'llm_not_configured' })
      if (!hasAccountLlm(request)) {
        const quota = await consumeQuota(request, 'llm', llmDailyLimit)
        if (!quota.allowed) return send(response, 429, { error: `今日共享 AI 额度已用完（每人每天 ${llmDailyLimit} 次）。可在 API 中心配置自己的大模型 Key 解除限制`, retryable: false })
      }
      try {
        const result = await callLlmWithFallback(configs, [
          { role: 'system', content: '你是个人 IP 内容助理。从用户提供的文本中提炼值得长期记忆的创作偏好、选题方向和反馈事实。只输出一个 JSON 数组，每项形如 {"memory_type":"style|topic|feedback","content":"一句话记忆"}，最多 8 条；没有值得记忆的内容时输出 []。不要输出数组以外的任何文字。' },
          { role: 'user', content: text.slice(0, 8000) },
        ])
        const match = result.content.match(/\[[\s\S]*\]/)
        const parsed = JSON.parse(match ? match[0] : result.content)
        const rows = (Array.isArray(parsed) ? parsed : []).filter(item => item && ['style', 'topic', 'feedback'].includes(item.memory_type) && String(item.content || '').trim()).slice(0, 8)
        const added = []
        for (const row of rows) {
          const content = String(row.content).trim().slice(0, 200)
          if (owned('memories', request).some(item => item.memory_type === row.memory_type && item.content === content && item.status === 'active')) continue
          const memory = { id: nextId(state.memories), owner_id: userId(request), memory_type: row.memory_type, content, source: 'auto', provider: result.provider, status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          state.memories.push(memory)
          added.push(memory)
        }
        if (added.length) await saveState('memories')
        return send(response, 200, { items: added, extracted: rows.length, provider: result.provider })
      } catch (error) {
        return send(response, 502, { error: error?.message || '自动提炼失败，请稍后重试', retryable: error?.retryable !== false })
      }
    }
    if (url.pathname === '/api/vision-tasks' && request.method === 'GET') { const shootingId = url.searchParams.get('shooting_id'); return send(response, 200, owned('vision_tasks', request).filter(item => !shootingId || item.shooting_id === Number(shootingId))) }
    if (url.pathname === '/api/vision-tasks' && request.method === 'POST') { const body = await readJson(request); const ids = [...new Set((body.screenshot_file_ids || []).map(String))]; if (!ids.length) return send(response, 422, { error: '至少需要一张截图' }); const files = ids.map(id => owned('private_files', request).find(item => item.id === id)); if (files.some(file => !file)) return send(response, 422, { error: '截图不存在或无权访问' }); const task = { id: randomUUID(), owner_id: userId(request), shooting_id: body.shooting_id == null ? null : Number(body.shooting_id), screenshot_file_ids: ids, status: 'processing', result: null, error: null, match_status: 'pending', created_at: new Date().toISOString() }; state.vision_tasks.push(task); await saveState('vision_tasks'); void (async () => { try { const config = runtimeConfig(request, 'vision'); const images = files.map(file => `data:${file.mime_type};base64,${readPrivateFile(privateFileRoot, file.storage_path).toString('base64')}`); const result = await callVision(config, images, '提取截图中的播放、点赞、评论、收藏、转发、涨粉指标，返回 JSON'); task.status = 'ready'; task.result = result.content } catch (error) { task.status = 'failed'; task.error = error.message }; await saveState('vision_tasks') })(); return send(response, 202, task) }
    const visionTaskMatch = url.pathname.match(/^\/api\/vision-tasks\/([^/]+)$/)
    if (visionTaskMatch && request.method === 'GET') { const task = owned('vision_tasks', request).find(item => item.id === visionTaskMatch[1]); return task ? send(response, 200, task) : send(response, 404, { error: '视觉任务不存在' }) }
    const visionMatches = url.pathname.match(/^\/api\/vision-tasks\/([^/]+)\/matches$/)
    if (visionMatches && request.method === 'POST') { const task = owned('vision_tasks', request).find(item => item.id === visionMatches[1]); if (!task) return send(response, 404, { error: '视觉任务不存在' }); const body = await readJson(request); const candidates = owned('shooting', request).map(item => ({ resource_id: item.id, title: item.title, platform: item.platform, published_at: item.published_at || null, match_reason: item.title === body.title && item.platform === body.platform ? '平台与标题完全匹配' : '候选匹配', confidence: item.title === body.title && item.platform === body.platform ? 0.98 : 0.55 })).sort((a, b) => b.confidence - a.confidence); task.candidates = candidates; await saveState('vision_tasks'); return send(response, 200, candidates) }
    const visionConfirm = url.pathname.match(/^\/api\/vision-tasks\/([^/]+)\/confirm$/)
    if (visionConfirm && request.method === 'POST') { const task = owned('vision_tasks', request).find(item => item.id === visionConfirm[1]); if (!task) return send(response, 404, { error: '视觉任务不存在' }); if (task.match_status === 'confirmed') return send(response, 409, { error: '视觉任务已经确认' }); if (!['ready', 'failed'].includes(task.status)) return send(response, 409, { error: '视觉任务尚未完成' }); const body = await readJson(request); const shooting = owned('shooting', request).find(item => item.id === Number(body.shooting_id || task.shooting_id)); if (!shooting) return send(response, 422, { error: '拍摄条目不存在或无权访问' }); const snapshot = { id: nextId(state.performance_snapshots), owner_id: userId(request), shooting_id: shooting.id, draft_id: shooting.draft_id || null, platform: body.platform || shooting.platform, published_at: body.published_at || shooting.published_at || null, captured_at: new Date().toISOString(), metrics: body.metrics || {}, raw_model_result: task.result, status: 'confirmed' }; state.performance_snapshots.push(snapshot); task.match_status = 'confirmed'; task.status = 'confirmed'; await saveState('vision_tasks', 'performance_snapshots'); return send(response, 201, { ...task, snapshot }) }
    const visionRetry = url.pathname.match(/^\/api\/vision-tasks\/([^/]+)\/retry$/)
    if (visionRetry && request.method === 'POST') { const task = owned('vision_tasks', request).find(item => item.id === visionRetry[1]); if (!task) return send(response, 404, { error: '视觉任务不存在' }); task.status = 'processing'; task.error = null; await saveState('vision_tasks'); return send(response, 202, task) }
    if (url.pathname === '/api/performance-snapshots' && request.method === 'GET') { const draftId = url.searchParams.get('draft_id'); const shootingId = url.searchParams.get('shooting_id'); return send(response, 200, owned('performance_snapshots', request).filter(item => (!draftId || item.draft_id === Number(draftId)) && (!shootingId || item.shooting_id === Number(shootingId))).sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))) }
    if (url.pathname === '/api/performance-snapshots' && request.method === 'POST') { const body = await readJson(request); const draftId = body.draft_id == null ? null : Number(body.draft_id); const shootingId = body.shooting_id == null ? null : Number(body.shooting_id); if (draftId === null && shootingId === null) return send(response, 422, { error: '必须关联文案或拍摄条目' }); if (draftId !== null && !owned('drafts', request).some(item => item.id === draftId)) return send(response, 422, { error: '关联文案不存在或无权访问' }); if (shootingId !== null && !owned('shooting', request).some(item => item.id === shootingId)) return send(response, 422, { error: '关联拍摄条目不存在或无权访问' }); const snapshot = { id: nextId(state.performance_snapshots), owner_id: userId(request), draft_id: draftId, shooting_id: shootingId, platform: body.platform || '', published_at: body.published_at || null, captured_at: new Date().toISOString(), metrics: body.metrics || {}, raw_model_result: body.raw_model_result || null, confidence: body.confidence ?? null, status: body.status || 'pending_confirmation' }; state.performance_snapshots.push(snapshot); await saveState('performance_snapshots'); return send(response, 201, snapshot) }
    const snapshotRetrospectMatch = url.pathname.match(/^\/api\/performance-snapshots\/(\d+)\/retrospect$/)
    if (snapshotRetrospectMatch && request.method === 'POST') {
      const snapshot = owned('performance_snapshots', request).find(item => item.id === Number(snapshotRetrospectMatch[1]))
      if (!snapshot) return send(response, 404, { error: '表现快照不存在' })
      if (!snapshot.metrics || !Object.keys(snapshot.metrics).length) return send(response, 422, { error: '快照还没有指标数据，先上传表现截图或手动填写' })
      const draft = snapshot.draft_id != null ? owned('drafts', request).find(item => item.id === snapshot.draft_id) : null
      const peers = owned('performance_snapshots', request).filter(item => item.id !== snapshot.id && item.platform === snapshot.platform && Number.isFinite(Number(item.retrospect?.rate)))
      const configs = { primary: runtimeConfig(request, 'text_primary'), fallback: runtimeConfig(request, 'text_fallback') }
      let retrospect = null
      const useRetrospectLlm = Boolean(configs.primary || configs.fallback)
      if (useRetrospectLlm && !hasAccountLlm(request)) {
        const quota = await consumeQuota(request, 'llm', llmDailyLimit)
        if (!quota.allowed) useRetrospectLlm = false
      }
      if (useRetrospectLlm) {
        try {
          const result = await callLlmWithFallback(configs, [
            { role: 'system', content: '你是个人 IP 内容复盘助理。根据内容标题、平台、正文摘要和表现指标，输出 JSON 对象：{"verdict":"winner|ok|underperformed","summary":"一句话总结（不超过 60 字）","lessons":["可复用的经验，最多 3 条，每条不超过 40 字"],"drivers":["有效驱动因素，最多 3 个，每个不超过 8 字"]}。只输出 JSON。' },
            { role: 'user', content: JSON.stringify({ title: draft?.title || '', platform: snapshot.platform, metrics: snapshot.metrics, body: String(draft?.body || '').slice(0, 800) }) },
          ])
          const parsed = JSON.parse((result.content.match(/\{[\s\S]*\}/) || [result.content])[0])
          retrospect = { verdict: ['winner', 'ok', 'underperformed'].includes(parsed.verdict) ? parsed.verdict : 'ok', summary: String(parsed.summary || '').slice(0, 120), lessons: (Array.isArray(parsed.lessons) ? parsed.lessons : []).slice(0, 3).map(item => String(item).slice(0, 60)), drivers: (Array.isArray(parsed.drivers) ? parsed.drivers : []).slice(0, 3).map(item => String(item).slice(0, 10)), provider: result.provider, created_at: new Date().toISOString() }
        } catch { retrospect = null }
      }
      if (!retrospect) retrospect = retrospectDeterministic(snapshot, draft, peers)
      snapshot.retrospect = retrospect
      const addedMemories = []
      for (const lesson of retrospect.lessons.slice(0, 2)) {
        const content = `「${draft?.title || snapshot.platform}」复盘：${lesson}`.slice(0, 200)
        if (owned('memories', request).some(item => item.memory_type === 'feedback' && item.content === content && item.status === 'active')) continue
        const memory = { id: nextId(state.memories), owner_id: userId(request), memory_type: 'feedback', content, source: 'auto', provider: retrospect.provider, status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        state.memories.push(memory)
        addedMemories.push(memory)
      }
      if (addedMemories.length) await saveState('performance_snapshots', 'memories')
      else await saveState('performance_snapshots')
      return send(response, 200, { snapshot, memories_added: addedMemories.length })
    }
    if (url.pathname === '/api/usage/today' && request.method === 'GET') {
      return send(response, 200, {
        date: cstDayKey(),
        redfox: { used: quotaUsed(request, 'redfox'), limit: redfoxDailyLimit, shared: !hasAccountRedfox(request) },
        llm: { used: quotaUsed(request, 'llm'), limit: llmDailyLimit, shared: !hasAccountLlm(request) },
      })
    }
    if (url.pathname === '/api/calendar' && request.method === 'GET') {
      const monthParam = url.searchParams.get('month') || ''
      const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : new Date().toISOString().slice(0, 7)
      const dateOf = item => String(item.planned_date || item.published_at || item.captured_at || item.created_at || '').slice(0, 10)
      const entries = []
      for (const draft of owned('drafts', request)) entries.push({ type: 'draft', id: draft.id, title: draft.title, platform: draft.platform, status: draft.status === 'published' ? 'published' : draft.workflow_status === 'ready_to_shoot' ? 'ready' : 'draft', date: dateOf(draft) })
      for (const item of owned('shooting', request)) entries.push({ type: 'shooting', id: item.id, title: item.title, platform: item.platform, status: item.status, date: dateOf(item) })
      for (const topic of owned('topics', request)) if (topic.workflow_status === 'approved') entries.push({ type: 'topic', id: topic.id, title: topic.title, platform: '', status: 'approved', date: dateOf(topic) })
      return send(response, 200, { month, entries: entries.filter(entry => entry.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)) })
    }
    if (url.pathname === '/api/research' && request.method === 'GET') {
      const params = url.searchParams
      const hasQuery = ['q', 'platform', 'sort', 'page'].some(key => params.get(key))
      if (!hasQuery) return send(response, 200, owned('research', request))
      const query = (params.get('q') || '').trim().toLowerCase()
      const platform = params.get('platform') || ''
      const sort = ['latest', 'discussions', 'growth', 'fit'].includes(params.get('sort')) ? params.get('sort') : 'latest'
      const page = Math.max(1, Number(params.get('page')) || 1)
      const pageSize = 50
      let items = owned('research', request)
      if (query) items = items.filter(item => String(item.title).toLowerCase().includes(query) || String(item.author || '').toLowerCase().includes(query))
      if (platform) items = items.filter(item => item.platform === platform)
      items = [...items].sort((a, b) => sort === 'discussions' ? (b.metrics?.discussions || 0) - (a.metrics?.discussions || 0) : sort === 'growth' ? (b.metrics?.growth || 0) - (a.metrics?.growth || 0) : sort === 'fit' ? 0 : String(b.captured_at || '').localeCompare(String(a.captured_at || '')))
      if (sort === 'fit') {
        const profile = userDocument('profile', request)
        const strategy = userDocument('strategy', request)
        items = items.map(item => ({ ...item, fit: fitScore(item, profile, strategy) })).sort((a, b) => b.fit.score - a.fit.score)
      }
      const total = items.length
      const start = (page - 1) * pageSize
      return send(response, 200, { items: items.slice(start, start + pageSize), total, page, page_size: pageSize })
    }
    if (url.pathname === '/api/research/search' && request.method === 'POST') {
      const body = await readJson(request)
      const keyword = String(body.keyword || '').trim()
      if (!keyword) return send(response, 422, { error: '关键词为必填项' })
      const platform = researchPlatforms.includes(body.platform) && body.platform !== '全平台' ? body.platform : '小红书'
      const capturedAt = new Date().toISOString()
      const outcome = await runRedFox(request, {
        demo: () => demoSearchWork(keyword, platform),
        apply: adapter => adapter.searchWork({ platform, keyword }),
      })
      if (!outcome.ok) return send(response, outcome.error.code === 'QUOTA_EXCEEDED' ? 429 : 502, { error: outcome.error.message, source: 'redfox-adapter', retryable: outcome.error.retryable === true, items: owned('research', request) })
      const sourceTag = outcome.demo ? 'demo' : outcome.result.source
      const items = persistResearch(userId(request), outcome.result.items.map(item => ({ ...item, source: sourceTag })), { query: keyword, sourceTag, capturedAt })
      await saveState('research')
      return send(response, 200, { items: owned('research', request), added: items.length, source: sourceTag, keyword, platform })
    }
    if (url.pathname === '/api/research/suggest' && request.method === 'GET') {
      const id = userId(request)
      const frequency = new Map()
      const bump = word => { const key = String(word).trim(); if (key.length >= 2 && key.length <= 20) frequency.set(key, (frequency.get(key) || 0) + 1) }
      for (const pillar of userDocument('positioning', request).pillars || []) bump(pillar)
      for (const material of owned('materials', request)) for (const topic of material.extracted_fields?.candidate_topics || []) bump(topic)
      for (const research of owned('research', request)) if (research.query) bump(research.query)
      const suggestions = [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word]) => word)
      return send(response, 200, { suggestions: suggestions.length ? suggestions : ['个人 IP', '内容创业', '知识变现', '副业起步'] })
    }
    if (url.pathname === '/api/research/hot-search' && request.method === 'POST') {
      const body = await readJson(request)
      const platform = researchPlatforms.includes(body.platform) && body.platform !== '全平台' ? body.platform : '小红书'
      const outcome = await runRedFox(request, {
        demo: () => demoHotSearch(platform),
        apply: adapter => adapter.hotSearch({ platform }),
      })
      if (!outcome.ok) return send(response, outcome.error.code === 'QUOTA_EXCEEDED' ? 429 : 502, { error: outcome.error.message, source: 'redfox-adapter', retryable: outcome.error.retryable === true })
      return send(response, 200, { platform, source: outcome.demo ? 'demo' : outcome.result.source, items: outcome.result.items })
    }
    if (url.pathname === '/api/research/keyword-hot-search' && request.method === 'POST') {
      const body = await readJson(request)
      const keyword = String(body.keyword || '').trim()
      if (!keyword) return send(response, 422, { error: '关键词为必填项' })
      const days = Math.min(Math.max(Number(body.days) || 7, 1), 30)
      const outcome = await runRedFox(request, {
        demo: () => demoHotSearch('小红书'),
        apply: adapter => adapter.keywordHotSearch({ keywords: [keyword], platforms: Array.isArray(body.platforms) ? body.platforms : [], days }),
      })
      if (!outcome.ok) return send(response, outcome.error.code === 'QUOTA_EXCEEDED' ? 429 : 502, { error: outcome.error.message, source: 'redfox-adapter', retryable: outcome.error.retryable === true })
      return send(response, 200, { keyword, days, source: outcome.demo ? 'demo' : outcome.result.source, items: outcome.result.items })
    }
    if (url.pathname === '/api/research/hot-search/collect' && request.method === 'POST') {
      const body = await readJson(request)
      const entries = Array.isArray(body.entries) ? body.entries.filter(entry => entry && typeof entry.title === 'string' && entry.title.trim()) : []
      if (!entries.length) return send(response, 422, { error: '至少选择一条热搜条目' })
      const capturedAt = new Date().toISOString()
      const platform = researchPlatforms.includes(body.platform) && body.platform !== '全平台' ? body.platform : '小红书'
      const items = persistResearch(userId(request), entries.map(entry => ({ platform: entry.platform || platform, title: String(entry.title).trim(), author: '', url: entry.url || null, metrics: { discussions: Number(entry.heat || 0), growth: 0 }, source: 'redfox-hot-search' })), { query: '热搜榜', sourceTag: 'redfox-hot-search', capturedAt })
      await saveState('research')
      return send(response, 200, { added: items.length, items: owned('research', request) })
    }
    const researchCollectMatch = url.pathname.match(/^\/api\/research\/(\d+)\/collect$/)
    if (researchCollectMatch && request.method === 'POST') { const item = owned('research', request).find(existing => existing.id === Number(researchCollectMatch[1])); if (!item) return send(response, 404, { error: '研究条目不存在' }); const existing = owned('materials', request).find(material => material.source_type === 'research' && material.source_id === item.id && !material.deleted_at); if (existing) return send(response, 200, { ...existing, duplicate: true }); const material = { id: nextId(state.materials), owner_id: userId(request), name: item.title, material_kind: 'hotspot', source_type: 'research', source_id: item.id, source_refs: [sourceRef('research', item.id)], url: item.url || null, content: item.title, status: 'ready', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; state.materials.push(material); item.collected = true; await saveState('materials', 'research'); return send(response, 201, material) }
    if (url.pathname === '/api/research/similar' && request.method === 'POST') {
      const body = await readJson(request)
      const account = String(body.account || '').trim()
      if (!account) return send(response, 422, { error: '账号名称为必填项' })
      const platform = researchPlatforms.includes(body.platform) && body.platform !== '全平台' ? body.platform : '小红书'
      const outcome = await runRedFox(request, {
        demo: () => demoSimilarAccounts(platform, account),
        apply: adapter => adapter.similarAccounts({ platform, account }),
      })
      if (!outcome.ok) return send(response, outcome.error.code === 'QUOTA_EXCEEDED' ? 429 : 502, { error: outcome.error.message, source: 'redfox-adapter', retryable: outcome.error.retryable === true })
      return send(response, 200, { platform, account, source: outcome.demo ? 'demo' : outcome.result.source, items: outcome.result.items })
    }
    const draftComplianceMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/compliance$/)
    if (draftComplianceMatch && request.method === 'POST') {
      const draft = owned('drafts', request).find(item => item.id === Number(draftComplianceMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在' })
      const text = String((await readJson(request).catch(() => ({}))).text ?? draft.body)
      const outcome = await runRedFox(request, {
        demo: () => demoProhibitedCheck(text),
        apply: adapter => adapter.prohibitedCheck({ text }),
      })
      if (!outcome.ok) return send(response, outcome.error.code === 'QUOTA_EXCEEDED' ? 429 : 502, { error: outcome.error.message, source: 'redfox-adapter', retryable: outcome.error.retryable === true })
      return send(response, 200, { draft_id: draft.id, source: outcome.demo ? 'demo' : outcome.result.source, hits: outcome.result.hits, checked_length: outcome.result.checked_length })
    }
    if (url.pathname === '/api/research/refresh' && request.method === 'POST') {
      const capturedAt = new Date().toISOString()
      const outcome = await runRedFox(request, {
        demo: () => ({ items: [demoTrending()] }),
        apply: async adapter => ({ items: await adapter.trending({ platform: '小红书', query: '个人 IP 商业创业' }) }),
      })
      if (!outcome.ok) return send(response, outcome.error.code === 'QUOTA_EXCEEDED' ? 429 : 502, { error: outcome.error.message, source: 'redfox-adapter', retryable: outcome.error.retryable === true, items: owned('research', request) })
      const sourceTag = outcome.demo ? 'demo' : 'redfox'
      const items = persistResearch(userId(request), outcome.result.items.map(item => ({ ...item, source: sourceTag })), { query: '个人 IP 商业创业', sourceTag, capturedAt })
      await saveState('research')
      return send(response, 200, { items: owned('research', request), source: sourceTag, refreshed_at: capturedAt })
    }
    if (url.pathname === '/api/settings/test' && request.method === 'POST') {
      const body = await readJson(request)
      const type = body.type
      if (type !== 'llm' && type !== 'redfox') return send(response, 422, { error: '不支持的测试类型' })
      let target
      try {
        target = new URL(String(body.base_url || ''))
      } catch {
        return send(response, 422, { error: 'Base URL 格式不正确' })
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return send(response, 422, { error: 'Base URL 仅支持 http 或 https' })
      const apiKey = String(body.api_key || '')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const testUrl = type === 'llm'
        ? new URL('/models', target)
        : new URL('/story/api/hotKeyword/list', target)
      const pad = value => String(value).padStart(2, '0')
      const day = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      const now = new Date()
      const windowStart = new Date(now.getTime() - 24 * 3_600_000)
      try {
        const testHeaders = type === 'llm'
          ? { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }
          : { accept: 'application/json', 'content-type': 'application/json', ...(apiKey ? { REDFOX_API_KEY: apiKey } : {}) }
        const testResponse = await fetch(testUrl, {
          headers: testHeaders,
          ...(type === 'redfox' ? { method: 'POST', body: JSON.stringify({ startDate: `${day(windowStart)} 00:00:00`, endDate: `${day(now)} 00:00:00` }) } : {}),
          signal: controller.signal,
        })
        if (!testResponse.ok) {
          return send(response, 200, { ok: false, status: testResponse.status, error: testResponse.status === 401 || testResponse.status === 403 ? '认证失败，请检查 API Key' : `服务返回 ${testResponse.status}` })
        }
        return send(response, 200, { ok: true })
      } catch (error) {
        const message = error?.name === 'AbortError' ? '连接超时（8 秒）' : '服务连接失败，请检查 Base URL'
        return send(response, 200, { ok: false, error: message })
      } finally {
        clearTimeout(timeout)
      }
    }
    const analyzeMatch = url.pathname.match(/^\/api\/research\/(\d+)\/analyze$/)
    if (analyzeMatch && request.method === 'POST') {
      const item = owned('research', request).find(existing => existing.id === Number(analyzeMatch[1]))
      if (!item) return send(response, 404, { error: '研究条目不存在' })
      item.analysis = { hook: '公开失败账本', audience: '正在经营个人 IP 的创业者', pain_point: '流量内容缺少可信证据', thesis: '真实经营数据能转化为信任资产', structure: ['反常识开场', '真实案例', '方法拆解', '评论区提问'], quotes: ['可信度来自持续交付'], cta: '分享你最近一次复盘', evidence_refs: item.source_refs, transferable_patterns: ['用具体过程替代空泛观点'], confidence: 0.86 }
      const extracted = state.structures.find(existing => existing.owner_id === userId(request) && existing.source_kind === 'research' && existing.source_id === item.id)
      if (extracted) {
        extracted.steps = [...item.analysis.structure]
        extracted.title = item.title
        extracted.updated_at = new Date().toISOString()
      } else {
        state.structures.push({ id: nextId(state.structures), owner_id: userId(request), title: item.title, steps: [...item.analysis.structure], platform: item.platform || '通用', content_type: '观点', source_kind: 'research', source_id: item.id, source_refs: item.source_refs || [], method_category: '内容结构', favorite: false, usage_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      }
         await saveState('drafts', 'structures')
      return send(response, 200, item)
    }
    if (url.pathname === '/api/topics/generate' && request.method === 'POST') {
      const body = await readJson(request)
      const sourceRefs = (body.research_ids || []).filter(id => owned('research', request).some(item => item.id === id)).map(id => sourceRef('research', id)).concat((body.material_ids || []).filter(id => owned('materials', request).some(item => item.id === id)).map(id => sourceRef('material', id)))
      if (!validateSourceRefs(sourceRefs) || !sourceRefs.length) return send(response, 422, { error: '选题生成至少需要一个有效来源' })
      const profile = userDocument('profile', request)
      const gaps = profileGaps(profile)
      if (gaps.length) return send(response, 422, { error: 'IP 档案资料不足', missing_fields: gaps, retryable: true })
      const topics = ['把一次失败复盘，变成客户愿意收藏的内容', '个人 IP 最值钱的证据，藏在你的交付过程里', '从泛流量进入信任区：创业者内容的三步承接'] .map((title, index) => ({ id: nextId(state.topics) + index, owner_id: userId(request), title, rationale: '结合定位档案、研究素材和 IP 核心目标生成', strategy_layer: ['reach', 'trust', 'conversion'][index], content_job: ['获得陌生用户注意', '展示真实经验与方法', '推动咨询或合作线索'][index], goal_refs: userDocument('positioning', request).monetization_goals.length ? ['monetization'] : ['positioning'], source_refs: sourceRefs, fact_risk: 'needs_review', generation_context: { profile_version: profile.version, source_count: sourceRefs.length, memory_count: activeMemories(userId(request)).length } }))
      state.topics.push(...topics.map(defaultTopicFields))
       await saveState('topics')
       await saveState('drafts')
      return send(response, 201, topics.map(defaultTopicFields))
    }
    const topicEvaluateMatch = url.pathname.match(/^\/api\/topics\/(\d+)\/evaluate$/)
    if (topicEvaluateMatch && request.method === 'POST') {
      const topic = owned('topics', request).find(item => item.id === Number(topicEvaluateMatch[1]))
      if (!topic) return send(response, 404, { error: '选题不存在', code: 'resource_not_found' })
      if (['approved', 'in_production', 'completed'].includes(topic.workflow_status)) return send(response, 409, { error: '当前选题状态不允许重新评估', code: 'invalid_transition' })
      const body = await readJson(request)
      if (topic.evaluation && topic.workflow_status !== 'needs_revision' && !body.force) return send(response, 200, topic)
      const refs = Array.isArray(topic.source_refs) ? topic.source_refs : []
      const context = buildContentContext(state, { ownerId: userId(request), topicId: topic.id, task: { researchIds: refs.filter(ref => ref.type === 'research').map(ref => Number(ref.id)), materialIds: refs.filter(ref => ref.type === 'material').map(ref => Number(ref.id)) } })
      const missing = profileGaps(context.profile)
      if (missing.length) return send(response, 422, { status: 'failed', code: 'missing_context', error: '选题评估缺少 IP 档案资料', message: '选题评估缺少 IP 档案资料', missing_fields: missing, retryable: true })
      topic.evaluation = evaluateTopic(topic, context)
      topic.workflow_status = 'evaluated'
      topic.decision = topic.evaluation.decision
      topic.evidence = topic.evaluation.evidence
      topic.suggestions = topic.evaluation.suggestions
      topic.evaluated_at = topic.evaluation.evaluated_at
      await saveState('topics')
      return send(response, 200, topic)
    }
    const topicDecisionMatch = url.pathname.match(/^\/api\/topics\/(\d+)\/decision$/)
    if (topicDecisionMatch && request.method === 'PUT') {
      const topic = owned('topics', request).find(item => item.id === Number(topicDecisionMatch[1]))
      if (!topic) return send(response, 404, { error: '选题不存在', code: 'resource_not_found' })
      const body = await readJson(request)
      if (!['do', 'revise', 'defer'].includes(body.decision)) return send(response, 422, { error: 'decision 必须是 do、revise 或 defer', code: 'validation_failed' })
      if (!topic.evaluation) return send(response, 409, { error: '请先完成选题评估', code: 'invalid_transition' })
      const nextStatus = body.decision === 'do' ? 'approved' : 'needs_revision'
      if (topic.workflow_status === nextStatus && topic.decision === body.decision) return send(response, 200, topic)
      if (topic.workflow_status !== 'evaluated') return send(response, 409, { error: '当前选题状态不允许此决策', code: 'invalid_transition' })
      topic.decision = body.decision
      topic.decision_reason = String(body.reason || '').trim()
      topic.workflow_status = nextStatus
      topic.decided_at = new Date().toISOString()
      topic.decided_by = userId(request)
      await saveState('topics')
      return send(response, 200, topic)
    }
    const draftCheckMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/checks\/(persona|quality|publish)$/)
    if (draftCheckMatch && request.method === 'POST') {
      const draft = owned('drafts', request).find(item => item.id === Number(draftCheckMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在', code: 'resource_not_found' })
      const body = await readJson(request)
      const checkName = draftCheckMatch[2]
      const currentVersion = Number(draft.version || 1)
      if (draft.approval?.status === 'approved') return send(response, 409, { error: '请先撤回人工确认，再重新运行检查', code: 'invalid_transition' })
      const checkKey = checkName === 'publish' ? 'publish_checklist' : checkName
      const existing = draft.checks?.[checkKey]
      if (existing?.draft_version === currentVersion && !body.force) return send(response, 200, draft)
      const profile = userDocument('profile', request)
      if (checkName === 'quality' && (!draft.checks?.persona || draft.checks.persona.draft_version !== currentVersion)) return send(response, 409, { error: '请先完成当前版本的人设检查', code: 'invalid_transition' })
      if (checkName === 'publish' && (!draft.checks?.quality || draft.checks.quality.draft_version !== currentVersion || draft.checks.quality.status !== 'passed')) return send(response, 409, { error: '请先通过当前版本的质量门', code: 'invalid_transition' })
      const check = checkName === 'persona' ? checkPersona(draft, profile) : checkName === 'quality' ? checkQuality(draft, profile) : checkPublishChecklist(draft)
      draft.checks = { ...(draft.checks || {}), [checkKey]: check }
      draft.workflow_status = checkName === 'persona' ? 'persona_checked' : check.status === 'blocked' ? 'needs_revision' : checkName === 'quality' ? 'quality_checked' : 'publish_ready'
      draft.updated_at = new Date().toISOString()
      await saveState('drafts')
      return send(response, 200, draft)
    }
    if (url.pathname === '/api/drafts/generate' && request.method === 'POST') {
      const body = await readJson(request)
      const structure = body.structure_id ? owned('structures', request).find(item => item.id === body.structure_id) : null
      const hasAnchor = Boolean(body.topic_id || (body.topic && String(body.topic.title || '').trim()) || structure)
      if (!hasAnchor) return send(response, 422, { error: '至少需要一个创作锚点' })
      const persistedTopic = owned('topics', request).find(item => item.id === body.topic_id)
      const topic = persistedTopic || body.topic || { title: '未命名选题', strategy_layer: 'trust', goal_refs: [] }
      const quoteMaterials = (body.quote_ids || []).map(id => owned('materials', request).find(item => item.id === id && !item.deleted_at)).filter(item => item && item.material_kind === 'quote')
      const experienceMaterials = (body.experience_ids || []).map(id => owned('materials', request).find(item => item.id === id && !item.deleted_at)).filter(item => item && item.material_kind === 'experience')
      if (structure) {
        structure.usage_count += 1
        structure.updated_at = new Date().toISOString()
      }
      const requestedHook = String(body.hook_text || '').trim()
      const hookValidation = requestedHook ? validateHookText(requestedHook) : null
      if (hookValidation?.status === 'blocked') return send(response, 422, { error: 'Hook 校验未通过', code: 'validation_failed', evidence: hookValidation.evidence })
      const variantGroupId = randomUUID()
      const composeBody = (platform) => {
        const parts = [topic.title, `平台：${platform}`]
        if (requestedHook) parts.push(`Hook：${requestedHook}`)
        if (structure) parts.push(`结构：${structure.steps.join(' → ')}`)
        if (quoteMaterials.length) parts.push(`金句参考：\n${quoteMaterials.map((item, index) => `${index + 1}. ${item.content}`).join('\n')}`)
        if (experienceMaterials.length) parts.push(`我的经历素材：\n${experienceMaterials.map(item => `- ${item.content}`).join('\n')}`)
        const memories = activeMemories(userId(request)).filter(item => item.memory_type === 'style' || item.memory_type === 'feedback')
        if (memories.length) parts.push(`创作风格要求：\n${memories.map(item => `- ${item.content}`).join('\n')}`)
        parts.push('从一个真实场景开始，讲清楚过程、证据和可执行的一步。')
        return parts.filter(Boolean).join('\n\n')
      }
      const atomRefs = [...quoteMaterials, ...experienceMaterials].map(item => sourceRef('material', item.id))
      const sourceRefs = [...(topic.source_refs || []), ...(structure ? [sourceRef('structure', structure.id)] : []), ...atomRefs]
      const drafts = ['小红书', '抖音', '视频号', '公众号'].map((platform, index) => defaultDraftWorkflowFields({ id: nextId(state.drafts) + index, owner_id: userId(request), topic_id: topic.id || null, platform, title: topic.title, body: composeBody(platform), version: 1, strategy_layer: topic.strategy_layer, goal_refs: topic.goal_refs || [], source_refs: sourceRefs, fact_check_status: 'needs_review', status: 'draft', workflow_status: 'draft', hooks: [], selected_hook_id: null, selected_hook: null, platform_variants: [], variant_group_id: variantGroupId, variant_type: 'platform', generation_context: { topic_id: topic.id || null, structure_id: structure?.id || null, material_ids: [...quoteMaterials, ...experienceMaterials].map(item => item.id), hook_text: requestedHook || null }, created_at: new Date().toISOString() }))
      state.drafts.push(...drafts)
       await saveState('drafts')
      return send(response, 201, drafts)
    }
    if (url.pathname === '/api/drafts' && request.method === 'GET') return send(response, 200, owned('drafts', request))
    const draftAdaptMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/adapt$/)
    if (draftAdaptMatch && request.method === 'POST') {
      const body = await readJson(request)
      const draft = owned('drafts', request).find(item => item.id === Number(draftAdaptMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在' })
      const platform = researchPlatforms.includes(body.platform) && body.platform !== '全平台' ? body.platform : draft.platform
      if (!platform || platform === '全平台') return send(response, 422, { error: '请选择一个发布平台' })
      const profile = userDocument('profile', request)
      const hits = prohibitedWordlist.filter(entry => String(draft.body || '').includes(entry.word)).map(entry => ({ ...entry }))
      const configs = { primary: runtimeConfig(request, 'text_primary'), fallback: runtimeConfig(request, 'text_fallback') }
      let adaptation = null
      const useAdaptLlm = Boolean(configs.primary || configs.fallback)
      if (useAdaptLlm && !hasAccountLlm(request)) {
        const quota = await consumeQuota(request, 'llm', llmDailyLimit)
        if (!quota.allowed) useAdaptLlm = false
      }
      if (useAdaptLlm) {
        try {
          const memories = activeMemories(userId(request)).filter(item => item.memory_type === 'style' || item.memory_type === 'feedback')
          const result = await callLlmWithFallback(configs, [
            { role: 'system', content: `你是多平台内容发布适配专家。把给定的母版文案改写为适合「${platform}」发布的版本：调整标题（符合平台字数习惯）、正文（符合平台格式、语气与长度）、并给出 3-6 个话题标签（公众号除外，标签可为空数组）。只输出 JSON：{"title":"...","body":"...","hashtags":["#标签"]}。` },
            { role: 'user', content: JSON.stringify({ title: draft.title, body: String(draft.body || '').slice(0, 3000), style_memories: memories.map(item => item.content).slice(0, 5) }) },
          ])
          const parsed = JSON.parse((result.content.match(/\{[\s\S]*\}/) || [result.content])[0])
          if (String(parsed.body || '').trim()) {
            adaptation = { title: String(parsed.title || draft.title).slice(0, 64), body: String(parsed.body), hashtags: (Array.isArray(parsed.hashtags) ? parsed.hashtags : []).slice(0, 6).map(tag => `#${String(tag).replace(/^#/, '').trim()}`).filter(tag => tag.length > 1), provider: result.provider }
          }
        } catch { adaptation = null }
      }
      if (!adaptation) adaptation = deterministicAdaptation(draft, platform, profile)
      const adapted = { ...adaptation, checklist: buildChecklist(platform, adaptation.body, hits), updated_at: new Date().toISOString() }
      draft.adaptations = { ...(draft.adaptations || {}), [platform]: adapted }
      await saveState('drafts')
      return send(response, 200, draft)
    }
    const draftDeaiMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/deai$/)
    if (draftDeaiMatch && request.method === 'POST') {
      const draft = owned('drafts', request).find(item => item.id === Number(draftDeaiMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在' })
      const configs = { primary: runtimeConfig(request, 'text_primary'), fallback: runtimeConfig(request, 'text_fallback') }
      if (!configs.primary && !configs.fallback) return send(response, 422, { error: '去 AI 感改写需要先在 API 中心配置大模型', reason: 'llm_not_configured' })
      if (!hasAccountLlm(request)) {
        const quota = await consumeQuota(request, 'llm', llmDailyLimit)
        if (!quota.allowed) return send(response, 429, { error: `今日共享 AI 额度已用完（每人每天 ${llmDailyLimit} 次）。可在 API 中心配置自己的大模型 Key 解除限制`, retryable: false })
      }
      try {
        const memories = activeMemories(userId(request)).filter(item => item.memory_type === 'style' || item.memory_type === 'feedback')
        const result = await callLlmWithFallback(configs, [
          { role: 'system', content: '你是去 AI 味的文案改写助手。把给定文案改写得更像真人创作者写的：口语化、加入具体细节和真实语气、拆掉排比与套话、不用"首先/其次/总而言之"、保留原有信息与观点结构。只输出改写后的正文，不要任何解释。' },
          { role: 'user', content: JSON.stringify({ body: String(draft.body || '').slice(0, 3000), style_memories: memories.map(item => item.content).slice(0, 5) }) },
        ])
        const content = String(result.content || '').trim()
        if (!content) throw new Error('改写结果为空')
        return send(response, 200, { content, provider: result.provider })
      } catch (error) {
        return send(response, 502, { error: error?.message || '改写失败，请稍后重试', retryable: true })
      }
    }
    const draftHooksMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/hooks$/)
    if (draftHooksMatch && request.method === 'POST') {
      const draft = owned('drafts', request).find(item => item.id === Number(draftHooksMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在', code: 'resource_not_found' })
      const body = await readJson(request)
      if (draft.approval?.status === 'approved') return send(response, 409, { error: '请先撤回人工确认，再重新生成 Hook', code: 'invalid_transition' })
      if (draft.hooks?.length && !body.force) return send(response, 200, draft)
      draft.hooks = generateHookCandidates(draft, { sourceRefs: draft.source_refs || [] })
      draft.workflow_status = 'hooks_ready'
      draft.updated_at = new Date().toISOString()
      await saveState('drafts')
      return send(response, 200, draft)
    }
    const draftApprovalMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/(approve|revoke-approval)$/)
    if (draftApprovalMatch && request.method === 'POST') {
      const draft = owned('drafts', request).find(item => item.id === Number(draftApprovalMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在', code: 'resource_not_found' })
      const body = await readJson(request)
      if (!Number.isInteger(body.version) || body.version < 1) return send(response, 422, { error: '必须提供有效的草稿版本', code: 'validation_failed' })
      const action = draftApprovalMatch[2]
      const existingShooting = owned('shooting', request).find(item => item.draft_id === draft.id)
      if (action === 'approve') {
        if (draft.approval?.status === 'approved' && draft.approval.draft_version === body.version) return send(response, 200, { status: 'approved', draft, shooting: existingShooting || null })
        if (body.version !== draft.version) return send(response, 409, { error: '草稿版本冲突', code: 'version_conflict', current: draft })
        if (existingShooting?.status === 'published') return send(response, 409, { error: '已发布内容不能重复确认', code: 'invalid_transition' })
        const errors = validateApprovalReadiness(draft)
        if (errors.length) return send(response, 409, { error: errors[0], code: 'invalid_transition', reasons: errors })
        const now = new Date().toISOString()
        draft.history ||= []
        draft.history.push({ ...structuredClone(draft), history: undefined, version: draft.version, snapshot_at: now })
        draft.approval = approveDraftRecord(draft, userId(request), now)
        draft.workflow_status = 'ready_to_shoot'
        draft.status = 'ready_to_shoot'
        draft.version += 1
        draft.updated_at = now
        let shooting = existingShooting
        if (!shooting) {
          shooting = { id: nextId(state.shooting), owner_id: userId(request), draft_id: draft.id, title: draft.title, platform: draft.platform, script: draft.body, status: 'ready_to_shoot', approval_required: true, approval_draft_version: draft.approval.draft_version, version: 1, date: now.slice(0, 10), strategy_layer: draft.strategy_layer, goal_refs: structuredClone(draft.goal_refs || []), source_refs: structuredClone(draft.source_refs || []), created_at: now, updated_at: now }
          state.shooting.push(shooting)
        } else {
          Object.assign(shooting, { title: draft.title, platform: draft.platform, script: draft.body, status: 'ready_to_shoot', approval_required: true, approval_draft_version: draft.approval.draft_version, strategy_layer: draft.strategy_layer, goal_refs: structuredClone(draft.goal_refs || []), source_refs: structuredClone(draft.source_refs || []), version: (shooting.version || 1) + 1, updated_at: now })
        }
        await saveState('drafts', 'shooting')
        return send(response, 200, { status: 'approved', draft, shooting })
      }
      if (draft.approval?.status === 'revoked' && draft.approval.revoked_draft_version === body.version) return send(response, 200, { status: 'revoked', draft, shooting: existingShooting || null })
      if (body.version !== draft.version) return send(response, 409, { error: '草稿版本冲突', code: 'version_conflict', current: draft })
      const reason = String(body.reason || '').trim()
      if (!reason) return send(response, 422, { error: '撤回原因不能为空', code: 'validation_failed' })
      if (draft.approval?.status !== 'approved' || draft.workflow_status !== 'ready_to_shoot') return send(response, 409, { error: '只有已确认且未发布的草稿可以撤回', code: 'invalid_transition' })
      if (draft.status === 'published' || existingShooting?.status === 'published') return send(response, 409, { error: '已发布内容不能撤回确认', code: 'invalid_transition' })
      const now = new Date().toISOString()
      draft.history ||= []
      draft.history.push({ ...structuredClone(draft), history: undefined, version: draft.version, snapshot_at: now })
      draft.approval = revokeDraftRecord(draft, userId(request), reason, now)
      draft.workflow_status = 'needs_revision'
      draft.status = 'draft'
      draft.version += 1
      draft.updated_at = now
      if (existingShooting) Object.assign(existingShooting, { status: 'needs_revision', version: (existingShooting.version || 1) + 1, updated_at: now })
      await saveState('drafts', 'shooting')
      return send(response, 200, { status: 'revoked', draft, shooting: existingShooting || null })
    }
    const draftCopyMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/copy$/)
    if (draftCopyMatch && request.method === 'POST') {
      const original = owned('drafts', request).find(item => item.id === Number(draftCopyMatch[1]))
      if (!original) return send(response, 404, { error: '草稿不存在' })
       const copy = { ...structuredClone(original), id: nextId(state.drafts), title: `${original.title}（副本）`, status: 'draft', workflow_status: original.selected_hook_id ? 'content_ready' : 'draft', checks: { persona: null, quality: null, publish_checklist: null }, approval: defaultApproval(), version: 1, history: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      state.drafts.push(copy)
       await saveState('drafts')
      return send(response, 201, copy)
    }
    const draftHistoryMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/history$/)
    if (draftHistoryMatch && request.method === 'GET') {
      const draft = owned('drafts', request).find(item => item.id === Number(draftHistoryMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在' })
      return send(response, 200, draft.history || [{ version: draft.version, title: draft.title, body: draft.body, created_at: draft.updated_at || draft.created_at }])
    }
    const draftRestoreMatch = url.pathname.match(/^\/api\/drafts\/(\d+)\/restore$/)
    if (draftRestoreMatch && request.method === 'POST') {
      const draft = owned('drafts', request).find(item => item.id === Number(draftRestoreMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在' })
      const body = await readJson(request)
      if (draft.approval?.status === 'approved') return send(response, 409, { error: '请先撤回人工确认，再恢复历史版本', code: 'invalid_transition' })
      const snapshot = (draft.history || []).find(item => item.version === body.version)
      if (!snapshot) return send(response, 404, { error: '历史版本不存在' })
      draft.history ||= []
      draft.history.push({ ...structuredClone(draft), history: undefined, version: draft.version, snapshot_at: new Date().toISOString() })
      for (const key of ['topic_id', 'platform', 'title', 'body', 'strategy_layer', 'goal_refs', 'source_refs', 'fact_check_status']) {
        if (snapshot[key] !== undefined) draft[key] = structuredClone(snapshot[key])
      }
      draft.version += 1
      draft.updated_at = new Date().toISOString()
       await saveState('drafts')
      return send(response, 200, draft)
    }
    if (url.pathname === '/api/shooting/today' && request.method === 'GET') return send(response, 200, owned('shooting', request))
    const shootingMatch = url.pathname.match(/^\/api\/shooting\/(\d+)$/)
    if (shootingMatch && request.method === 'PUT') {
      const body = await readJson(request)
      const item = owned('shooting', request).find(existing => existing.id === Number(shootingMatch[1]))
      if (!item) return send(response, 404, { error: '拍摄条目不存在' })
      if (body.status !== undefined && !shootingStatuses.has(body.status)) return send(response, 422, { error: '不支持的拍摄状态' })
      if (body.planned_date !== undefined && body.planned_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.planned_date))) return send(response, 422, { error: '排期日期格式应为 YYYY-MM-DD' })
      if (item.approval_required && ['in_progress', 'completed', 'published'].includes(body.status)) {
        const draft = owned('drafts', request).find(existing => existing.id === item.draft_id)
        if (!draft || draft.approval?.status !== 'approved') return send(response, 409, { error: '关联草稿未经有效人工确认', code: 'invalid_transition' })
      }
       if (body.version !== undefined && body.version !== item.version) return send(response, 409, { error: '拍摄清单版本冲突', current: item, conflict: createConflict(request, 'shooting', item.id, body.version, body, item) })
      const updates = { ...body }
      delete updates.owner_id
      Object.assign(item, updates, { updated_at: new Date().toISOString() })
      item.version = (item.version || 1) + 1
       await saveState('shooting')
      return send(response, 200, item)
    }
    const draftMatch = url.pathname.match(/^\/api\/drafts\/(\d+)$/)
    if (draftMatch && request.method === 'PUT') {
      const body = await readJson(request)
      const draft = owned('drafts', request).find(existing => existing.id === Number(draftMatch[1]))
      if (!draft) return send(response, 404, { error: '草稿不存在' })
      if (body.status !== undefined && !draftStatuses.has(body.status)) return send(response, 422, { error: '不支持的草稿状态' })
      if (body.planned_date !== undefined && body.planned_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.planned_date))) return send(response, 422, { error: '排期日期格式应为 YYYY-MM-DD' })
      if (body.approval !== undefined || body.checks !== undefined || body.workflow_status !== undefined) return send(response, 422, { error: '确认状态和检查结果只能通过专用接口更新', code: 'validation_failed' })
      if (body.status === 'ready_to_shoot') return send(response, 409, { error: '请通过人工确认接口进入拍摄', code: 'invalid_transition' })
      if (body.status === 'published') return send(response, 409, { error: '请通过拍摄清单完成发布', code: 'invalid_transition' })
      if (draft.approval?.status === 'approved' && body.status !== undefined && body.status !== draft.status) return send(response, 409, { error: '请先撤回人工确认，再修改草稿状态', code: 'invalid_transition' })
       if (body.version !== undefined && body.version !== draft.version) return send(response, 409, { error: '草稿版本冲突', current: draft, conflict: createConflict(request, 'draft', draft.id, body.version, body, draft) })
      const draftValidationError = validateDraftUpdate(body, draft)
      let selectedHook = null
      if (body.selected_hook_id !== undefined) {
        try { selectedHook = selectHook(draft, body.selected_hook_id) } catch (error) { return send(response, 422, { error: error.message, code: error.code || 'validation_failed' }) }
      }
      if (draftValidationError) return send(response, 422, { error: draftValidationError })
      const updates = { ...body }
      delete updates.owner_id
      delete updates.version
      delete updates.workflow_status
      const contentChanged = ['title', 'body', 'platform', 'source_refs', 'selected_hook_id', 'fact_check_status'].some(key => body[key] !== undefined)
      if (contentChanged) {
        updates.workflow_status = 'content_ready'
        updates.checks = { ...(draft.checks || {}), quality: null, publish_checklist: null }
        updates.approval = { ...defaultApproval(draft.approval), status: 'pending', user_id: null, draft_version: null }
      } else {
        delete updates.checks
      }
      if (selectedHook) {
        updates.selected_hook = structuredClone(selectedHook)
        updates.selected_hook_id = selectedHook.id
        updates.workflow_status = 'content_ready'
        if (!String(updates.body || '').includes(selectedHook.text)) updates.body = `${selectedHook.text}\n\n${updates.body || draft.body}`
      }
       draft.history ||= []
       draft.history.push({ ...structuredClone(draft), history: undefined, version: draft.version, snapshot_at: new Date().toISOString() })
       Object.assign(draft, updates, { version: draft.version + 1, updated_at: new Date().toISOString() })
      if (contentChanged) {
        const linkedShooting = owned('shooting', request).find(item => item.draft_id === draft.id && item.status !== 'published')
        if (linkedShooting) Object.assign(linkedShooting, { status: 'needs_revision', version: (linkedShooting.version || 1) + 1, updated_at: draft.updated_at })
      }
      if (body.status === 'shooting' || body.status === 'ready_to_shoot') {
        const existing = state.shooting.find(item => item.draft_id === draft.id)
        if (!existing) state.shooting.push({ id: nextId(state.shooting), owner_id: userId(request), draft_id: draft.id, title: draft.title, platform: draft.platform, script: draft.body, status: 'todo', version: 1, date: new Date().toISOString().slice(0, 10), strategy_layer: draft.strategy_layer, goal_refs: draft.goal_refs, source_refs: draft.source_refs })
      }
       await saveState('drafts', 'shooting')
      return send(response, 200, draft)
    }
    if (url.pathname === '/api/sync/conflicts' && request.method === 'GET') {
      return send(response, 200, state.conflicts.filter(item => item.owner_id === userId(request) && item.status === 'open'))
    }
    const conflictMatch = url.pathname.match(/^\/api\/sync\/conflicts\/([^/]+)$/)
    if (conflictMatch && request.method === 'POST') {
      const conflict = state.conflicts.find(item => item.id === conflictMatch[1] && item.owner_id === userId(request))
      if (!conflict) return send(response, 404, { error: '同步冲突不存在' })
      const body = await readJson(request)
      if (!['local', 'remote', 'merge'].includes(body.resolution)) return send(response, 422, { error: '不支持的冲突解决方式' })
      const collection = conflict.resource_type === 'draft' ? 'drafts' : conflict.resource_type === 'shooting' ? 'shooting' : null
      const item = collection && state[collection].find(existing => existing.id === conflict.resource_id && existing.owner_id === userId(request))
      if (!item) return send(response, 404, { error: '冲突资源不存在' })
      const selected = body.resolution === 'remote' ? conflict.remote_snapshot : body.resolution === 'local' ? { ...item, ...conflict.local_patch } : { ...item, ...(body.patch || {}) }
      const updates = { ...selected }
      delete updates.id
      delete updates.owner_id
      delete updates.version
      Object.assign(item, updates, { version: item.version + 1, updated_at: new Date().toISOString() })
      conflict.status = 'resolved'
      conflict.resolution = body.resolution
      conflict.resolved_at = new Date().toISOString()
       await saveState('conflicts', 'drafts', 'shooting')
      return send(response, 200, { conflict, resource: item })
    }
    return send(response, 404, { error: '接口不存在' })
  } catch (error) {
    if (!(error instanceof SyntaxError)) console.error(JSON.stringify({ event: 'request_error', path: request.url, method: request.method, message: error?.message, stack: error?.stack }))
    return send(response, 400, { error: error instanceof SyntaxError ? '请求体不是有效 JSON' : '请求处理失败' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Content IP API listening on http://localhost:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    server.close()
    if (mysqlPool) await mysqlPool.end()
  })
}
