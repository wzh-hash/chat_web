/** index.ts — 首页脚本：状态预览（Ollama + SIoT 探测） */

import mqtt from 'mqtt'
import { loadSettings, ollamaBase, siotWsUrl } from './lib/config'

// ---- DOM 引用 ----
const ollamaDot = document.getElementById('ollama-dot') as HTMLElement
const ollamaStatus = document.getElementById('ollama-status') as HTMLElement
const siotDot = document.getElementById('siot-dot') as HTMLElement
const siotStatus = document.getElementById('siot-status') as HTMLElement

// ---- 状态更新 ----
function setStatus(
  dot: HTMLElement,
  label: HTMLElement,
  state: 'checking' | 'online' | 'offline',
  text: string,
): void {
  dot.className = `status-dot ${state}`
  label.className = `status-value ${state === 'online' ? 'online' : state === 'offline' ? 'offline' : ''}`
  label.textContent = text
}

// ---- Ollama 探测 ----
async function probeOllama(): Promise<void> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${ollamaBase()}/api/tags`, {
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (res.ok) {
      setStatus(ollamaDot, ollamaStatus, 'online', '在线')
    } else {
      setStatus(ollamaDot, ollamaStatus, 'offline', `异常 (${res.status})`)
    }
  } catch {
    setStatus(ollamaDot, ollamaStatus, 'offline', '离线')
  }
}

// ---- SIoT 探测（一次性短连接） ----
function probeSiot(): void {
  const s = loadSettings()
  const url = siotWsUrl(s)

  let settled = false
  const client = mqtt.connect(url, {
    username: s.siotUser,
    password: s.siotPwd,
    protocolVersion: 4,
    connectTimeout: 2000,
    reconnectPeriod: 0,
    clean: true,
  })

  const finish = (state: 'online' | 'offline', text: string): void => {
    if (settled) return
    settled = true
    try {
      client.end(true)
    } catch {
      // 忽略
    }
    setStatus(siotDot, siotStatus, state, text)
  }

  client.on('connect', () => finish('online', '可连接'))
  client.on('error', (err: Error) => {
    const msg = err.message || '连接失败'
    finish('offline', msg.length > 12 ? '连接失败' : msg)
  })

  // 兜底超时（connectTimeout 不保证一定触发回调）
  setTimeout(() => {
    if (!settled) finish('offline', '超时')
  }, 3000)
}

// ---- 初始化 ----
function init(): void {
  setStatus(ollamaDot, ollamaStatus, 'checking', '检测中…')
  setStatus(siotDot, siotStatus, 'checking', '检测中…')
  void probeOllama()
  probeSiot()
}

init()
