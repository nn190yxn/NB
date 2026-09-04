import test from 'node:test'
import assert from 'node:assert/strict'
import { getCapability, isCapabilityId, listCapabilities } from './content-capabilities.mjs'
import { buildContentContext } from './content-context.mjs'

function stateFixture() {
  return {
    profile_by_user: {
      alice: { role: '创业观察者', audiences: ['老板'], problems: ['增长'], pillars: ['复盘'], viewpoints: ['先做小事'], tone_preferences: ['直接'], prohibited_patterns: ['夸大'], source_refs: [{ type: 'profile', id: 1 }] },
      bob: { role: '其他账号', audiences: ['其他人'], pillars: ['其他主题'] },
    },
    strategy_by_user: { alice: { stage: 'cold_start', layer_ratios: { reach: 50, trust: 30, conversion: 20 } } },
    topics: [{ id: 1, owner_id: 'alice', title: '真实复盘', source_refs: [{ type: 'research', id: 7 }] }, { id: 1, owner_id: 'bob', title: '不应读取' }],
    drafts: [{ id: 2, owner_id: 'alice', title: '草稿', body: '正文', source_refs: [{ type: 'topic', id: 1 }] }],
    research: [{ id: 7, owner_id: 'alice', title: '研究' }, { id: 8, owner_id: 'bob', title: '其他研究' }],
    materials: [{ id: 9, owner_id: 'alice', name: '素材' }, { id: 10, owner_id: 'bob', name: '其他素材' }],
    structures: [{ id: 11, owner_id: 'alice', title: '结构' }],
    memories: [{ id: 12, owner_id: 'alice', content: '记忆' }],
    performance_snapshots: [{ id: 13, owner_id: 'alice', draft_id: 2, metrics: { likes: 10 } }],
    api_configs: [{ id: 99, owner_id: 'alice', api_key: 'DO_NOT_EXPOSE', secret: 'DO_NOT_EXPOSE' }],
  }
}

test('能力目录包含唯一且可复制的十项能力', () => {
  const capabilities = listCapabilities()
  assert.equal(capabilities.length, 10)
  assert.equal(new Set(capabilities.map(item => item.id)).size, capabilities.length)
  for (const capability of capabilities) {
    assert.equal(isCapabilityId(capability.id), true)
    assert.ok(capability.label)
    assert.ok(Array.isArray(capability.requires))
    assert.ok(Array.isArray(capability.writes))
    const copy = getCapability(capability.id)
    copy.requires.push('mutated')
    assert.equal(getCapability(capability.id).requires.includes('mutated'), false)
  }
  assert.equal(getCapability('unknown'), null)
})

test('上下文只包含当前账号选择的资源并保留来源引用', () => {
  const context = buildContentContext(stateFixture(), {
    ownerId: 'alice',
    topicId: 1,
    draftId: 2,
    platform: '抖音',
    contentType: '口播',
    task: { researchIds: [7, 8], materialIds: [9, 10], structureIds: [11], memoryIds: [12], performanceSnapshotIds: [13] },
  })
  assert.equal(context.owner_id, 'alice')
  assert.equal(context.topic.title, '真实复盘')
  assert.equal(context.research.length, 1)
  assert.equal(context.materials.length, 1)
  assert.equal(context.materials[0].owner_id, 'alice')
  assert.equal(context.draft.source_refs[0].type, 'topic')
  assert.equal(context.task.platform, '抖音')
})

test('上下文不读取 API 配置且会移除嵌套敏感字段', () => {
  const state = stateFixture()
  state.profile_by_user.alice.source_refs.push({ type: 'profile', id: 2, private_key: 'PRIVATE_SENTINEL' })
  state.topics[0].metadata = { password: 'PASSWORD_SENTINEL', nested: { access_token: 'TOKEN_SENTINEL' } }
  state.drafts[0].generation_context = { authorization: 'AUTH_SENTINEL', safe_field: '保留' }
  const context = buildContentContext(state, { ownerId: 'alice', topicId: 1, draftId: 2 })
  const serialized = JSON.stringify(context)
  for (const sentinel of ['DO_NOT_EXPOSE', 'PRIVATE_SENTINEL', 'PASSWORD_SENTINEL', 'TOKEN_SENTINEL', 'AUTH_SENTINEL']) assert.doesNotMatch(serialized, new RegExp(sentinel))
  assert.doesNotMatch(serialized, /api_configs/)
  assert.equal(context.draft.generation_context.safe_field, '保留')
})

test('缺少账号或访问越权资源时返回结构化错误', () => {
  assert.throws(() => buildContentContext(stateFixture(), {}), error => error.code === 'missing_context')
  const filtered = buildContentContext(stateFixture(), { ownerId: 'alice', topicId: 1, task: { researchIds: [8] } })
  assert.equal(filtered.research.length, 0)
  assert.throws(() => buildContentContext(stateFixture(), { ownerId: 'alice', topicId: 99 }), error => error.code === 'resource_not_found')
})
