import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformWithOxc } from 'vite'

// 提词器的速度滑块原来只存值、不参与渲染（「开始滚动」只把文字上移 11.5px），拍摄时其实不滚动。
// 现在按档位真实滚动，速度换算在这里固定下来，避免以后又变成「有滑块没效果」。
// 注意单帧位移有 250ms 上限（防切回标签页一下子跳到底），所以断言都用帧级间隔。
test('提词器速度换算：档位单调、帧率无关、异常输入不炸', async () => {
  const compiled = await transformWithOxc(readFileSync(new URL('../src/shooting-utils.ts', import.meta.url), 'utf8'), 'shooting-utils.ts')
  const utils = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)

  // 每秒 3-24 像素：一帧按 250 毫秒算，1 档 0.75 像素、8 档 6 像素
  assert.equal(utils.teleprompterStep(1, 250), 0.75)
  assert.equal(utils.teleprompterStep(8, 250), 6)

  // 档位越高滚得越快，且严格单调
  const speeds = [1, 2, 3, 4, 5, 6, 7, 8].map(speed => utils.teleprompterStep(speed, 250))
  assert.deepEqual(speeds, [...speeds].sort((a, b) => a - b))
  assert.equal(new Set(speeds).size, speeds.length)

  // 帧率无关：60 帧 × 16.7ms 与 120 帧 × 8.3ms 在同一秒内位移一致（都不触发上限）
  const at60 = Array.from({ length: 60 }, () => utils.teleprompterStep(4, 1000 / 60)).reduce((sum, value) => sum + value, 0)
  const at120 = Array.from({ length: 120 }, () => utils.teleprompterStep(4, 1000 / 120)).reduce((sum, value) => sum + value, 0)
  assert.ok(Math.abs(at60 - at120) < 0.001, `60Hz=${at60} 120Hz=${at120}`)
  assert.ok(Math.abs(at60 - 12) < 0.001, `4 档一秒应滚 12 像素，实际 ${at60}`)

  // 一句 250 字口播约 60-90 秒：默认 3 档在 70 秒里滚约 630 像素，够走完一屏（约 400 像素）
  const defaultPace = Array.from({ length: 70 * 4 }, () => utils.teleprompterStep(3, 250)).reduce((sum, value) => sum + value, 0)
  assert.ok(defaultPace > 400 && defaultPace < 900, `3 档 70 秒滚了 ${defaultPace} 像素`)

  // 越界档位夹到 1-8；单帧最多按 250ms 算；异常值不产生 NaN
  assert.equal(utils.teleprompterStep(0, 250), utils.teleprompterStep(1, 250))
  assert.equal(utils.teleprompterStep(99, 250), utils.teleprompterStep(8, 250))
  assert.equal(utils.teleprompterStep(4, 5000), utils.teleprompterStep(4, 250))
  assert.equal(utils.teleprompterStep(4, -10), 0)
  assert.equal(utils.teleprompterStep(4, Number.NaN), 0)
})
