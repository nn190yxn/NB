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
