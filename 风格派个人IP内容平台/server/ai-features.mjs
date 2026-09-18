// 移植自 dbs-ai-check（C:\Users\Alex\.agents\skills\dbs-ai-check）的 22 个特征骨架。
// 特征名、背后意图、追问三样全部照抄，不改写：规格要求的是移植，不是我们另起一套。
//
// 严重度：源技能只给了三档图例（🔴 强信号 / ⚠️ 中信号 / 💡 弱信号），没有逐条标注。
// 下面的逐条分布是我们的判断，依据是源技能自带的「误伤警告」表——有明确误伤阈值、
// 或需要结合体裁才能判的特征一律不放进强信号，避免把正常修辞当 AI 味。
//
// 追问同样遵守源技能的自检规则：一条只问一个问题、不用选择题结构、
// 不用「不是 X 是 Y」、不用「本质上 / 归根结底」升维。

export const aiFeatureSeverityLabels = { strong: '强信号', medium: '中信号', weak: '弱信号' }

export const aiFeatures = [
  { id: 1, code: 'block_all_rebuttals', name: '堵住所有反驳', severity: 'medium', intent: '论证无懈可击', question: '你堵了这些反驳，哪个是你真的被人问过的？只留那个。剩下的读者也能感觉到是你想象出来的。', not_applicable: '源技能要判断论证有没有把反驳全堵上，这是覆盖面，规则看不到「全」。特征 7 已管「替读者说一句再纠正」的形态。误伤表还写学术和法律穷尽反驳是规范。' },
  { id: 2, code: 'dump_all_knowledge', name: '知识全部输出', severity: 'medium', intent: '展示专业度', question: '你堆了这么多术语和数据，哪一个是你真正用来想事情的？留那一个，剩下的删掉。', not_applicable: '源技能要区分「用来想事情的术语」和「堆出来炫的术语」，规则读不出哪个是用来想的。源技能没有术语表，自建词表就是发明判据。' },
  { id: 3, code: 'even_parallelism', name: '匀速排比', severity: 'medium', intent: '制造节奏感和力量感', question: '这几句排比里，哪一句是你最想说的？把那一句加长或者换个说法，打破均匀。' },
  { id: 4, code: 'repeated_concession', name: '同一个让步模板反复用', severity: 'medium', intent: '逐条破除误解', question: '你走了三遍同一个让步结构，读者到第二遍就懂了。后面的能不能换个说法，或者直接跳过？' },
  { id: 5, code: 'naming_ritual', name: '给概念起名字的仪式', severity: 'medium', intent: '让概念有记忆点', question: '你给了两个概念起名字，哪个名字是你真觉得精准的？留那一个。两次以上就变魔术表演了。' },
  { id: 6, code: 'smooth_emotion_curve', name: '情绪曲线太光滑', severity: 'medium', intent: '让读者有情绪体验', question: '写的时候有没有哪个地方你自己也没完全想通？那个地方留着，别修圆了。', not_applicable: '源技能说的是「没有任何一处是作者自己也没想通的」，规则读不出想没想通，也没有可扫的句式。' },
  { id: 7, code: 'strawman_reader', name: '替读者说一句蠢话然后纠正', severity: 'weak', intent: '推进论证层次', question: '你替读者说的那句话，是你真的听到过别人这么说，还是你编出来方便自己反驳的？如果是编的，删掉，直接说你想说的。' },
  { id: 8, code: 'not_x_but_y', name: '「不是 X 是 Y」高密度', severity: 'medium', intent: '强调认知高差', question: '你翻转了三次，读者已经不觉得你深了，觉得你在教训人。哪一次翻转是你真正想说的？留那一次就够了。' },
  { id: 9, code: 'no_hesitation', name: '没有任何犹豫', severity: 'medium', intent: '展示确定性和权威感', question: '你这篇文章里有没有什么地方你其实也不太确定？写出来。读者能感觉到真的犹豫和假的自信。', not_applicable: '特征是通篇没有犹豫。规则只能扫「有没有某句」，扫不到「没有」。把下判断的口播当命中，会误伤所有敢说结论的稿。' },
  { id: 10, code: 'fake_precise_emotion', name: '精确到不真实的情绪细节', severity: 'strong', intent: '增加画面感', question: '「1.7 秒」「2.3 秒」这种数字你量过吗？你当时真的感受到的是什么？用你嘴上会说的词来描述。' },
  { id: 11, code: 'vulnerability_serves_point', name: '脆弱感服务于论点', severity: 'medium', intent: '用个人经历增强说服力', question: '你分享的这段经历，有没有哪部分跟你的论点其实没关系，但你还是记得很清楚？那部分可能比你选出来的部分更真实。', not_applicable: '源技能要判断经历哪一段是为论点服务、哪一段其实无关，规则读不懂论点和经历的关系。' },
  { id: 12, code: 'conclusion_as_protocol', name: '把结论包装成「协议」', severity: 'medium', intent: '给读者可操作的东西带走', question: '你前面花了几千字说这件事不能被简化，结尾又给了一个简化版。你觉得这个矛盾读者能看出来吗？', not_applicable: '源技能判定的是「前面说不能简化、结尾又给简化版」这个矛盾，规则看不到前后是否矛盾。单独扫「三步 / 口诀」会误伤口播体裁。' },
  { id: 13, code: 'every_paragraph_punchline', name: '每个段落都有收束金句', severity: 'weak', intent: '每段有记忆点', question: '你这篇文章最重要的一句话是哪句？让那句爆发就行，其他段落不用都收得那么漂亮。' },
  { id: 14, code: 'even_sentence_rhythm', name: '句子节奏过于均匀', severity: 'medium', intent: '无（通常是无意识的）', question: '你随便挑五句话数一下字数，是不是都差不多长？试试在某个地方加一句两三个字的短句，或者一句四十字不断的长句。', not_applicable: '源技能体裁表写明：推文 / 社交媒体句子节奏不适用（本身就短）。本工作台生产平台是抖音和视频号口播，短句均匀是体裁。' },
  { id: 15, code: 'body_feeling_over_logic', name: '用身体感受替代论证', severity: 'strong', intent: '在逻辑走到尽头时给出一个答案', question: '你用「身体知道答案」来收束，是因为你真觉得这件事没法用道理讲清楚，还是因为你讲不下去了？如果讲不下去，直接说讲不下去比编一个身体的答案更真实。' },
  { id: 16, code: 'hook_pain_promise', name: '开头「钩子 + 痛点 + 承诺」三件套', severity: 'strong', intent: '抓注意力', question: '你的前三句话在卖焦虑。你真正想让读者知道的那件事是什么？从那件事开始说。', not_applicable: '源技能说的是前三句「钩子 + 痛点 + 承诺」的组合意图，没有给出可扫词表。自建焦虑词 / 承诺词就是发明判据。' },
  { id: 17, code: 'connector_overuse', name: '连接词过度使用且位置固定', severity: 'medium', intent: '逻辑清晰', question: '搜一下你的全文里有多少个「然而」「事实上」「值得注意的是」。删掉一半，读者自己能感觉到话锋变了。' },
  { id: 18, code: 'synonym_swapping', name: '同义词刻意替换', severity: 'medium', intent: '避免重复', question: '同一段里换了好几个词说同一件事。如果这个词你觉得准，重复用。重复不是错。', not_applicable: '源技能要判断同一段里换了几个词说同一件事，没有提供同义词表。自建词表就是发明判据。' },
  { id: 19, code: 'translationese', name: '中文翻译腔', severity: 'strong', intent: '无（通常是无意识的）', question: '这句话你嘴上会怎么说？那就怎么写。特别注意「作为」「关于」「基于」「进行」这些词。' },
  { id: 20, code: 'fake_story', name: '虚假的「讲个故事」', severity: 'strong', intent: '增加说服力', question: '这个朋友叫什么？中间出过什么差错？如果你想不起来细节，换一个你自己的经历。' },
  { id: 21, code: 'you_deserve_ending', name: '结尾「你值得」式祝福', severity: 'strong', intent: '温暖的结束感', question: '删掉最后一段再读一遍。文章是不是已经结束了？' },
  { id: 22, code: 'overfitting_profundity', name: '对「深刻」的过拟合', severity: 'strong', intent: '展示思考深度', question: '你把一个实操问题升维到了哲学层面。这个话题真的需要升维吗？如果你的文章里出现了「本质上」「归根结底」且后面接了一个比前文大一号的命题，考虑删掉那句。' },
]

