/** index.ts — 首页脚本：状态预览（Ollama + SIoT 探测）+ 自定义标题 */

import mqtt from 'mqtt'
import { loadSettings, ollamaBase, siotWsUrl, loadTitles, saveTitles, type PageTitles } from './lib/config'

// ---- DOM 引用 ----
const ollamaDot = document.getElementById('ollama-dot') as HTMLElement
const ollamaStatus = document.getElementById('ollama-status') as HTMLElement
const siotDot = document.getElementById('siot-dot') as HTMLElement
const siotStatus = document.getElementById('siot-status') as HTMLElement
const h1 = document.querySelector('.page h1') as HTMLElement
const subtitle = document.querySelector('.page .subtitle') as HTMLElement
const navChatTitle = document.querySelector('.nav-card[href="chat.html"] h2') as HTMLElement
const navDashTitle = document.querySelector('.nav-card[href="dashboard.html"] h2') as HTMLElement

const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement
const settingsForm = document.getElementById('settings-form') as HTMLFormElement
const settingsCancel = document.getElementById('settings-cancel') as HTMLButtonElement

// ---- 标题应用 ----
function applyTitles(): void {
  const t = loadTitles()
  if (h1) h1.textContent = t.home
  if (subtitle) subtitle.textContent = t.homeSubtitle
  if (navChatTitle) navChatTitle.textContent = t.navChat
  if (navDashTitle) navDashTitle.textContent = t.navDash
}

applyTitles()

// ---- 设置对话框 ----
function openSettings(): void {
  const t = loadTitles()
  const form = settingsForm as unknown as Record<string, HTMLInputElement>
  ;(form.homeTitle as HTMLInputElement).value = t.home
  ;(form.homeSubtitle as HTMLInputElement).value = t.homeSubtitle
  ;(form.navChat as HTMLInputElement).value = t.navChat
  ;(form.navDash as HTMLInputElement).value = t.navDash
  settingsDialog.showModal()
}

function saveTitlesFromForm(): void {
  const form = settingsForm as unknown as Record<string, HTMLInputElement>
  const t: PageTitles = loadTitles()
  t.home = (form.homeTitle as HTMLInputElement).value.trim() || t.home
  t.homeSubtitle = (form.homeSubtitle as HTMLInputElement).value.trim() || t.homeSubtitle
  t.navChat = (form.navChat as HTMLInputElement).value.trim() || t.navChat
  t.navDash = (form.navDash as HTMLInputElement).value.trim() || t.navDash
  saveTitles(t)
  applyTitles()
}

settingsBtn.addEventListener('click', openSettings)
settingsCancel.addEventListener('click', () => settingsDialog.close())
settingsForm.addEventListener('submit', (e) => {
  e.preventDefault()
  saveTitlesFromForm()
  settingsDialog.close()
})

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
