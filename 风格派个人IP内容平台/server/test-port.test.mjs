import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPortAllocator } from './test-port.mjs'

test('同一范围内的端口不会重复分配', () => {
  const { testPort } = createPortAllocator({ lockDir: mkdtempSync(join(tmpdir(), 'port-lock-')) })
  const seen = new Set()
  for (let index = 0; index < 30; index += 1) {
    const port = testPort(20000, 40)
    assert.equal(seen.has(port), false, `端口 ${port} 被分配了两次`)
    seen.add(port)
  }
})

test('递增取值会跳过 undici 禁用端口', () => {
  const { testPortSequence } = createPortAllocator({ lockDir: mkdtempSync(join(tmpdir(), 'port-lock-')) })
  const next = testPortSequence(3658, 20)
  assert.deepEqual([next(), next(), next()], [3658, 3660, 3661])
})

test('范围内端口用尽时明确失败', () => {
  const { testPort } = createPortAllocator({
    lockDir: mkdtempSync(join(tmpdir(), 'port-lock-')),
    blocked: new Set([10, 11]),
  })
  assert.equal(testPort(10, 3), 12)
  assert.throws(() => testPort(10, 3), /测试端口耗尽: 10-12/)
})
