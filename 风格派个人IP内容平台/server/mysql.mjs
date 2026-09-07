import mysql from 'mysql2/promise'
import { crossPlatformCollectionNames } from './content-assets.mjs'

const required = ['PROJECT_DB_HOST', 'PROJECT_DB_NAME', 'PROJECT_DB_USER', 'PROJECT_DB_PASSWORD']

export const collectionNames = ['users', 'api_configs', 'usage_daily', 'feedback', 'materials', 'research', 'structures', 'topics', 'drafts', 'shooting', 'sync_jobs', 'profile_reviews', 'conflicts', 'memories', ...crossPlatformCollectionNames]
export const userDocNames = ['positioning', 'strategy', 'profile', 'positioning_candidates', 'api_settings']

export function mysqlConfig(env = process.env) {
  const missing = required.filter(name => !env[name])
  if (missing.length) throw new Error(`MySQL 配置缺少: ${missing.join(', ')}`)
  return {
    host: env.PROJECT_DB_HOST,
    port: Number(env.PROJECT_DB_PORT || 3306),
    database: env.PROJECT_DB_NAME,
    user: env.PROJECT_DB_USER,
    password: env.PROJECT_DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: Number(env.PROJECT_DB_CONNECTION_LIMIT || 5),
    charset: 'utf8mb4',
  }
}

export function createMysqlPool(env = process.env) {
  return mysql.createPool(mysqlConfig(env))
}

export async function migrateMysql(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS app_state (
      state_key VARCHAR(100) NOT NULL PRIMARY KEY,
      state_json JSON NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ip_collections (
      collection VARCHAR(50) NOT NULL,
      item_id VARCHAR(100) NOT NULL,
      owner_id VARCHAR(100) NOT NULL,
      data JSON NOT NULL,
      updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (collection, owner_id, item_id),
      KEY idx_collection_owner (collection, owner_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  const [primaryKeyRows] = await pool.execute("SHOW INDEX FROM ip_collections WHERE Key_name = 'PRIMARY'")
  const primaryKeyColumns = primaryKeyRows.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index)).map(row => row.Column_name)
  if (!primaryKeyColumns.includes('owner_id')) {
    await pool.execute('ALTER TABLE ip_collections DROP PRIMARY KEY, ADD PRIMARY KEY (collection, owner_id, item_id)')
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ip_user_docs (
      user_id VARCHAR(100) NOT NULL,
      doc_key VARCHAR(50) NOT NULL,
      data JSON NOT NULL,
      updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (user_id, doc_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

export async function loadMysqlState(pool, fallbackState) {
  await migrateMysql(pool)
  const [rows] = await pool.execute('SELECT state_json FROM app_state WHERE state_key = ?', ['content-ip-workbench'])
  if (rows.length) return rows[0].state_json
  await saveMysqlState(pool, fallbackState)
  return fallbackState
}

export async function saveMysqlState(pool, state) {
  await pool.execute(
    `INSERT INTO app_state (state_key, state_json, version)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), version = version + 1`,
    ['content-ip-workbench', JSON.stringify(state)],
  )
}

export async function loadCollections(pool) {
  const [rows] = await pool.execute('SELECT collection, item_id, owner_id, data FROM ip_collections')
  const state = {}
  for (const name of collectionNames) state[name] = []
  for (const row of rows) {
    if (!state[row.collection]) state[row.collection] = []
    state[row.collection].push({ ...row.data, id: row.data.id ?? row.item_id, owner_id: row.owner_id })
  }
  return state
}

export async function loadUserDocs(pool) {
  const [rows] = await pool.execute('SELECT user_id, doc_key, data FROM ip_user_docs')
  const store = {}
  for (const row of rows) {
    store[row.doc_key] ||= {}
    store[row.doc_key][row.user_id] = row.data
  }
  return store
}

function normalizeItemId(item) {
  return String(item.id ?? '')
}

export async function saveCollections(pool, state, collections = collectionNames) {
  for (const name of collections) {
    const items = (state[name] || []).filter(item => normalizeItemId(item))
    const [ownerRows] = await pool.execute('SELECT DISTINCT owner_id FROM ip_collections WHERE collection = ?', [name])
    const liveIdsByOwner = new Map()
    for (const item of items) {
      const itemId = normalizeItemId(item)
      const ownerId = item.owner_id || 'demo-user'
      if (!liveIdsByOwner.has(ownerId)) liveIdsByOwner.set(ownerId, new Set())
      liveIdsByOwner.get(ownerId).add(itemId)
      await pool.execute(
        `INSERT INTO ip_collections (collection, item_id, owner_id, data)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [name, itemId, ownerId, JSON.stringify({ ...item, owner_id: ownerId })],
      )
    }
    const owners = new Set([...ownerRows.map(row => row.owner_id), ...liveIdsByOwner.keys()])
    for (const ownerId of owners) {
      const liveIds = liveIdsByOwner.get(ownerId) || new Set()
      if (liveIds.size) {
        const placeholders = [...liveIds].map(() => '?').join(', ')
        await pool.execute(
          `DELETE FROM ip_collections WHERE collection = ? AND owner_id = ? AND item_id NOT IN (${placeholders})`,
          [name, ownerId, ...liveIds],
        )
      } else {
        await pool.execute('DELETE FROM ip_collections WHERE collection = ? AND owner_id = ?', [name, ownerId])
      }
    }
  }
}

export async function saveUserDocs(pool, stores, docKeys = userDocNames) {
  for (const key of docKeys) {
    const store = stores[`${key}_by_user`] || {}
    for (const [userId, data] of Object.entries(store)) {
      await pool.execute(
        `INSERT INTO ip_user_docs (user_id, doc_key, data)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [userId, key, JSON.stringify(data)],
      )
    }
  }
}

export async function verifyMysql(pool) {
  const [rows] = await pool.execute('SELECT DATABASE() AS database_name, CURRENT_USER() AS connected_as')
  return rows[0]
}
