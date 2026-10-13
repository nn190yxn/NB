// 模型输出的统一解析入口。
//
// 真模型实测踩到的几件事：它经常把 JSON 包在 ```json 围栏里、在前后多写一句客气话、
// 或者在字符串值里直接换行（裸的 \n 在 JSON 字符串里是非法字符，JSON.parse 当场抛）。
// 直接 JSON.parse 会抛，抛上来的就是一句读不懂的错误；
// 更糟的是有的调用点把「解析不出来」当成「没查出问题」放过。
// 所以这里先按这几种常见写法救一次，救不回来才报错——且报的是「这次回答读不出」，
// 不是「你的模型配置坏了」（配置好好的，重试一次通常就出来了）。

const controlChars = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }

// 把字符串字面量里的裸换行/回车/制表符转义掉。字符串外的换行是空白，动不得。
function escapeControlCharsInStrings(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (const char of text) {
    if (inString) {
      if (escaped) { out += char; escaped = false; continue }
      if (char === '\\') { out += char; escaped = true; continue }
      if (char === '"') { inString = false; out += char; continue }
      if (controlChars[char]) { out += controlChars[char]; continue }
      out += char
      continue
    }
    if (char === '"') inString = true
    out += char
  }
  return out
}

// 依次试：原样 → 掐头去尾只留最外层 JSON → 再试转义过的版本。
export function jsonCandidates(text) {
  const candidates = [text]
  const start = text.search(/[[{]/)
  if (start > 0) {
    const close = text[start] === '{' ? '}' : ']'
    const end = text.lastIndexOf(close)
    if (end > start) candidates.push(text.slice(start, end + 1))
  }
  return [...new Set(candidates.flatMap(candidate => {
    const repaired = escapeControlCharsInStrings(candidate)
    return repaired === candidate ? [candidate] : [candidate, repaired]
  }))]
}

export function modelJson(content) {
  const raw = String(content ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  for (const candidate of jsonCandidates(raw)) {
    try { return JSON.parse(candidate) } catch { /* 换下一种写法再试 */ }
  }
  const head = raw.slice(0, 40) || '空'
  const tail = raw.length > 40 ? raw.slice(-40) : head
  throw Object.assign(
    new Error(`模型这次没给出可解析的结果（${raw.length} 字，开头「${head}」，结尾「${tail}」），重试一次通常就好。`),
    { code: 'MODEL_OUTPUT_INVALID' },
  )
}

// 三档的中文写法也要认：模型经常回「成立 / 有条件成立 / 不成立」而不是英文键。
const statusAliases = {
  passed: 'passed',
  conditional: 'conditional',
  failed: 'failed',
  成立: 'passed',
  逻辑成立: 'passed',
  通过: 'passed',
  有条件成立: 'conditional',
  条件成立: 'conditional',
  部分成立: 'conditional',
  不成立: 'failed',
  逻辑不成立: 'failed',
  站不住: 'failed',
}

export function normalizeVerdictStatus(value) {
  const text = String(value ?? '').trim()
  return statusAliases[text] || null
}
