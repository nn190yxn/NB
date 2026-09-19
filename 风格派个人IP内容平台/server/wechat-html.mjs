// 微信公众号排版：把草稿正文转成可直接粘进公众号后台的 HTML。
//
// 移植 dbs-wechat-html 的两件事：
//   一、模板转换规则（源技能「Markdown 转 HTML 规则」11 条）：连续列表项合并成一个 ul、段内单换行并成空格、
//       段落末尾的中文句号去掉、不生成 br、图片只留占位、表格降级成列表、特殊字符转义；
//   二、风格库（server/wechat-styles.mjs，CSS 逐条取自源文件）。
//
// 关键约束：微信后台会剥掉 <style> 和 class，所以这里把 CSS 全部转成内联 style。为此需要一个小解析器，
// 它只认源文件里出现的那套扁平写法（选择器{声明}），不追求通用 CSS 支持。
// 伪元素（h2:before 的小横条、li:before 的序号）没法内联，用等价的空 span / 自己编号顶上，做不到的写进 notes 里说明。
//
// 这一层不改观点、不润色、不做诊断：只排版。
//
// 来源：dbs-wechat-html（CC BY-NC 4.0，dontbesilent2025/dbskill）。

import { wechatStyles } from './wechat-styles.mjs'

export { wechatStyles }

const defaultStyleId = 'minimal'

export function findWechatStyle(id) {
  const wanted = String(id || '').trim() || defaultStyleId
  return wechatStyles.find(item => item.id === wanted) || wechatStyles.find(item => item.id === defaultStyleId) || wechatStyles[0]
}

// 扁平 CSS → 选择器到声明的映射。源文件的 CSS 没有嵌套，所以按 } 切就够。
export function parseWechatCss(css) {
  const rules = {}
  for (const chunk of String(css || '').split('}')) {
    const [selector, declaration] = chunk.split('{')
    if (!selector || !declaration) continue
    const key = selector.trim()
    const value = declaration.trim().replace(/;$/, '')
    if (key && value) rules[key] = value
  }
  return rules
}

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 段内行内标记：先转义，再处理 **粗** 和 `代码`，最后收图片与链接。
function inlineMarkup(text) {
  let out = escapeHtml(text)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  // 图片不内嵌：源技能要求只留占位，说明这里原本有图。
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, (match, alt) => `[图片：${alt || '未命名'}]`)
  // 链接只留文字：公众号里外链不可点，留着 URL 只会显得脏。
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  return out
}

const styleAttr = value => (value ? ` style="${escapeHtml(value).replace(/&quot;/g, '"')}"` : '')

