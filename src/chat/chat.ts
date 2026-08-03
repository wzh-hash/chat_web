/**
 * chat.ts — 聊天页入口
 * 职责：DOM 绑定、会话状态（多轮上下文）、流式渲染、停止/清空、设置对话框
 */

import type { ChatMessage } from '../lib/types'
import { loadSettings, saveSettings } from '../lib/config'
import { listModels, chatStream } from './ollama'

const STORAGE_KEY_SYSTEM_PROMPT = 'chatweb.systemprompt.v1'

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

  // 系统提示词：有内容则保证位于上下文最前
  const system = systemPromptInput.value.trim()
  if (system && history[0]?.role !== 'system') {
    history.unshift({ role: 'system', content: system })
  }

  history.push({ role: 'user', content: text })
  promptInput.value = ''
  appendMessage('user', text)

  const model = modelSelect.value
  if (!model) {
    showError('没有可用的模型，请先在 Ollama 中安装（ollama pull <模型名>）')
    return
  }

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
  settingsDialog.showModal()
}

function saveSettingsFromForm(): void {
  const form = settingsForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement>
  const s = loadSettings()
  s.ollamaUrl = (form.ollamaUrl as HTMLInputElement).value.trim() || s.ollamaUrl
  s.ollamaMode = (form.ollamaMode as HTMLSelectElement).value === 'proxy' ? 'proxy' : 'direct'
  saveSettings(s)
  void refreshModels() // 切换模式/地址后重拉模型
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
