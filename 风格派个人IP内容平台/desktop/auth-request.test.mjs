import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopAuthRequest } from './auth-request.mjs'

test('桌面账号桥接区分登录注册且不使用访问密码请求头', () => {
  for (const mode of ['login', 'register']) {
    const request = desktopAuthRequest({ mode, username: ' alex ', password: 'test-password' })
    assert.equal(request.path, mode === 'login' ? '/api/auth/session' : '/api/auth/register')
    assert.deepEqual(JSON.parse(request.options.body), { username: 'alex', password: 'test-password' })
    assert.equal(request.options.headers['x-access-password'], undefined)
  }
  assert.throws(() => desktopAuthRequest('old-password'))
  assert.throws(() => desktopAuthRequest({ mode: 'other', username: 'alex', password: 'test' }))
})
