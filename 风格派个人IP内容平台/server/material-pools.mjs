// 料台分池（阶段 2）。
//
// 分池的依据只有一个：这条素材会不会过期。
//   热点素材：搜进来的热点和资讯。有保鲜期（默认 30 天，Alex 定），到点自动沉底——不删，只是不再挡在眼前。
//   自建素材：你的经历、案例、客户原话。不会过期，越用越厚。
//
// 所以不另存一个「池」字段：存了就会和 expires_at 打架，两处不一致时没人知道该信哪个。
// 老素材没有 expires_at，读出来就是自建素材；没有 use_tag，读出来就是留空——
// 等于「旧数据全部迁进自建素材、用途签留空」，而且是只读推导，一行历史数据都不用改。

export const hotMaterialShelfDays = 30

export const materialUseTags = ['pierce', 'proof']
export const materialUseTagLabels = { pierce: '戳人的', proof: '证明的' }

export function materialPoolOf(item) {
  return Number.isFinite(Date.parse(String(item?.expires_at || ''))) ? 'hot' : 'built'
}

export function useTagOf(item) {
  return materialUseTags.includes(item?.use_tag) ? item.use_tag : null
}

// 剩几天：向上取整到天，界面才好说「剩 3 天」；已过期返回 0 或负数。
export function daysLeft(expiresAt, now = new Date()) {
  const at = Date.parse(String(expiresAt || ''))
  if (!Number.isFinite(at)) return null
  return Math.ceil((at - now.getTime()) / 86400000)
}

// 还能不能用：没删、没过期。三个计数都按这个口径，过期的沉底就不该再算成「能拍」。
export function materialUsable(item, now = new Date()) {
  if (item?.deleted_at) return false
  if (materialPoolOf(item) !== 'hot') return true
  return daysLeft(item.expires_at, now) > 0
}

export function materialExpired(item, now = new Date()) {
  return materialPoolOf(item) === 'hot' && !materialUsable(item, now)
}

// 热点素材的默认保鲜期。允许调用方改天数，但不接受一个已经过去的时间点。
export function hotMaterialExpiry(now = new Date(), days = hotMaterialShelfDays) {
  const span = Number.isFinite(Number(days)) && Number(days) > 0 ? Number(days) : hotMaterialShelfDays
  return new Date(now.getTime() + span * 86400000).toISOString()
}

// 料台首页三个数：还有几个由头能拍、几条能起角度、几条能撑中段。
export function materialPoolSummary(materials = [], now = new Date()) {
  const usable = materials.filter(item => materialUsable(item, now))
  const hotDays = usable.filter(item => materialPoolOf(item) === 'hot').map(item => daysLeft(item.expires_at, now)).sort((a, b) => a - b)
  return {
    hot: hotDays.length,
    soonest_days: hotDays.length ? hotDays[0] : null,
    pierce: usable.filter(item => useTagOf(item) === 'pierce').length,
    proof: usable.filter(item => useTagOf(item) === 'proof').length,
  }
}

// 新建素材时定池：热点类素材自动带保鲜期，其余不过期。
// 调用方显式给了 expires_at 就以它为准（传 null 表示不过期）。
// 用途签不填就是 null——不填也要能存。
export function poolFieldsForNew({ kind, expiresAt, useTag, now = new Date() } = {}) {
  const fallback = kind === 'hotspot' ? hotMaterialExpiry(now) : null
  const expires = expiresAt === undefined ? fallback : expiresAt
  return {
    expires_at: Number.isFinite(Date.parse(String(expires || ''))) ? String(expires) : null,
    use_tag: materialUseTags.includes(useTag) ? useTag : null,
  }
}

// 列表里给每条素材带上分池结果，供界面直接用，不要让界面自己再算一遍口径。
export function withPoolFields(item, now = new Date()) {
  const pool = materialPoolOf(item)
  return {
    ...item,
    use_tag: useTagOf(item),
    material_pool: pool,
    days_left: pool === 'hot' ? daysLeft(item.expires_at, now) : null,
    expired: materialExpired(item, now),
  }
}
