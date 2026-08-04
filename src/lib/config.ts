/**
 * config.ts — 全站共享配置（唯一跨页共享的运行时模块）
 * 职责：默认常量、localStorage 设置存取（v1→v2 读时迁移）、直连/代理模式换算
 *
 * v2 变更：SIoT 由 HTTP(REST 轮询) 改为 MQTT over WebSocket 订阅，
 *   siotUrl/siotMode 删除，新增 siotHost/siotWsPort/siotWsPath/siotWsTls。
 *   ollama 字段不变（聊天页仍走 HTTP）。
 */

export const OLLAMA_BASE_DEFAULT = 'http://127.0.0.1:11434'
export const STORAGE_KEY_CARDS = 'chatweb.cards.v2'
export const STORAGE_KEY_CARDS_V1 = 'chatweb.cards.v1'
export const STORAGE_KEY_SETTINGS = 'chatweb.settings.v2'
export const STORAGE_KEY_SETTINGS_V1 = 'chatweb.settings.v1'
export const DEFAULT_PSIZE = 50

export type ConnectMode = 'direct' | 'proxy'

export interface AppSettings {
  /** SIoT MQTT over WebSocket 连接参数 */
  siotHost: string
  siotWsPort: number
  siotWsPath: string
  siotWsTls: boolean
  siotUser: string
  siotPwd: string
  /** Ollama HTTP 连接参数（聊天页用） */
  ollamaUrl: string
  ollamaMode: ConnectMode
}

const DEFAULT_SETTINGS: AppSettings = {
  siotHost: '10.1.2.3',
  siotWsPort: 1888,
  siotWsPath: '',
  siotWsTls: false,
  siotUser: 'siot',
  siotPwd: 'dfrobot',
  ollamaUrl: OLLAMA_BASE_DEFAULT,
  ollamaMode: 'direct',
}

/** SIoT MQTT WebSocket 连接 URL（设置变更后调用方负责重连） */
export function siotWsUrl(s: AppSettings): string {
  const proto = s.siotWsTls ? 'wss' : 'ws'
  const path = s.siotWsPath.startsWith('/') ? s.siotWsPath : `/${s.siotWsPath}`
  return `${proto}://${s.siotHost}:${s.siotWsPort}${s.siotWsPath ? path : ''}`
}

/** 读取设置；无 v2 时尝试 v1 迁移（不删除 v1 key，可回滚） */
export function loadSettings(): AppSettings {
  const v2 = readSettings(STORAGE_KEY_SETTINGS)
  if (v2) return { ...DEFAULT_SETTINGS, ...v2 }

  const v1 = readSettings(STORAGE_KEY_SETTINGS_V1)
  if (v1) {
    const migrated = migrateV1(v1)
    saveSettings(migrated)
    return migrated
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(s))
  } catch {
    // 存储不可用时静默忽略
  }
}

function readSettings(key: string): Partial<AppSettings> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** v1 → v2：从旧 siotUrl 提取主机名，丢弃已无用的 siotMode，保留 ollama 字段 */
function migrateV1(v1: Record<string, unknown>): AppSettings {
  const s = { ...DEFAULT_SETTINGS }
  try {
    const host = new URL(String(v1.siotUrl ?? '')).hostname
    if (host) s.siotHost = host
  } catch {
    // 非法 URL 时用默认主机
  }
  if (typeof v1.siotUser === 'string' && v1.siotUser) s.siotUser = v1.siotUser
  if (typeof v1.siotPwd === 'string' && v1.siotPwd) s.siotPwd = v1.siotPwd
  if (typeof v1.ollamaUrl === 'string' && v1.ollamaUrl) s.ollamaUrl = v1.ollamaUrl
  s.ollamaMode = v1.ollamaMode === 'proxy' ? 'proxy' : 'direct'
  return s
}

/** 当前生效的 Ollama 基地址（代理模式返回同源相对路径） */
export function ollamaBase(): string {
  const s = loadSettings()
  return s.ollamaMode === 'proxy' ? '/ollama' : s.ollamaUrl
}

/** 生成唯一 ID（crypto.randomUUID 兜底） */
export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