export const aiFeatureByCode = Object.fromEntries(aiFeatures.map(feature => [feature.code, feature]))

// 源技能的「误伤警告」表：这些句式人类作者也高频使用，到阈值才算特征。
export const aiFeatureCautions = [
  { code: 'not_x_but_y', threshold: '800 字内出现 3 次以上', note: '鲁迅、李敖、罗翔都用。低密度是正常修辞' },
  { code: 'strawman_reader', threshold: '虚构的读者声音明显被矮化', note: '这是经典修辞 prolepsis，本身不是 AI 特征' },
  { code: 'every_paragraph_punchline', threshold: '仅适用于公众号长文', note: '短视频文稿段段金句是体裁要求' },
  { code: 'block_all_rebuttals', threshold: '仅适用于自媒体/社交媒体', note: '学术写作和法律论证穷尽反驳是规范' },
  { code: 'naming_ritual', threshold: '同一篇出现 2 次以上同一句式', note: '偶尔用一次是正常修辞' },
]

// 体裁识别：不同体裁判定标准不同，检测前先定体裁。
export const aiGenreNotes = {
  短视频: ['每个段落都有收束金句 不判定', '开头三件套 和 连接词 更突出'],
  公众号: ['全部 22 条适用'],
  推文: ['句子节奏过于均匀 不适用（推文本身就短）'],
  学术: ['堵住所有反驳 和 知识全部输出 不判定'],
}

// 追问自检：追问本身不能犯 AI 特征。
export const questionSelfCheckRules = [
  '不用「你可能会觉得」开头',
  '不用「不是 X 是 Y」结构',
  '不用「本质上」「归根结底」升维',
  '不用选择题结构（A 还是 B？）',
]
