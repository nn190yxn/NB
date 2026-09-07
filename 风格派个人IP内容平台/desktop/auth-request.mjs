export function desktopAuthRequest(credentials) {
  if (!credentials || !['login', 'register'].includes(credentials.mode) || typeof credentials.username !== 'string' || typeof credentials.password !== 'string' || !credentials.username.trim() || !credentials.password) throw new Error('请填写用户名和密码')
  return { path: credentials.mode === 'register' ? '/api/auth/register' : '/api/auth/session', options: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: credentials.username.trim(), password: credentials.password }) } }
}
