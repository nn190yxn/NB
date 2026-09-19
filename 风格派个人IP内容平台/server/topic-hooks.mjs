// 选题钩子（阶段 2）。
//
// 选题入口让人可以点名：这一批做哪一层、用哪一类钩子。两个都可以不选——
// 「不知道拍什么」是真问题，不选就交给模型自己判，不拦、不报错。
//
// 四类钩子只决定「开头怎么把人留住」，不决定选题本身值不值得做。

export const topicStrategyLayers = ['reach', 'trust', 'conversion']

export const topicLayerLabels = { reach: '泛流量触达', trust: '垂直信任', conversion: '核心目标转化' }

export const topicHookKinds = ['counter_consensus', 'contrast_number', 'identity', 'public_emotion']

export const topicHookLabels = {
  counter_consensus: '打翻共识',
  contrast_number: '反差数字',
  identity: '身份代入',
  public_emotion: '公共情绪',
}

const hookGuidance = {
  counter_consensus: '开头先把大家默认对的那句话摆出来，再一句话打翻它。',
  contrast_number: '用一个和直觉反着来的数字开头，让人非听下去不可。',
  identity: '开头点名「你如果是……」，让人立刻知道这条是冲他来的。',
  public_emotion: '接住一个大家正在气、正在怕、正在争议的公共话题。',
}

export function layerOf(value) {
  return topicStrategyLayers.includes(value) ? value : ''
}

export function hookKindOf(value) {
  return topicHookKinds.includes(value) ? value : ''
}

export function hookLabelOf(value) {
  return topicHookLabels[hookKindOf(value)] || ''
}

// 点名了就写成指令；没点名返回空串，让模型自己判。两条互不影响。
export function topicRequestNote({ layer, hookKind } = {}) {
  const notes = []
  if (topicLayerLabels[layer]) notes.push(`这一批三个选题全部做「${topicLayerLabels[layer]}」层。`)
  const kind = hookKindOf(hookKind)
  if (kind) notes.push(`三个选题都用同一类钩子——${topicHookLabels[kind]}：${hookGuidance[kind]}`)
  return notes.join('\n')
}
