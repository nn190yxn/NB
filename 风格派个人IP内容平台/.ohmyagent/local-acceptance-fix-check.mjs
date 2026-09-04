import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const main = readFileSync('src/main.tsx', 'utf8')
const styles = readFileSync('src/styles.css', 'utf8')

assert.match(styles, /\.topic-evaluation-card > div:first-child \{ width: 100%; flex: 1 1 100%; min-width: 0; \}/)
assert.match(styles, /\.topic-actions \{ width: 100%; flex: 1 1 100%; margin-left: 0; \}/)
assert.match(main, /type ApiErrorPayload = \{ error\?: string; missing_fields\?: string\[\] \}/)
assert.match(main, /setTopicError\(\[payload\?\.error, missing \? `还缺少：\$\{missing\}` : ''\]/)
assert.match(main, /const revoked = approval\?\.status === 'revoked'/)
assert.match(main, /已撤回：\$\{approval\.revoke_reason \|\| '需要修改'\}/)
assert.match(main, /const draftCheckStatusLabels: Record<string, string> = \{ passed: '已通过', warning: '有提醒', blocked: '未通过' \}/)
assert.match(main, /draftCheckStatusLabels\[item\.status\] \|\| '待检查'/)
console.log('local acceptance fix assertions: 8 passed')