// 正文 → 带内联样式的 HTML 片段。
function renderBody(markdown, rules) {
  const style = tag => rules[tag] || ''
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  const notes = []
  let listItems = null
  let codeLines = null
  let paragraph = []
  let orderedCounter = 0

  const listStyle = style('ul')
  const itemStyle = style('li')
  const listItemPrefix = rules['li:before']

  const closeParagraph = () => {
    if (!paragraph.length) return
    // 段内单换行并成空格（源技能第 4 条）。不做 br。
    // 段末中文句号保留：源技能要求去掉，但那是它的排版偏好，不是硬要求；Alex 定了保留，不擅自改他的标点。
    const text = inlineMarkup(paragraph.join(' ')).trim()
    if (text) out.push(`<p${styleAttr(style('p'))}>${text}</p>`)
    paragraph = []
  }

  const closeList = () => {
    if (listItems === null) return
    const items = listItems
    listItems = null
    orderedCounter = 0
    out.push(`<ul${styleAttr(listStyle)}>${items.map(item => {
      let prefix = ''
      if (listItemPrefix) {
        // 源技能里 stripe 的 li:before 是 "0" counter(item)：这里自己编号顶上，效果一致。
        orderedCounter += 1
        prefix = `<span style="font-family:Consolas,Menlo,monospace;font-size:12px;">${String(orderedCounter).padStart(2, '0')} </span>`
      }
      return `<li${styleAttr(itemStyle)}>${prefix}${item}</li>`
    }).join('')}</ul>`)
  }

  const closeAll = () => { closeParagraph(); closeList() }

  const flushCode = () => {
    if (!Array.isArray(codeLines)) return
    const codeStyle = [style('pre'), 'white-space:pre-wrap;overflow:auto'].filter(Boolean).join(';')
    out.push(`<pre${styleAttr(codeStyle)}><code${styleAttr(rules['pre code'])}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeLines = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (Array.isArray(codeLines)) {
      if (line.startsWith('```')) flushCode()
      else codeLines.push(rawLine)
      continue
    }
    if (line.startsWith('```')) { closeAll(); codeLines = []; continue }
    if (!line) { closeAll(); continue }
    if (/^---+$/.test(line)) { closeAll(); out.push(`<hr${styleAttr(style('hr'))}>`); continue }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      closeAll()
      const tag = `h${heading[1].length}`
      // 伪元素没法内联：minimal 的 h2:before 是一条 3px 小横条，用一个空 span 顶上（display:block 撑出高度）。
      const before = rules[`${tag}:before`] ? `<span style="display:block;height:3px;width:30px;background:#111;margin:0 0 12px;"></span>` : ''
      out.push(`<${tag}${styleAttr(style(tag))}>${before}${inlineMarkup(heading[2])}</${tag}>`)
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) { closeAll(); out.push(`<blockquote${styleAttr(style('blockquote'))}>${inlineMarkup(quote[1])}</blockquote>`); continue }
    const bullet = line.match(/^[-*]\s+(.*)$/)
    if (bullet) { closeParagraph(); if (listItems === null) listItems = []; listItems.push(inlineMarkup(bullet[1])); continue }
    const ordered = line.match(/^\d+[.、]\s+(.*)$/)
    if (ordered) { closeParagraph(); if (listItems === null) listItems = []; listItems.push(inlineMarkup(ordered[1])); continue }
    // 表格在公众号里兼容性差：源技能要求降级成列表，一行一条。
    if (/^\|.*\|$/.test(line)) {
      closeParagraph()
      const cells = line.split('|').map(cell => cell.trim()).filter(Boolean)
      if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue
      if (listItems === null) listItems = []
      listItems.push(inlineMarkup(cells.join('：')))
      continue
    }
    paragraph.push(line)
  }
  // 代码块没闭合时不能把剩下的正文吞掉：按代码块渲染到结尾，并在 notes 里写明。
  if (Array.isArray(codeLines)) { notes.push('正文里有一个代码块没有闭合，按代码块渲染到结尾了。'); flushCode() }
  closeAll()
  return { html: out.join(''), notes }
}

export function wechatHtmlFor({ title = '', body = '', styleId = defaultStyleId } = {}) {
  const style = findWechatStyle(styleId)
  const rules = parseWechatCss(style.css)
  const notes = []
  if (rules['h2:before'] || rules['h3:before'] || rules['li:before']) notes.push('样式里的伪元素装饰（标题前的小横条、列表序号）用等价的 span 顶上，不保证和源文件逐像素一致。')
  const heading = String(title || '').trim()
  const { html: bodyHtml, notes: bodyNotes } = renderBody(body, rules)
  notes.push(...bodyNotes)
  const html = `${heading ? `<h1${styleAttr(rules.h1)}>${inlineMarkup(heading)}</h1>` : ''}${bodyHtml}`
  return {
    style_id: style.id,
    style_name: style.name,
    style_group: style.group,
    body_style: rules.body || '',
    html,
    chars: html.length,
    notes,
  }
}

// 独立文档：给预览和下载用。粘贴进公众号时用的是上面那段的 html，不带 <style>、不靠 class。
export function wechatHtmlDocument({ title = '', body = '', styleId = defaultStyleId } = {}) {
  const result = wechatHtmlFor({ title, body, styleId })
  const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || '公众号版本')} · ${escapeHtml(result.style_name)}</title>
</head>
<body style="margin:0;background:#f6f6f6;">
<section style="${escapeHtml(result.body_style)}">
${result.html}
</section>
</body>
</html>
`
  return { ...result, document: page }
}
