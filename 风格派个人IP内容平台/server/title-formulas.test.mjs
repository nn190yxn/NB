import assert from 'node:assert/strict'
import test from 'node:test'
import { findTitleFormula, titleFormulaCatalog, titleFormulaSource, titleFormulas, titleLibraries, titleTriggerCategories, validateTitlePlans } from './title-formulas.mjs'

test('75 条公式照源库抄全，编号连续不重', () => {
  assert.equal(titleFormulas.length, 75)
  assert.deepEqual(titleFormulas.map(item => item.id), Array.from({ length: 75 }, (_, index) => index + 1))
  assert.equal(new Set(titleFormulas.map(item => item.id)).size, 75)
  titleFormulas.forEach(item => {
    assert.ok(item.template?.trim(), `第 ${item.id} 条缺模板`)
    assert.ok(item.example?.trim(), `第 ${item.id} 条缺原始举例`)
  })
})

test('12 类心理触发器齐全，每条公式落在自己那类的编号区间里', () => {
  assert.equal(titleTriggerCategories.length, 12)
  titleTriggerCategories.forEach(category => {
    const [min, max] = category.range
    const owned = titleFormulas.filter(item => item.category === category.id)
    assert.ok(owned.length > 0, `${category.id} 类没有公式`)
    owned.forEach(item => assert.ok(item.id >= min && item.id <= max, `第 ${item.id} 条的编号不在 ${category.id} 的 ${min}-${max} 区间里`))
    assert.ok(category.mechanism?.trim() && category.scenes?.trim(), `${category.id} 缺核心机制或适合场景`)
  })
  // 12 类的区间合起来正好盖满 1-75，不留缝也不重叠。
  const total = titleTriggerCategories.reduce((sum, category) => sum + (category.range[1] - category.range[0] + 1), 0)
  assert.equal(total, 75)
})

test('抖音与视频号各一份库，共用公式、差别只在取用建议，举例标清来自小红书', () => {
  assert.deepEqual(Object.keys(titleLibraries).sort(), ['抖音', '视频号'])
  for (const [platform, library] of Object.entries(titleLibraries)) {
    assert.equal(library.platform, platform)
    assert.ok(library.preferred.length > 0)
    // 取用建议必须指向真实存在的分类，不能写个不存在的分类名。
    library.preferred.forEach(id => assert.ok(titleTriggerCategories.some(item => item.id === id), `${platform} 的取用建议里有不存在的分类：${id}`))
    // 原始举例只有小红书一份来源，不许含糊成「平台爆款」。
    assert.equal(library.exampleSource, titleFormulaSource)
    assert.match(library.exampleNote, /小红书/)
    assert.equal(titleLibraries[platform].preferredNote.includes('不是平台官方数据'), true, '取用建议要标清是建议不是官方数据')
  }
  // 两份库的取用建议不同，否则「各建一份」是假的。
  assert.notDeepEqual(titleLibraries.抖音.preferred, titleLibraries.视频号.preferred)
})

test('喂给模型的目录把平台偏好的分类排在前面，且仍然照抄源库原文', () => {
  const catalog = titleFormulaCatalog('抖音')
  assert.equal(catalog.length, 12)
  assert.deepEqual(catalog.slice(0, titleLibraries.抖音.preferred.length).map(item => item.category), titleLibraries.抖音.preferred)
  catalog.slice(0, titleLibraries.抖音.preferred.length).forEach(item => assert.equal(item.preferred, true))
  const all = catalog.flatMap(item => item.formulas)
  assert.equal(all.length, 75)
  all.forEach(item => {
    const source = findTitleFormula(item.id)
    assert.equal(item.template, source.template, '目录里的模板要和源库逐字一致')
    assert.equal(item.example, source.example, '目录里的举例要和源库逐字一致')
  })
  // 没有平台时给全量，不报错。
  assert.equal(titleFormulaCatalog('小红书').length, 12)
})

test('方案必须溯源到真实公式编号，编的、空的、重复的一律丢掉', () => {
  const plans = validateTitlePlans([
    { formula_id: 34, title: '90 天把内容做成能成交的系统', why: '结果承诺型，时间框架明确' },
    { formula_id: 999, title: '不存在的公式编号', why: '编的' },
    { formula_id: 13, title: '   ', why: '空标题' },
    { formula_id: 34, title: '同一条公式再来一个', why: '重复' },
    { formula_id: '15', title: '3 件阻碍你涨粉的事', why: '字符串编号也要能对上' },
  ], '抖音')
  assert.deepEqual(plans.map(item => item.formula_id), [34, 15])
  // AC 要求的四项溯源字段都要跟着方案走。
  const first = plans[0]
  assert.equal(first.formula_template, findTitleFormula(34).template)
  assert.equal(first.formula_example, findTitleFormula(34).example)
  assert.equal(first.formula_example_source, titleFormulaSource)
  assert.equal(first.category, '结果承诺')
  assert.equal(first.category_label, '结果承诺型（具体结果 + 时间框架）')
  assert.equal(first.platform, '抖音')
  // 全是不合法的方案：返回空数组，不编一条兜底。
  assert.deepEqual(validateTitlePlans([{ formula_id: 'x' }], '抖音'), [])
  assert.deepEqual(validateTitlePlans(null, '抖音'), [])
})

test('源库两处原始举例重样的地方如实记下，不替源文遮掩', () => {
  // 第 9 条与第 21 条重样，第 60 条与第 39 条重样——源文如此，照抄并标记。
  assert.match(findTitleFormula(9).sourceNote, /第 21 条/)
  assert.match(findTitleFormula(60).sourceNote, /第 39 条/)
  assert.equal(findTitleFormula(9).example, findTitleFormula(21).example, '源文重样就照抄，不擅自改举例')
})
