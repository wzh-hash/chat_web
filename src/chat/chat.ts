/**
 * chat.ts — 聊天页入口
 * 职责：DOM 绑定、会话状态（多轮上下文）、流式渲染、停止/清空、设置对话框
 * 新增：SIoT 实时数据采集插入对话
 */

import type { ChatMessage } from '../lib/types'
import { loadSettings, saveSettings } from '../lib/config'
import { listModels, chatStream } from './ollama'
import { collectSiotData } from '../lib/siot-common'

const STORAGE_KEY_SYSTEM_PROMPT = 'chatweb.systemprompt.v1'
const STORAGE_KEY_SIOT_TOPICS = 'chatweb.siot-topics.v1'

// ---- DOM 引用 ----
const modelSelect = document.getElementById('model-select') as HTMLSelectElement
const messagesEl = document.getElementById('messages') as HTMLElement
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement
const systemPromptInput = document.getElementById('system-prompt') as HTMLTextAreaElement
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement
const errorBanner = document.getElementById('error-banner') as HTMLElement
const errorText = document.getElementById('error-text') as HTMLElement
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement
const settingsForm = document.getElementById('settings-form') as HTMLFormElement
const settingsCancel = document.getElementById('settings-cancel') as HTMLButtonElement

// SIoT 浮层
const siotBtn = document.getElementById('siot-btn') as HTMLButtonElement
const siotPopover = document.getElementById('siot-popover') as HTMLElement
const siotTopicInput = document.getElementById('siot-topic') as HTMLInputElement
const siotTopicList = document.getElementById('siot-topic-list') as HTMLDataListElement
const siotDurationSelect = document.getElementById('siot-duration') as HTMLSelectElement
const siotStartBtn = document.getElementById('siot-start') as HTMLButtonElement
const siotCloseBtn = document.getElementById('siot-close') as HTMLButtonElement

// ---- 会话状态 ----
let history: ChatMessage[] = []
let abortController: AbortController | null = null
let streaming = false

// ---- 错误提示 ----
function showError(msg: string): void {
  errorText.textContent = msg
  errorBanner.classList.remove('hidden')
}

function hideError(): void {
  errorBanner.classList.add('hidden')
}

// ---- 模型列表 ----
async function refreshModels(): Promise<void> {
  try {
    const models = await listModels()
    hideError()
    const prev = modelSelect.value
    modelSelect.innerHTML = ''
    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">(无模型，请先 ollama pull)</option>'
      return
    }
    for (const m of models) {
      const opt = document.createElement('option')
      opt.value = m.name
      opt.textContent = m.name
      modelSelect.appendChild(opt)
    }
    if (prev && models.some((m) => m.name === prev)) modelSelect.value = prev
  } catch (err) {
    showError((err as Error).message)
  }
}

// ---- 消息渲染 ----
function appendMessage(role: 'user' | 'assistant', content: string): HTMLElement {
  const row = document.createElement('div')
  row.className = `msg msg-${role}`
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = content
  row.appendChild(bubble)
  messagesEl.appendChild(row)
  scrollToBottom()
  return bubble
}

function scrollToBottom(): void {
  messagesEl.scrollTop = messagesEl.scrollHeight
}

// ---- 发送 ----
function setStreaming(on: boolean): void {
  streaming = on
  sendBtn.disabled = on
  sendBtn.classList.toggle('hidden', on)
  stopBtn.classList.toggle('hidden', !on)
}

async function sendMessage(): Promise<void> {
  const text = promptInput.value.trim()
  if (!text || streaming) return

  const model = modelSelect.value
  if (!model) {
    showError('没有可用的模型，请先在 Ollama 中安装（ollama pull <模型名>）')
    return
  }

  // 系统提示词：有内容则保证位于上下文最前
  const system = systemPromptInput.value.trim()
  if (system && history[0]?.role !== 'system') {
    history.unshift({ role: 'system', content: system })
  }

  history.push({ role: 'user', content: text })
  promptInput.value = ''
  appendMessage('user', text)

  const bubble = appendMessage('assistant', '')
  abortController = new AbortController()
  setStreaming(true)
  hideError()

  try {
    let assistantText = ''
    await chatStream(
      model,
      history,
      {
        onToken: (t) => {
          assistantText += t
          bubble.textContent = assistantText
          scrollToBottom()
        },
      },
      abortController.signal,
    )
    history.push({ role: 'assistant', content: assistantText })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // 用户主动停止：保留已生成的部分
      const partial = bubble.textContent ?? ''
      if (partial.trim()) history.push({ role: 'assistant', content: partial })
      else history.pop() // 一个 token 都没产出，撤掉这个空提问
    } else {
      showError((err as Error).message)
      const partial = bubble.textContent ?? ''
      bubble.textContent = partial ? `${partial}\n\n[生成失败]` : '[生成失败]'
    }
  } finally {
    setStreaming(false)
  }
}

function stopGeneration(): void {
  abortController?.abort()
}

// ---- 清空 ----
function clearChat(): void {
  history = []
  messagesEl.innerHTML = ''
  hideError()
}

// ---- 设置对话框 ----
function openSettings(): void {
  const s = loadSettings()
  const form = settingsForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement>
  ;(form.ollamaUrl as HTMLInputElement).value = s.ollamaUrl
  ;(form.ollamaMode as HTMLSelectElement).value = s.ollamaMode
  ;(form.siotHost as HTMLInputElement).value = s.siotHost
  ;(form.siotWsPort as HTMLInputElement).value = String(s.siotWsPort)
  ;(form.siotWsPath as HTMLInputElement).value = s.siotWsPath
  ;(form.siotWsTls as HTMLInputElement).checked = s.siotWsTls
  ;(form.siotUser as HTMLInputElement).value = s.siotUser
  ;(form.siotPwd as HTMLInputElement).value = s.siotPwd
  settingsDialog.showModal()
}

