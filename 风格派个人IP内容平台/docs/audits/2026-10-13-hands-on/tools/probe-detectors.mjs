// 实测脚本二：给每条「一次都没在你稿子里响过」的检测规则，喂一段明知犯样的文本，
// 看它响不响。分清两件事：你的稿子确实没这个问题，还是这条规则写得太窄基本响不了。
// 用法：node .monkeycode-tmp-files/walk-20261013/probe-detectors.mjs
import { scanGeneratedBody } from '../../server/draft-checks.mjs'

const cases = [
  ['hook_pain_promise', '你还在为没有流量焦虑吗？每天忙到凌晨，发出去只有 200 播放，问题出在你没搞懂内容生产的逻辑。看完这条，你就能明白怎么让一条内容产生 10 条爆款。'],
  ['you_deserve_ending', '把内容当成产品来做，不追求完美，追求验证。愿你也能找到属于自己的节奏，你值得更好的结果。'],
  ['golden_tail', '素材不是灵感，是可拆的零件。方法不是鸡汤，是可用的骨架。发布不是终点，是下一次开始。'],
  ['body_feeling_over_logic', '道理讲到这儿就讲完了。剩下的没法用道理讲清楚，你的身体知道答案。'],
  ['overfitting_profundity', '表面上是选题问题。本质上，这是人与时代的对抗。归根结底，是存在的意义问题。'],
  ['fake_precise_emotion', '他说完那句话，我的心跳停了 1.7 秒，指尖在 2.3 秒内发凉。'],
  ['fake_story', '我有个朋友，做了三年，收入翻了三倍。'],
  ['vague_case', '有位老板花了三天拍一条视频，剪了五遍，发出去只有几十个赞。'],
  ['synonym_swapping', '这件事的关键在于时机。这个节点的窗口在于机会。此际的抓手在于机遇。'],
  ['naming_ritual', '我把它叫做内容资产负债表。后来我又给它起了个名字，叫选题复利模型。'],
  ['block_all_rebuttals', '有人会说这太理想化，也有人说成本扛不住，还有人说团队做不到，更有人说平台不认。但这些担心统统不成立。'],
  ['dump_all_knowledge', '从 PMF 到 LTV，从 AARRR 到 ROI，认知带宽、心智占位、飞轮效应、边际成本、网络效应，共同构成了增长的底层架构。'],
  ['repeated_concession', '固然这个做法有效，但是成本高；当然那个路径能走，但是慢；诚然第三种办法新，但是风险大。'],
  ['smooth_emotion_curve', '一开始我很焦虑，后来我慢慢平静，最后我彻底释然，现在我只是把它当成一件事在做。'],
  ['no_hesitation', '这样做一定有效。这条路必然成功。这个判断绝对没错。这个结论肯定成立。'],
  ['vulnerability_serves_point', '我把自己最难堪的那次讲出来，正是因为它能证明这个观点，也证明了我自己。'],
  ['conclusion_as_protocol', '结论落成协议：第一步定义角色，第二步锁定场景，第三步固定频次，第四步留痕复盘。'],
  ['even_sentence_rhythm', '今天讲选题。选题定生死。生死看人群。人群要具体。具体到场景。场景有情绪。情绪能传播。传播靠重复。'],
  ['strawman_reader', '你可能会问，这有什么难的？其实很多人就是这么想的。'],
  ['even_parallelism', '你得会拍，你得会剪，你还得会写。'],
  ['connector_overuse', '很多人做不好内容。然而，问题不在能力。事实上，方法更重要。值得注意的是，坚持才是关键。'],
]

console.log('规则\t\t\t\t喂了犯样文本\t结果')
const silent = []
for (const [code, body] of cases) {
  const result = scanGeneratedBody(body, '抖音')
  const fired = (result.evidence || []).some(item => item.code === code)
  const others = [...new Set((result.evidence || []).map(item => item.code))].join(',')
  if (!fired) silent.push(`${code}（这段被报成：${others || '什么都没报'}）`)
  console.log(`${fired ? '响' : '不响'}\t\t${code}\t被报的代号：${others || '无'}`)
}
console.log(`\n合计 ${cases.length} 条，不响 ${silent.length} 条`)
for (const item of silent) console.log('  不响：' + item)
