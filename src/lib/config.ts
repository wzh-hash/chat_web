/**
 * config.ts — 全站共享配置（唯一跨页共享的运行时模块）
 * 职责：默认常量、localStorage 设置存取、直连/代理模式换算
 */

export const OLLAMA_BASE_DEFAULT = 'http://127.0.0.1:11434'
export const SIOT_BASE_DEFAULT = 'http://127.0.0.1:8080'
export const STORAGE_KEY_CARDS = 'chatweb.cards.v1'
export const STORAGE_KEY_SETTINGS = 'chatweb.settings.v1'
export const DEFAULT_REFRESH_MS = 5000
export const DEFAULT_PSIZE = 50

/** 连接模式：direct=直连上游；proxy=经本地静态服务器的同源代理 */
export type ConnectMode = 'direct' | 'proxy'

export interface AppSettings {
  siotUrl: string
  siotUser: string
  siotPwd: string
  siotMode: ConnectMode
  ollamaUrl: string
  ollamaMode: ConnectMode
}

const DEFAULT_SETTINGS: AppSettings = {
  siotUrl: SIOT_BASE_DEFAULT,
  siotUser: 'siot',
  siotPwd: 'dfrobot',
  siotMode: 'direct',
  ollamaUrl: OLLAMA_BASE_DEFAULT,
  ollamaMode: 'direct',
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(s))
}

/** 当前生效的 Ollama 基地址（代理模式返回同源相对路径） */
export function ollamaBase(): string {
  const s = loadSettings()
  return s.ollamaMode === 'proxy' ? '/ollama' : s.ollamaUrl
}

/** 当前生效的 SIoT 基地址 */
export function siotBase(): string {
  const s = loadSettings()
  return s.siotMode === 'proxy' ? '/siot' : s.siotUrl
}

/** 当前生效的 SIoT 账号 */
export function siotCred(): { iname: string; ipwd: string } {
  const s = loadSettings()
  return { iname: s.siotUser, ipwd: s.siotPwd }
}

/** 生成唯一 ID（crypto.randomUUID 兜底） */
export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