function saveSettingsFromForm(): void {
  const form = settingsForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement>
  const s = loadSettings()
  s.ollamaUrl = (form.ollamaUrl as HTMLInputElement).value.trim() || s.ollamaUrl
  s.ollamaMode = (form.ollamaMode as HTMLSelectElement).value === 'proxy' ? 'proxy' : 'direct'
  s.siotHost = (form.siotHost as HTMLInputElement).value.trim() || s.siotHost
  s.siotWsPort = Math.max(1, Number((form.siotWsPort as HTMLInputElement).value) || s.siotWsPort)
  s.siotWsPath = (form.siotWsPath as HTMLInputElement).value.trim()
  s.siotWsTls = (form.siotWsTls as HTMLInputElement).checked
  s.siotUser = (form.siotUser as HTMLInputElement).value.trim() || s.siotUser
  s.siotPwd = (form.siotPwd as HTMLInputElement).value || s.siotPwd
  saveSettings(s)
  void refreshModels() // 切换模式/地址后重拉模型
}

// ---- SIoT topic 历史 ----
function loadSiotTopics(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SIOT_TOPICS)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}

function saveSiotTopic(topic: string): void {
  if (!topic) return
  let topics = loadSiotTopics()
  topics = topics.filter((t) => t !== topic)
  topics.unshift(topic)
  if (topics.length > 10) topics = topics.slice(0, 10)
  try {
    localStorage.setItem(STORAGE_KEY_SIOT_TOPICS, JSON.stringify(topics))
  } catch {
    // 忽略存储失败
  }
  refreshTopicDatalist()
}

function refreshTopicDatalist(): void {
  const topics = loadSiotTopics()
  siotTopicList.innerHTML = ''
  for (const t of topics) {
    const opt = document.createElement('option')
    opt.value = t
    siotTopicList.appendChild(opt)
  }
}

// ---- SIoT 采集浮层 ----
let collecting = false

function toggleSiotPopover(show?: boolean): void {
  const visible = show !== undefined ? show : siotPopover.classList.contains('hidden')
  siotPopover.classList.toggle('hidden', !visible)
  if (visible) {
    siotTopicInput.focus()
  }
}

function formatSiotData(topic: string, durationSec: number, data: { content: string; created: string }[]): string {
  if (data.length === 0) {
    return `【SIoT 实时数据 | topic: ${topic} | 该 topic 在 ${durationSec} 秒内未收到数据】`
  }
  const lines = data.map((d) => `- ${d.created} → ${d.content}`)
  return `【SIoT 实时数据 | topic: ${topic} | 采集时间】\n${lines.join('\n')}`
}

async function startSiotCollect(): Promise<void> {
  if (collecting) return
  const topic = siotTopicInput.value.trim()
  if (!topic) {
    showError('请输入 topic')
    return
  }

  const settings = loadSettings()
  if (!settings.siotHost) {
    showError('请先在设置中配置 SIoT')
    return
  }

  const durationMs = Number(siotDurationSelect.value)
  const durationSec = Math.round(durationMs / 1000)

  collecting = true
  siotStartBtn.disabled = true
  siotStartBtn.classList.add('collecting')
  let remaining = durationSec
  siotStartBtn.textContent = `收集中 ${remaining}s…`

  const countdown = setInterval(() => {
    remaining -= 1
    if (remaining > 0) {
      siotStartBtn.textContent = `收集中 ${remaining}s…`
    }
  }, 1000)

  try {
    const data = await collectSiotData(settings, topic, { durationMs })
    clearInterval(countdown)
    saveSiotTopic(topic)
    toggleSiotPopover(false)

    const prefix = formatSiotData(topic, durationSec, data)
    const userText = promptInput.value.trim()
    const fullContent = userText ? `${prefix}\n\n${userText}` : prefix
    promptInput.value = fullContent
    promptInput.focus()
    // 如果输入框有内容，让用户继续编辑后手动发送；如果只有采集数据，也可以直接发送
  } catch (err) {
    clearInterval(countdown)
    showError((err as Error).message || '采集失败')
  } finally {
    collecting = false
    siotStartBtn.disabled = false
    siotStartBtn.classList.remove('collecting')
    siotStartBtn.textContent = '开始采集'
  }
}

// ---- 初始化 ----
function init(): void {
  // 恢复系统提示词
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SYSTEM_PROMPT)
    if (saved) systemPromptInput.value = saved
  } catch {
    // localStorage 不可用时忽略
  }
  systemPromptInput.addEventListener('input', () => {
    try {
      localStorage.setItem(STORAGE_KEY_SYSTEM_PROMPT, systemPromptInput.value)
    } catch {
      // 忽略存储失败
    }
  })

  // 事件绑定
  sendBtn.addEventListener('click', () => void sendMessage())
  stopBtn.addEventListener('click', stopGeneration)
  clearBtn.addEventListener('click', clearChat)
  retryBtn.addEventListener('click', () => void refreshModels())
  settingsBtn.addEventListener('click', openSettings)
  settingsCancel.addEventListener('click', () => settingsDialog.close())
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault()
    saveSettingsFromForm()
    settingsDialog.close()
  })

  // SIoT 浮层
  siotBtn.addEventListener('click', () => toggleSiotPopover())
  siotCloseBtn.addEventListener('click', () => toggleSiotPopover(false))
  siotStartBtn.addEventListener('click', () => void startSiotCollect())
  refreshTopicDatalist()

  // Enter 发送，Shift+Enter 换行
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  })

  void refreshModels()
}

init()
