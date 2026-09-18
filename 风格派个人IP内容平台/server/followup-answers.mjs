// Requirement 12：追问的答案回写素材。
//
// unit_type 由回答内容判定：讲经历的进 CAS，讲观点的进 OPI。
// 两类特征都没有就留空等人工判定——对齐 unit-types.mjs 的既有原则：
// 分不出来不自动生成，宁可用户自己定，也不猜一个角色去污染装配。
const experiencePattern = /(?:我|本人)(?:当时|那天|那年|去年|今年|上个月|上次|之前|以前|后来|第一次|遇到过|见过|碰到过|做过|试过|接过|带过|聊过)|有个(?:客户|老板|朋友|学员|同事)|一位(?:客户|老板|朋友|学员|同事)/
const opinionPattern = /我(?:觉得|认为|看|判断|相信|建议)|其实|应该|不该|必须|不要|关键是|重点是|说白了|区别在于/

export const followupAnswerSource = '改稿追问'

export function unitTypeFromAnswer(answer) {
  const text = String(answer || '').trim()
  if (!text) return null
  const experience = text.match(experiencePattern)
  const opinion = text.match(opinionPattern)
  if (experience && !opinion) return 'CAS'
  if (opinion && !experience) return 'OPI'
  if (experience && opinion) {
    // 两类都像：看先说哪个。回答通常一开口就交代了它是经历还是判断。
    // index 一定存在（两个 match 都不为空），这里不做防御性兜底。
    return experience.index < opinion.index ? 'CAS' : 'OPI'
  }
  return null
}

// 入库前的候选素材。返回 null 表示回答为空，调用方应当拒绝而不是写一条空素材。
export function followupMaterialInput({ draft, entry, answer } = {}) {
  const content = String(answer || '').trim()
  if (!content) return null
  const draftId = Number(draft?.id)
  const code = String(entry?.code || '').trim()
  const label = String(entry?.label || code || '未命名特征')
  return {
    name: `改稿追问：${label}`,
    content,
    material_kind: 'insight',
    // 用户自己回答的，不是模型推的，所以直接是 verified。
    material_trust: 'verified',
    unit_type: unitTypeFromAnswer(content),
    strategy_layer: draft?.strategy_layer || 'trust',
    goal_refs: Array.isArray(draft?.goal_refs) ? draft.goal_refs : [],
    source: followupAnswerSource,
    draft_id: Number.isFinite(draftId) ? draftId : null,
    source_refs: [{ type: 'draft', id: String(Number.isFinite(draftId) ? draftId : '') }, { type: 'ai_feature', id: code || 'unknown' }],
  }
}
