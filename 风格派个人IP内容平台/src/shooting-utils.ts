export type TeleprompterSettings = { fontSize?: number; scrollSpeed?: number; playing?: boolean }

export function loadTeleprompterSettings(storage: Storage | undefined, id: string): TeleprompterSettings {
  if (!storage) return {}
  try {
    const value = JSON.parse(storage.getItem(`teleprompter:${id}`) || '{}')
    return value && typeof value === 'object' ? value as TeleprompterSettings : {}
  } catch {
    storage.removeItem(`teleprompter:${id}`)
    return {}
  }
}

export function saveTeleprompterSettings(storage: Storage | undefined, id: string, settings: TeleprompterSettings) {
  storage?.setItem(`teleprompter:${id}`, JSON.stringify(settings))
}

// 提词器滚动速度：滑块 1-8 档对应每秒 3-24 像素。按口播语速校准（250 字口播约 60-90 秒，
// 一屏脚本约 400 像素高，档位 3-5 大致贴合）；改这个系数前按同一口径重算。
const pixelsPerSecondAt = (speed: number) => Math.min(Math.max(Math.round(speed), 1), 8) * 3

// 一帧该滚多少像素。用真实帧间隔算，60Hz 与 120Hz 屏幕速度一致；单帧最多按 250ms 算，
// 避免切回标签页时一下子跳到底。
export function teleprompterStep(speed: number, deltaMs: number): number {
  const elapsed = Number.isFinite(deltaMs) ? Math.min(Math.max(deltaMs, 0), 250) : 0
  return (pixelsPerSecondAt(speed) * elapsed) / 1000
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Use the browser fallback below when clipboard permission is unavailable.
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}
