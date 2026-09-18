// Requirement 14 第 1 条：移植 dbs-xhs-title 的公式库形态。
//
// 数据逐条抄自 C:\Users\Alex\.agents\skills\dbs-xhs-title\SKILL.md（第 190-725 行），不改写、不改编。
// 字段对齐 AC 要求的四项：公式编号 / 心理触发器分类 / 原始举例 / 为什么选它。
//
// 「为什么选它」源库里没有这个字段——它是源技能 Step 3 生成定制标题时现写的一句话。
// 所以这里不编一个假的：方案输出时由模型按公式与话题填，服务端只校验编号存在（见 validateTitlePlans）。
//
// 源库每条还带 3 条行业举例，没有移植：AC 列的四个字段里没有它，且它占源文大半篇幅。
//
// 平台两份库：源库的例子全是小红书爆款，本项目只做抖音与视频号，手上没有那两个平台的爆款素材。
// 所以两份库共用同一份公式数据，只在平台取用建议上不同；原始举例保留小红书原文并标清来源。
// 编一份「抖音爆款举例」出来是假数据，这件事不做。

export const titleFormulaSource = '小红书（YAO《182 个小红书爆款标题清单》，去重合并后分类）'

// 12 类心理触发器。range 与源库速查表一致。
export const titleTriggerCategories = [
  { id: '认知冲突', label: '认知冲突型（反常识）', range: [1, 6], mechanism: '打破用户已有认知，制造「这不对吧？」的停留', scenes: '观点输出、科普、打破行业误区' },
  { id: '好奇缺口', label: '好奇缺口型（信息不对称）', range: [7, 12], mechanism: '暗示「有你不知道的信息」，制造信息焦虑', scenes: '揭秘类、行业内幕、经验分享' },
  { id: '恐惧损失', label: '恐惧/损失规避型（不点就亏）', range: [13, 20], mechanism: '激活损失厌恶心理，「不看就会错过或犯错」', scenes: '避坑类、警告类、纠错类' },
  { id: '身份代入', label: '身份代入型（精准圈人）', range: [21, 25], mechanism: '用身份标签让目标人群觉得「这说的就是我」', scenes: '垂直人群内容、精准获客' },
  { id: '数字锚定', label: '数字锚定型（降低认知成本）', range: [26, 32], mechanism: '数字让信息具体化，降低点击决策成本', scenes: '方法论、清单类、教程类' },
  { id: '结果承诺', label: '结果承诺型（具体结果 + 时间框架）', range: [33, 40], mechanism: '承诺可量化的结果，降低用户的不确定感', scenes: '教程类、变现类、效率类' },
  { id: '社会证明', label: '社会证明/反转叙事型（案例驱动）', range: [41, 47], mechanism: '用真实经历或案例建立信任，反转制造戏剧性', scenes: '经验分享、逆袭故事、客户案例' },
  { id: '争议挑衅', label: '争议/挑衅型（制造站队感）', range: [48, 55], mechanism: '问句或对立观点制造站队感，激活评论区', scenes: '观点类、讨论类、评论区互动' },
  { id: '场景条件', label: '场景/条件型（精准匹配用户状态）', range: [56, 60], mechanism: '描述用户当前处境，制造「这说的就是我现在」的共鸣', scenes: '解决方案类、阶段性建议' },
  { id: '行动号召', label: '行动号召型（直接推动行动）', range: [61, 66], mechanism: '给出明确的行动指令或态度宣言', scenes: '鸡血类、态度类、行动指南' },
  { id: '权威借力', label: '权威借力型（名人/案例背书）', range: [67, 71], mechanism: '借用已有权威提升内容可信度', scenes: '方法论分享、读书笔记、案例拆解' },
  { id: '互动测试', label: '互动/测试型（激活参与感）', range: [72, 75], mechanism: '邀请用户参与，提升互动率', scenes: '测评类、投票类、评论区互动' },
]

