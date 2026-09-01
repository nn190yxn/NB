import test from 'node:test'
import assert from 'node:assert/strict'
import { appWindowOptions, allowedIpcChannels, isAllowedIpcChannel, nextWindowState, normalizeAppOrigin, resolveAppOrigin, shouldHideOnClose } from './electron-core.mjs'

test('desktop IPC exposes only an explicit allowlist and sandboxed window options', () => {
  assert.ok(allowedIpcChannels().includes('session:login'))
  assert.ok(allowedIpcChannels().includes('sync:select-directory'))
  assert.ok(allowedIpcChannels().includes('sync:refresh'))
  assert.equal(isAllowedIpcChannel('shell:exec'), false)
  const options = appWindowOptions('C:/preload.mjs')
  assert.equal(options.webPreferences.contextIsolation, true)
  assert.equal(options.webPreferences.nodeIntegration, false)
  assert.equal(options.webPreferences.sandbox, true)
  assert.equal(options.webPreferences.preload, 'C:/preload.mjs')
})

test('desktop origin defaults to production and accepts explicit HTTP(S) overrides', () => {
  assert.equal(resolveAppOrigin(), 'https://content.woyai.cn')
  assert.equal(resolveAppOrigin('http://127.0.0.1:5173/path'), 'http://127.0.0.1:5173')
  assert.equal(normalizeAppOrigin('https://content.example.test/path'), 'https://content.example.test')
  assert.throws(() => resolveAppOrigin('file:///unsafe.html'), /HTTP\(S\)/)
  assert.throws(() => normalizeAppOrigin('javascript:alert(1)'), /HTTP\(S\)/)
})

test('Windows close hides to tray, while explicit quit exits', () => {
  assert.equal(shouldHideOnClose({ platform: 'win32', quitting: false }), true)
  assert.equal(shouldHideOnClose({ platform: 'linux', quitting: false }), false)
  assert.deepEqual(nextWindowState({ platform: 'win32', quitting: false, hidden: false }, 'close'), { platform: 'win32', quitting: false, hidden: true })
  assert.deepEqual(nextWindowState({ platform: 'win32', quitting: false, hidden: true }, 'quit'), { platform: 'win32', quitting: true, hidden: false })
})
