// 实测脚本三：去 AI 味改写前后对比。
// 同一段稿子，改写前 / 改写后各扫一遍，并数几个「一眼能看见」的 AI 味指标。
// 用法：node .monkeycode-tmp-files/walk-20261013/compare-deai.mjs
import { scanGeneratedBody } from '../../server/draft-checks.mjs'

const before = '我们常说要构建个人IP，但很多人陷入了一个误区：把内容当成作品，而不是产品。作品追求完美，产品追求验证。我见过很多老板，花了三天拍一条视频，剪了五遍，发出去只有几十个赞，然后就开始怀疑人生，甚至怀疑自己的定位。其实问题不在内容，而在评估体系。钱是唯一诚实的反馈。点赞可能是客套，评论可能是吐槽，但转账一定是认可。你服务过的客户里，有多少人是因为你的内容而找到你的？这才是你该关注的核心数据。定位先于内容，意味着你不是在写文案，而是在设计一个筛选漏斗。素材原子化，是为了让你用小成本快速试错，而不是抱着一个想法反复打磨直到窒息。评估后再拍摄，是为了让你把精力花在能产生现金流的内容上，而不是为了点赞数去取悦算法。如果你的内容只能换来点赞，换不来咨询，那它只是你的自嗨。真正的IP内容，是让人看完之后，想加你微信，想买你的课，想找你合作。钱会说话，它会告诉你，你是不是真的在提供价值。别让虚荣指标绑架了你的判断，去看看你的账户余额，那里才是对你内容最真实的打分。'

const after = '做个人IP，很多人第一步就走偏了：把内容当作品，不是产品。\n\n作品要完美，产品要验证。\n\n我见过太多老板，拍一条视频折腾三天，剪了五遍，发出去几十个赞，然后就开始怀疑人生，甚至怀疑自己的定位。\n\n其实问题不在内容，在评估体系。\n\n钱是唯一诚实的反馈。\n\n点赞可能是客套，评论可能是吐槽，但转账一定是认可。\n\n你服务过的客户里，有多少人是看了你的内容才找上门的？这才是你该盯的核心数据。\n\n所谓"定位先于内容"，说白了，你不是在写文案，是在设计一个筛选漏斗。\n\n素材原子化，是为了低成本试错，不是抱着个想法反复打磨直到窒息。\n\n评估后再拍摄，是为了把钱花在能带来现金流的内容上，别为了骗几个赞去讨好算法。\n\n如果你的内容只能换点赞，换不来咨询，那就是自嗨。\n\n真正的IP内容，是让人看完想加你微信、想买你的课、想找你合作。\n\n钱会说话，它会告诉你，你是不是真的在提供价值。\n\n别让虚荣指标绑架了判断，看看账户余额，那才是对你内容最真实的打分。'

const metrics = body => ({
  字数: body.length,
  段落数: body.split(/\n\s*\n/).filter(Boolean).length,
  句子数: body.split(/[。！？]/).filter(s => s.trim()).length,
  '最长句': Math.max(...body.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean).map(s => s.length)),
  '平均句长': Math.round(body.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean).reduce((sum, s) => sum + s.length, 0) / body.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean).length),
  '不是X是Y次数': (body.match(/不是[^。！？\n]{1,16}[，,]\s*(而?是|就是)/g) || []).length,
  三连排比次数: (body.match(/想[^。！？\n]{2,8}，想[^。！？\n]{2,8}，想[^。！？\n]{2,8}/g) || []).length,
  编造案例说法: (body.match(/我见过(很多|太多|不少)|我有个朋友|我身边有个/g) || []).length,
  借来的金句: (body.match(/钱是唯一诚实的反馈|钱会说话/g) || []).length,
  升华式结尾: (body.match(/那(里|才)才是[^。！？]*打分|别让[^。！？]*绑架/g) || []).length,
  咨询腔词: (body.match(/构建|底层|逻辑|体系|漏斗|指标|评估/g) || []).length,
})

const report = {}
for (const [label, body] of [['改写前', before], ['改写后', after]]) {
  const scan = scanGeneratedBody(body, '视频号')
  report[label] = {
    ...metrics(body),
    检测器命中代号: [...new Set((scan.evidence || []).map(item => item.code))],
    检测器命中数: (scan.evidence || []).length,
  }
}
report.结论 = {}
for (const key of Object.keys(report.改写前)) {
  const a = report.改写前[key], b = report.改写后[key]
  if (a === b) report.结论[key] = `没变（${a} → ${b}）`
  else report.结论[key] = `${a} → ${b} ${b < a ? '改善' : '更差'}`
}
console.log(JSON.stringify(report, null, 2))