// 75 条公式。template 是套用模板，example 是源库标注的「📌 原始爆款」原文。
// sourceNote 只在源文本身有问题时出现，如实记下，不替源文遮掩。
export const titleFormulas = [
  { id: 1, category: '认知冲突', template: '为什么 [每个人都觉得很好的事] 其实对你有害？', example: '为什么喝牛奶其实对你一点也不好？' },
  { id: 2, category: '认知冲突', template: '为什么 [非传统操作] 是对 [目标] 有益的', example: '为什么补充脂肪，对你减肥有益' },
  { id: 3, category: '认知冲突', template: '为什么我不 [绝大多数人做的事]', example: '为什么我不玩微信朋友圈' },
  { id: 4, category: '认知冲突', template: '[行动] [行动] [行动] 的共同好处', example: '喝咖啡，玩游戏，骂脏话的共同好处' },
  { id: 5, category: '认知冲突', template: '为什么 [话题] 会改变一切', example: '为什么脸书算法的更新会改变一切' },
  { id: 6, category: '认知冲突', template: '犯了 [不同寻常的错]，我反而 [好结果]', example: '犯了这个不同寻常的错，我反而在台上特别自信' },
  { id: 7, category: '好奇缺口', template: '[一群人] 不会告诉你的建议', example: '会赚钱的博主不会告诉你的建议' },
  { id: 8, category: '好奇缺口', template: '[专家们] 不想让你知道的 [数字] 件事', example: '营销专家们不想要你知道的 5 件事' },
  { id: 9, category: '好奇缺口', template: '达到 [结果]，令人意想不到的秘密', example: '给每个 35+ 职场女性的终极建议', sourceNote: '源库此处「原始爆款」与第 21 条重样，疑似源文笔误；照抄不改，用时以模板为准' },
  { id: 10, category: '好奇缺口', template: '[结果] 让你想不到的秘密', example: '全职主妇副业 90 天月入 5 万，让你想不到的秘密' },
  { id: 11, category: '好奇缺口', template: '关于 [某件事]，[一群人] 太晚知道的 [数字] 个教训', example: '关于互联网营销，创业者们太晚知道的 3 个教训' },
  { id: 12, category: '好奇缺口', template: '看完这个，你的 [想法] 会不再相同', example: '看完这个，你的思维模式会不再相同' },
  { id: 13, category: '恐惧损失', template: '[不想要的结果] 的最快方法', example: '台上演讲时失去自信的最快方法' },
  { id: 14, category: '恐惧损失', template: '[不想要的结果] 的最根本原因', example: '减肥不成功的最根本原因' },
  { id: 15, category: '恐惧损失', template: '[数字] 件阻碍你达成 [结果] 的事', example: '3 件阻碍你 IP 变现的事' },
  { id: 16, category: '恐惧损失', template: '[行为] 的后果', example: '不会网络营销的后果' },
  { id: 17, category: '恐惧损失', template: '警告！[数字] 件事正让你的 [努力] 白费', example: '警告！这 3 件事正让你的保湿霜涂了等于白涂' },
  { id: 18, category: '恐惧损失', template: '[平台/领域] 上这 [数字] 件事千万别做', example: '小红书上，这 3 件事千万别做' },
  { id: 19, category: '恐惧损失', template: '[一群人] 常犯的 [数字] 个错误', example: '新手营销人写文案时常犯的 12 大错误' },
  { id: 20, category: '恐惧损失', template: '[数字] 个最危险的 [话题]', example: '3 个最危险的减肥方法' },
  { id: 21, category: '身份代入', template: '给每个 [年龄层/身份] 人的终极 [建议]', example: '给每个 35+ 职场女性的终极建议' },
  { id: 22, category: '身份代入', template: '为 [某种特质的人] 量身定制的 [方案]', example: '为镜头害羞的创业者们量身定制的视频营销策略' },
  { id: 23, category: '身份代入', template: '给 [一群人] 的一个忠告', example: '给 30+ 正经历迷茫的创业者们的一段话 - YAO' },
  { id: 24, category: '身份代入', template: '[指出特征] 的人', example: '25 岁还没有分文存款的人' },
  { id: 25, category: '身份代入', template: '给 [一群人] 的最好忠告', example: '给创业失败的人的最好忠告' },
  { id: 26, category: '数字锚定', template: '[数字] 个达成 [结果] 的小窍门', example: '5 个创造让人无法抗拒 OFFER 的小窍门' },
  { id: 27, category: '数字锚定', template: '[话题] 的 [数字] 个步骤', example: '搞懂小红书运营的 10 个步骤' },
  { id: 28, category: '数字锚定', template: '[结果] 的 [数字] 个技巧', example: '小红书增粉的 10 个技巧' },
  { id: 29, category: '数字锚定', template: '[行动] 时，[数字] 个最有用的词', example: '说服别人时，5 个最有用的词汇' },
  { id: 30, category: '数字锚定', template: '让你更 [结果] 的 [数字] 个方法', example: '让你在镜头前更自信的 5 个方法' },
  { id: 31, category: '数字锚定', template: '[数字] 个让你 [结果] 的特质', example: '5 个让你立刻产生公信力的特质' },
  { id: 32, category: '数字锚定', template: '[数字] 个 [话题] 的最大谎言', example: '5 个对抗焦虑的最大谎言' },
  { id: 33, category: '结果承诺', template: '如何不 [讨厌的事]，就能在 [时间] 里达到 [结果]', example: '如何不付 KOL 广告费，就能在一个月内从小红书变现' },
  { id: 34, category: '结果承诺', template: '[数字] 天内 [结果] 的唯一办法', example: '90 天内打造个人 IP 变现 6 位数的唯一办法' },
  { id: 35, category: '结果承诺', template: '我如何在 [时间] 内 [结果]', example: '我如何在 90 分钟赚到 10 万' },
  { id: 36, category: '结果承诺', template: '没有 [资源]，也能 [结果]', example: '不会 IT，也能几分钟搭好你的自建站' },
  { id: 37, category: '结果承诺', template: '如何把 [小数] 变成 [大数]', example: '如何把 ¥100 变成 ¥10000' },
  { id: 38, category: '结果承诺', template: '[结果]，头 [数字] 小时你需要做什么', example: '开赚钱的网店，头 24 小时你需要做什么' },
  { id: 39, category: '结果承诺', template: '一招就能帮你带来三倍 [结果]', example: '一招就能帮你带来三倍的赞藏量' },
  { id: 40, category: '结果承诺', template: '如何 [行动]，好让你 [结果]', example: '如何开始副业，好让你赚钱带娃两不误' },
  { id: 41, category: '社会证明', template: '我是如何从 [不想要的结果] 到 [想要的结果]', example: '我是如何从身无分文到年入百万' },
  { id: 42, category: '社会证明', template: '从 [经历] 中学到的最重要的教训', example: '从年入 7 位数到公司破产，我学到的最重要的教训' },
  { id: 43, category: '社会证明', template: '我是如何在没有 [资源] 的情况下 [结果]', example: '我是如何在没有产品的情况下，创造了 6 位数的收入' },
  { id: 44, category: '社会证明', template: '[话题] - 买家秀/成功案例', example: '「我如何 6 个月就完成了 1 年的业绩」 - 过往案例' },
  { id: 45, category: '社会证明', template: '[负面事件] 是如何带给我 [正面结果] 的', example: '公司破产是如何带给我财富自由和内心平静的' },
  { id: 46, category: '社会证明', template: '我差一点就 [负面的事]', example: '我差一点就不再相信任何人' },
  { id: 47, category: '社会证明', template: '从 [经历] 中我所学到的', example: '跟好朋友一起创业失败，我学到了什么' },
  { id: 48, category: '争议挑衅', template: '[行动] 是在浪费时间么？', example: '寻找愿意免费合作的 KOL 是在浪费时间么？' },
  { id: 49, category: '争议挑衅', template: '[结果] 会让你快乐么？', example: '赚 10 万会让你快乐么？' },
  { id: 50, category: '争议挑衅', template: '[行动] 会不会是你做过的最好决定？', example: '裸辞会不会是你做过的最好决定？' },
  { id: 51, category: '争议挑衅', template: '[已经过时了] 么？', example: '做微商已经过时了么？' },
  { id: 52, category: '争议挑衅', template: '[好的特质] VS [坏的特质] - 如何区分', example: '自信 VS 自大 - 如何区分' },
  { id: 53, category: '争议挑衅', template: '[一群人] 是天生的，还是后天养成的', example: '领导者是天生的，还是后天养成的' },
  { id: 54, category: '争议挑衅', template: '停止 [行动]！！开始 [行动]！！', example: '停止学习！！开始实践！！' },
  { id: 55, category: '争议挑衅', template: '你到底要不要 [话题]', example: '你到底要不要用眼霜？' },
  { id: 56, category: '场景条件', template: '如果你 [抗拒] [抗拒] [抗拒]，如何解决 [问题]', example: '如果你没有经验，没有团队，没有专业技能，如何在充满噪音的互联网上出彩？' },
  { id: 57, category: '场景条件', template: '在 [人生阶段] 之后，你需要做的事情', example: '大学毕业后，你最需要做的事情！！' },
  { id: 58, category: '场景条件', template: '当 [一群人] 说「[引用]」', example: '当你的客户说，「让我想想」' },
  { id: 59, category: '场景条件', template: '如果你可以拿 [拥有的] 换 [可以拥有的]，你愿意么？', example: '如果你可以拿 10 万块换到 10 万账号粉丝，你愿意么？' },
  { id: 60, category: '场景条件', template: '当你知道你会 [负面情绪]，如何 [结果]', example: '一招就能帮你带来三倍的赞藏量', sourceNote: '源库此处「原始爆款」与第 39 条重样，疑似源文笔误；照抄不改，用时以模板为准' },
  { id: 61, category: '行动号召', template: '为什么你应该停止 [行动]', example: '为什么你应该停止不停的学习' },
  { id: 62, category: '行动号召', template: '别再关心 [话题]', example: '别再关心别人怎么看你了' },
  { id: 63, category: '行动号召', template: '别再寻找 [结果]，开始行动才是王道', example: '别再寻找做副业的捷径了，开始行动才是王道' },
  { id: 64, category: '行动号召', template: '戒掉 [平常的事] - 这会让你和别人不一样', example: '戒掉朋友圈 - 这会让你和别人不一样' },
  { id: 65, category: '行动号召', template: '为什么我 [讨厌做的事]，你也应该这么做', example: '为什么我每天 4 点起床，你也应该这么做' },
  { id: 66, category: '行动号召', template: '如何每天 [积极的事]，哪怕你 [不方便] 都可以', example: '如何每天坚持读书，哪怕只有 5 分钟' },
  { id: 67, category: '权威借力', template: '[名人] [话题] 帮助我 [结果]', example: 'TONY ROBBINS 的晨间冥想帮助我保持心流状态' },
  { id: 68, category: '权威借力', template: '[名人] 教会我 [话题] 的技能', example: '奥普拉教会我反转逆境的技能' },
  { id: 69, category: '权威借力', template: '[名人] 如何 [结果]', example: 'GARY V - 如何更经常的说不' },
  { id: 70, category: '权威借力', template: '最好的 [一群人] 都做了什么不同的事情？', example: '最赚钱的短线投资人都做了什么不同的事情？' },
  { id: 71, category: '权威借力', template: '[一群人] [做一件事] 成功的最根本原因', example: '全职妈妈副业成功的最根本原因' },
  { id: 72, category: '互动测试', template: '敢不敢测一测，[话题]', example: '敢不敢测一测，你的脸书主页是不是最优化的' },
  { id: 73, category: '互动测试', template: '如果你想要 [结果]，你需要先对它着迷', example: '如果你想要赚钱，你需要先对它着迷' },
  { id: 74, category: '互动测试', template: '关于 [话题]，我的处世哲学/原则', example: '关于宝妈创业，我的基本原则' },
  { id: 75, category: '互动测试', template: '至关紧要的头 [数字] 分钟 - 如何 [话题]', example: '至关紧要的头一分钟 - 如何谈判' },
]

