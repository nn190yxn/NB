import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionNames, loadCollections, loadMysqlState, loadUserDocs, saveCollections, saveUserDocs } from './mysql.mjs'

function createMockPool({ appStateRows = [] } = {}) {
  const db = { app_state: appStateRows, collections: [], user_docs: [] }
  const pool = {
    db,
    execute: async (sql, params = []) => {
      if (sql.startsWith('CREATE TABLE')) return [[], []]
      if (sql.startsWith('SELECT state_json')) return [db.app_state.map(row => ({ state_json: row.state_json })), []]
      if (sql.startsWith('INSERT INTO app_state')) {
        const existing = db.app_state.find(row => row.state_key === params[0])
        if (existing) { existing.state_json = JSON.parse(params[1]); existing.version += 1 }
        else db.app_state.push({ state_key: params[0], state_json: JSON.parse(params[1]), version: 1 })
        return [[], []]
      }
      if (sql.startsWith('SELECT collection')) return [db.collections.map(({ collection, item_id, owner_id, data }) => ({ collection, item_id, owner_id, data })), []]
      if (sql.startsWith('SELECT user_id')) return [db.user_docs.map(({ user_id, doc_key, data }) => ({ user_id, doc_key, data })), []]
      if (sql.startsWith('INSERT INTO ip_collections')) {
        const [collection, itemId, ownerId, data] = params
        const existing = db.collections.find(row => row.collection === collection && row.item_id === itemId && row.owner_id === ownerId)
        if (existing) { existing.owner_id = ownerId; existing.data = JSON.parse(data) }
        else db.collections.push({ collection, item_id: itemId, owner_id: ownerId, data: JSON.parse(data) })
        return [[], []]
      }
      if (sql.startsWith('SELECT DISTINCT owner_id')) {
        const owners = [...new Set(db.collections.filter(row => row.collection === params[0]).map(row => row.owner_id))]
        return [owners.map(owner_id => ({ owner_id })), []]
      }
      if (sql.startsWith('DELETE FROM ip_collections WHERE collection = ? AND owner_id = ? AND item_id NOT IN')) {
        const [collection, ownerId, ...keep] = params
        db.collections = db.collections.filter(row => row.collection !== collection || row.owner_id !== ownerId || keep.includes(row.item_id))
        return [[], []]
      }
      if (sql === 'DELETE FROM ip_collections WHERE collection = ? AND owner_id = ?') {
        db.collections = db.collections.filter(row => row.collection !== params[0] || row.owner_id !== params[1])
        return [[], []]
      }
      if (sql.startsWith('INSERT INTO ip_user_docs')) {
        const [userId, docKey, data] = params
        const existing = db.user_docs.find(row => row.user_id === userId && row.doc_key === docKey)
        if (existing) existing.data = JSON.parse(data)
        else db.user_docs.push({ user_id: userId, doc_key: docKey, data: JSON.parse(data) })
        return [[], []]
      }
      return [[], []]
    },
  }
  return pool
}

test('legacy app_state migrates into split tables with matching counts', async () => {
  const legacy = {
    materials: [{ id: 1, owner_id: 'demo-user', name: '素材一' }, { id: 2, owner_id: 'demo-user', name: '素材二' }],
    structures: [{ id: 1, owner_id: 'demo-user', title: '结构', steps: ['a'] }],
    drafts: [],
    positioning_by_user: { 'demo-user': { role: '专家' } },
    profile_by_user: { 'demo-user': { role: '创作者' } },
  }
  const pool = createMockPool()
  await loadMysqlState(pool, legacy)
  await saveCollections(pool, legacy, collectionNames)
  await saveUserDocs(pool, legacy)

  const migrated = await loadCollections(pool)
  for (const name of collectionNames) {
    assert.equal((migrated[name] || []).length, (legacy[name] || []).length, `collection ${name} count mismatch`)
  }
  const docs = await loadUserDocs(pool)
  assert.deepEqual(docs.positioning, legacy.positioning_by_user)
  assert.deepEqual(docs.profile, legacy.profile_by_user)
})

test('migration is idempotent: rerunning over an already-migrated database keeps row counts stable', async () => {
  const legacy = {
    materials: [{ id: 1, owner_id: 'demo-user', name: '素材一' }],
    structures: [{ id: 1, owner_id: 'demo-user', title: '结构', steps: ['a'] }],
  }
  const pool = createMockPool()
  await loadMysqlState(pool, legacy)
  await saveCollections(pool, legacy, collectionNames)
  await saveUserDocs(pool, legacy)

  const before = await loadCollections(pool)
  await saveCollections(pool, before, collectionNames)
  await saveUserDocs(pool, before)
  const after = await loadCollections(pool)

  for (const name of collectionNames) {
    assert.equal((after[name] || []).length, (before[name] || []).length, `collection ${name} count drifted`)
  }
  const material = after.materials.find(item => item.id === 1)
  assert.equal(material.name, '素材一')
})

test('deleting an item from a collection prunes its row on save', async () => {
  const legacy = { structures: [{ id: 1, owner_id: 'u1', title: 'A' }, { id: 2, owner_id: 'u1', title: 'B' }] }
  const pool = createMockPool()
  await saveCollections(pool, legacy, collectionNames)

  const remaining = { structures: legacy.structures.filter(item => item.id === 1) }
  await saveCollections(pool, remaining, ['structures'])
  const loaded = await loadCollections(pool)
  assert.equal(loaded.structures.length, 1)
  assert.equal(loaded.structures[0].title, 'A')
})

test('collection rows with the same item id stay isolated by owner', async () => {
  const pool = createMockPool()
  const state = {
    devices: [
      { id: 'device-1', owner_id: 'user-a', name: 'A电脑' },
      { id: 'device-1', owner_id: 'user-b', name: 'B电脑' },
    ],
  }
  await saveCollections(pool, state, ['devices'])
  let loaded = await loadCollections(pool)
  assert.deepEqual(loaded.devices.map(item => `${item.owner_id}:${item.name}`).sort(), ['user-a:A电脑', 'user-b:B电脑'])

  await saveCollections(pool, { devices: state.devices.filter(item => item.owner_id === 'user-b') }, ['devices'])
  loaded = await loadCollections(pool)
  assert.deepEqual(loaded.devices, [{ id: 'device-1', name: 'B电脑', owner_id: 'user-b' }])
})
