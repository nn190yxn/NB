// 把 dbs-wechat-html 的 templates/styles.md 抽成数据模块 server/wechat-styles.mjs。
// 不手抄 CSS：源文件的 CSS 原样搬过来，避免转写错误。上游技能更新后重跑一次即可。
// 用法：node scripts/extract-wechat-styles.mjs（默认读下面这个本地技能目录，路径不同就改 source）。
import { readFileSync, writeFileSync } from 'node:fs'

const source = 'C:\\Users\\Alex\\.agents\\skills\\dbs-wechat-html\\templates\\styles.md'
const target = 'server/wechat-styles.mjs'

const raw = readFileSync(source, 'utf8').replace(/\r\n/g, '\n')
const blocks = raw.split(/\n## /).slice(1)
const styles = []
for (const block of blocks) {
  const lines = block.split('\n')
  const heading = lines[0]
  const match = heading.match(/^\d+\s+([a-z]+)\s*[：:]\s*(.+)$/)
  if (!match) continue
  const body = lines.slice(1).join('\n')
  const pick = label => (body.match(new RegExp(`- ${label}：(.*)`)) || [])[1]?.trim() || ''
  const css = (body.match(/```css\n([\s\S]*?)\n```/) || [])[1]?.trim() || ''
  if (!css) continue
  styles.push({ id: match[1], name: match[2].trim(), group: pick('分组'), alias: pick('别名'), fit: pick('适合'), css })
}

if (styles.length !== 15) throw new Error(`抽取到 ${styles.length} 个风格，源文件应该有 15 个，先查再生成`)

const header = `// 微信公众号排版风格库：数据逐条取自 dbs-wechat-html/templates/styles.md，CSS 原样保留、不改写。
//
// 源文件里每个风格是一段 CSS（选择器 body/h1/h2/h3/p/blockquote/ul/li/strong/code/pre/hr）。
// 微信后台会剥掉 <style> 和 class，所以 server/wechat-html.mjs 会把这里的 CSS 转成内联样式再输出；
// 这里只存原文，转换规则在那里，两件事分开。
//
// 来源：dbs-wechat-html（CC BY-NC 4.0，dontbesilent2025/dbskill）。
// 这个文件由一次性脚本生成，改样式请改源文件后重新生成，不要在这里手改。

export const wechatStyleSource = 'dbs-wechat-html/templates/styles.md'

export const wechatStyles = [
`
const body = styles.map(style => `  {\n    id: ${JSON.stringify(style.id)},\n    name: ${JSON.stringify(style.name)},\n    group: ${JSON.stringify(style.group)},\n    alias: ${JSON.stringify(style.alias)},\n    fit: ${JSON.stringify(style.fit)},\n    css: ${JSON.stringify(style.css)},\n  },`).join('\n')
writeFileSync(target, `${header}${body}\n]\n`, 'utf8')
console.log(`已生成 ${target}，共 ${styles.length} 个风格：${styles.map(item => item.id).join(', ')}`)