// Requirement 14 第 1 条的两份平台库。公式数据完全共用，差别只在「这个平台先看哪几类」。
// preferred 是本项目的取用建议，不是平台官方数据——按这个前提读它。
export const titleLibraries = {
  抖音: {
    platform: '抖音',
    preferred: ['认知冲突', '好奇缺口', '争议挑衅', '恐惧损失'],
    preferredNote: '按抖音「前 3 秒决定完播」取的：优先能制造停留的前几类。这是本项目的取用建议，不是平台官方数据。',
    exampleSource: titleFormulaSource,
    exampleNote: '原始举例全部是小红书爆款，抖音没有对应素材。不做改写，也不编一份抖音版出来。',
  },
  视频号: {
    platform: '视频号',
    preferred: ['身份代入', '社会证明', '权威借力', '场景条件'],
    preferredNote: '按视频号「熟人转发、信任先于好奇」取的：优先人群精准与可信度那几类。这是本项目的取用建议，不是平台官方数据。',
    exampleSource: titleFormulaSource,
    exampleNote: '原始举例全部是小红书爆款，视频号没有对应素材。不做改写，也不编一份视频号版出来。',
  },
}

export const findTitleFormula = id => titleFormulas.find(item => item.id === Number(id)) || null
export const titleCategoryOf = id => titleTriggerCategories.find(item => item.id === id) || null
export const titleLibraryOf = platform => titleLibraries[platform] || null
export const titleFormulasOfCategory = category => titleFormulas.filter(item => item.category === category)

