import { createMysqlPool, loadCollections, loadMysqlState, loadUserDocs, migrateMysql, saveCollections, saveUserDocs, collectionNames, userDocNames, verifyMysql } from './mysql.mjs'

const pool = createMysqlPool()
try {
  await migrateMysql(pool)
  const connection = await verifyMysql(pool)

  const legacyState = await loadMysqlState(pool, {})
  const existingCollections = await loadCollections(pool)
  const existingDocs = await loadUserDocs(pool)
  const alreadyMigrated = Object.values(existingCollections).some(items => items.length)
    || Object.values(existingDocs).some(store => Object.keys(store).length)

  if (alreadyMigrated) {
    console.log(JSON.stringify({ status: 'ok', ...connection, mode: 'already-migrated', collections: Object.fromEntries(Object.entries(existingCollections).map(([name, items]) => [name, items.length])) }))
  } else if (!legacyState || !Object.keys(legacyState).length) {
    console.log(JSON.stringify({ status: 'ok', ...connection, mode: 'empty-database' }))
  } else {
    await saveCollections(pool, legacyState, collectionNames)
    await saveUserDocs(pool, legacyState, userDocNames)
    const migrated = await loadCollections(pool)
    const legacyCounts = Object.fromEntries(collectionNames.map(name => [name, (legacyState[name] || []).length]))
    const mismatch = collectionNames.filter(name => (migrated[name] || []).length !== legacyCounts[name])
    if (mismatch.length) {
      console.error(JSON.stringify({ status: 'error', mismatch, legacyCounts, migratedCounts: Object.fromEntries(Object.entries(migrated).map(([name, items]) => [name, items.length])) }))
      process.exit(1)
    }
    console.log(JSON.stringify({ status: 'ok', ...connection, mode: 'migrated', collections: Object.fromEntries(Object.entries(migrated).map(([name, items]) => [name, items.length])), legacy_app_state_preserved: true }))
  }
} finally {
  await pool.end()
}
