import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformWithOxc } from 'vite'

// 执行真实组件函数与异步处理器；这是轻量 hook harness，不替代浏览器验收。
async function harness(apiJson) {
  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  const component = source.slice(source.indexOf('function Onboarding('), source.indexOf('type PositioningCandidate'))
  const states = [], effects = []
  let cursor = 0, exited = false
  const context = vm.createContext({
    apiJson,
    useState(initial) { const id = cursor++; if (!(id in states)) states[id] = initial; return [states[id], value => { states[id] = typeof value === 'function' ? value(states[id]) : value }] },
    useRef(initial) { const id = cursor++; if (!(id in states)) states[id] = { current: initial }; return states[id] },
    useEffect(fn) { const id = cursor++; if (!(id in states)) { states[id] = true; effects.push(fn) } },
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    interviewRounds: Array.from({ length: 4 }, () => ['title', 'title', 'question']),
    themes: { warm: { name: 'warm' } }, ArrowUpRight: 'icon', SunMedium: 'icon', ChevronDown: 'icon', ThemeMenu: 'themes', PositioningResult: 'result',
    window: { addEventListener() {}, removeEventListener() {} },
  })
  const transformed = await transformWithOxc(component, 'component.tsx', { jsx: { runtime: 'classic' } })
  vm.runInContext(transformed.code, context)
  function render() {
    cursor = 0
    const tree = context.Onboarding({ theme: 'warm', font: 'sans', showThemes: false, onBack: () => { exited = true } })
    effects.splice(0).forEach(fn => fn())
    return tree
  }
  function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flat(Infinity).flatMap(nodes)] }
  return { render, nodes, get exited() { return exited } }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const button = (h, tree, text) => h.nodes(tree).find(node => node.type === 'button' && node.children.some(child => typeof child === 'string' && child.trim() === text))

test('访谈：保存失败保留答案与步骤，重试成功后才继续', async () => {
  let rejectSave, saves = 0
  const h = await harness(async (_path, options) => {
    if (!options) return { interview_step: 1, interview_answers: { 0: '已答', 1: '原回答' } }
    saves++
    if (saves === 1) return new Promise((_resolve, reject) => { rejectSave = reject })
    return {}
  })
  h.render(); await flush()
  let tree = h.render()
  let textarea = h.nodes(tree).find(node => node.type === 'textarea')
  assert.equal(textarea.props.value, '原回答')
  textarea.props.onChange({ target: { value: '新回答' } })
  tree = h.render()
  button(h, tree, '继续回答').props.onClick()
  button(h, tree, '继续回答').props.onClick()
  assert.equal(saves, 1)
  rejectSave(new Error('offline')); await flush()
  tree = h.render()
  assert.equal(h.nodes(tree).find(node => node.type === 'textarea').props.value, '新回答')
  assert.ok(h.nodes(tree).some(node => node.props.role === 'alert'))
  button(h, tree, '继续回答').props.onClick(); await flush()
  tree = h.render()
  assert.equal(h.nodes(tree).find(node => node.type === 'textarea').props.value, '')
})

test('访谈：最后一题成功前不进入候选，成功后目标摘要不丢失', async () => {
  let complete, payload
  const h = await harness(async (_path, options) => {
    if (!options) return { interview_step: 3, monetization_goals: ['咨询'], acquisition_goals: ['获客'] }
    payload = JSON.parse(options.body)
    return new Promise(resolve => { complete = resolve })
  })
  h.render(); await flush()
  button(h, h.render(), '生成我的定位').props.onClick()
  assert.ok(!h.nodes(h.render()).some(node => node.type === 'result'))
  assert.equal(payload.interview_step, 4)
  complete({}); await flush()
  const result = h.nodes(h.render()).find(node => node.type === 'result')
  assert.equal(result.props.monetizationGoal, '咨询')
  assert.equal(result.props.acquisitionGoal, '获客')
})

test('访谈：稍后填写保存当前输入与账号标记，成功后退出', async () => {
  let payload
  const h = await harness(async (_path, options) => {
    if (!options) return { interview_step: 2, interview_answers: { 2: '目标受众' } }
    payload = JSON.parse(options.body); return {}
  })
  h.render(); await flush()
  button(h, h.render(), '稍后填写').props.onClick(); await flush()
  assert.equal(payload.interview_step, 2)
  assert.equal(payload.interview_answers[2], '目标受众')
  assert.ok(payload.onboarding_seen_at)
  assert.equal(h.exited, true)
})