// 喂给模型看的目录：分类 + 取用建议 + 全部模板。举例也带上，模型才知道每条被验证过什么样。
export function titleFormulaCatalog(platform) {
  const library = titleLibraryOf(platform)
  const categories = library ? [...library.preferred.map(id => titleCategoryOf(id)), ...titleTriggerCategories.filter(item => !library.preferred.includes(item.id))] : titleTriggerCategories
  return categories.filter(Boolean).map(category => ({
    category: category.id,
    label: category.label,
    mechanism: category.mechanism,
    preferred: Boolean(library?.preferred.includes(category.id)),
    formulas: titleFormulasOfCategory(category.id).map(item => ({ id: item.id, template: item.template, example: item.example })),
  }))
}

// Requirement 14 第 4 条：每个方案必须溯源到真实存在的公式编号。
// 编号不存在、标题为空、同一条公式出两个方案，三者都直接丢掉——宁可少给，不给编的。
export function validateTitlePlans(plans, platform) {
  const seen = new Set()
  return (Array.isArray(plans) ? plans : []).reduce((kept, plan) => {
    const formula = findTitleFormula(plan?.formula_id)
    const title = String(plan?.title || '').trim()
    if (!formula || !title || seen.has(formula.id)) return kept
    seen.add(formula.id)
    const category = titleCategoryOf(formula.category)
    kept.push({
      platform,
      formula_id: formula.id,
      formula_template: formula.template,
      formula_example: formula.example,
      formula_example_source: titleFormulaSource,
      category: formula.category,
      category_label: category?.label || formula.category,
      title,
      why: String(plan?.why || '').trim(),
    })
    return kept
  }, [])
}
