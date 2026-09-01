import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionNames, loadCollections, loadMysqlState, loadUserDocs, migrateMysql, mysqlConfig, saveCollections, saveMysqlState, saveUserDocs } from './mysql.mjs'

test('mysqlConfig reads project-owned variables without exposing defaults', () => {
  const config = mysqlConfig({
    PROJECT_DB_HOST: '127.0.0.1',
    PROJECT_DB_PORT: '3306',
    PROJECT_DB_NAME: 'content_ip_workbench',
    PROJECT_DB_USER: 'content_ip_app',
    PROJECT_DB_PASSWORD: 'test-password',
  })
  assert.deepEqual(config, {
    host: '127.0.0.1',
    port: 3306,
    database: 'content_ip_workbench',
    user: 'content_ip_app',
    password: 'test-password',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
  })
})

test('mysqlConfig fails clearly when a project database credential is missing', () => {
  assert.throws(() => mysqlConfig({ PROJECT_DB_HOST: '127.0.0.1' }), /PROJECT_DB_NAME, PROJECT_DB_USER, PROJECT_DB_PASSWORD/)
})

test('loadMysqlState seeds an empty project database from the JSON fallback', async () => {
  const calls = []
  const pool = {
    execute: async (sql, params) => {
      calls.push([sql, params])
      return [[], []]
    },
  }
  const fallback = { profile: { role: 'creator' } }
  assert.deepEqual(await loadMysqlState(pool, fallback), fallback)
  assert.equal(calls.filter(([sql]) => sql.includes('CREATE TABLE')).length, 3)
  assert.match(calls.at(-1)[0], /INSERT INTO app_state/)
  assert.equal(calls.at(-1)[1][0], 'content-ip-workbench')
  assert.equal(calls.at(-1)[1][1], JSON.stringify(fallback))
})

test('saveMysqlState updates the single project state record', async () => {
  let call
  const pool = { execute: async (...args) => { call = args; return [[], []] } }
  await saveMysqlState(pool, { version: 2 })
  assert.match(call[0], /ON DUPLICATE KEY UPDATE/)
  assert.deepEqual(call[1], ['content-ip-workbench', JSON.stringify({ version: 2 })])
})

test('migrateMysql creates the collection and user doc tables', async () => {
  const statements = []
  const pool = { execute: async sql => {
    statements.push(sql)
    if (sql.startsWith('SHOW INDEX')) return [[
      { Column_name: 'collection', Seq_in_index: 1 },
      { Column_name: 'owner_id', Seq_in_index: 2 },
      { Column_name: 'item_id', Seq_in_index: 3 },
    ], []]
    return [[], []]
  } }
  await migrateMysql(pool)
  assert.equal(statements.length, 4)
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS app_state/)
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS ip_collections[\s\S]*PRIMARY KEY \(collection, owner_id, item_id\)/)
  assert.match(statements[2], /SHOW INDEX FROM ip_collections/)
  assert.match(statements[3], /CREATE TABLE IF NOT EXISTS ip_user_docs[\s\S]*PRIMARY KEY \(user_id, doc_key\)/)
})

test('saveCollections upserts rows per item and prunes removed ids', async () => {
  const calls = []
  const pool = { execute: async (sql, params) => { calls.push([sql, params]); return sql.startsWith('SELECT DISTINCT owner_id') ? [[{ owner_id: 'user-a' }], []] : [[], []] } }
  const state = { structures: [{ id: 1, owner_id: 'user-a', title: '结构A' }, { id: 2, owner_id: 'user-a', title: '结构B' }] }
  await saveCollections(pool, state, ['structures'])
  const upserts = calls.filter(([sql]) => sql.includes('INSERT INTO ip_collections'))
  assert.equal(upserts.length, 2)
  assert.deepEqual(upserts[0][1], ['structures', '1', 'user-a', JSON.stringify(state.structures[0])])
  assert.match(upserts[0][0], /ON DUPLICATE KEY UPDATE data = VALUES\(data\)/)
  const prune = calls.at(-1)
  assert.match(prune[0], /DELETE FROM ip_collections WHERE collection = \? AND owner_id = \? AND item_id NOT IN/)
  assert.deepEqual(prune[1], ['structures', 'user-a', '1', '2'])
})

test('saveCollections clears the collection when it becomes empty', async () => {
  const calls = []
  const pool = { execute: async (sql, params) => { calls.push([sql, params]); return sql.startsWith('SELECT DISTINCT owner_id') ? [[{ owner_id: 'user-a' }], []] : [[], []] } }
  await saveCollections(pool, { structures: [] }, ['structures'])
  assert.equal(calls.filter(([sql]) => sql.includes('INSERT INTO ip_collections')).length, 0)
  assert.equal(calls.at(-1)[0], 'DELETE FROM ip_collections WHERE collection = ? AND owner_id = ?')
  assert.deepEqual(calls.at(-1)[1], ['structures', 'user-a'])
})

test('loadCollections reassembles state grouped by collection', async () => {
  const rows = [
    { collection: 'structures', item_id: '1', owner_id: 'user-a', data: { id: 1, title: '结构A' } },
    { collection: 'materials', item_id: '9', owner_id: 'user-b', data: { id: 9, name: '素材' } },
    { collection: 'structures', item_id: '2', owner_id: 'user-b', data: { id: 2, title: '结构B' } },
  ]
  const pool = { execute: async () => [rows, []] }
  const state = await loadCollections(pool)
  for (const name of collectionNames) assert.ok(Array.isArray(state[name]))
  assert.deepEqual(state.structures, [{ id: 1, title: '结构A', owner_id: 'user-a' }, { id: 2, title: '结构B', owner_id: 'user-b' }])
  assert.deepEqual(state.materials, [{ id: 9, name: '素材', owner_id: 'user-b' }])
})

test('user docs round-trip through the per-user doc table', async () => {
  const rows = []
  const pool = {
    execute: async (sql, params) => {
      if (sql.startsWith('SELECT user_id')) return [rows.map(({ user_id, doc_key, data }) => ({ user_id, doc_key, data })), []]
      if (sql.startsWith('INSERT INTO ip_user_docs')) {
        const [userId, docKey, data] = params
        const existing = rows.find(row => row.user_id === userId && row.doc_key === docKey)
        if (existing) existing.data = JSON.parse(data)
        else rows.push({ user_id: userId, doc_key: docKey, data: JSON.parse(data) })
        return [[], []]
      }
      return [[], []]
    },
  }
  const stores = { positioning_by_user: { 'user-a': { role: '专家' } }, strategy_by_user: { 'user-a': { stage: 'cold_start' } } }
  await saveUserDocs(pool, stores, ['positioning', 'strategy'])
  const loaded = await loadUserDocs(pool)
  assert.deepEqual(loaded, { positioning: { 'user-a': { role: '专家' } }, strategy: { 'user-a': { stage: 'cold_start' } } })
})
