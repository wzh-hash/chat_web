/**
 * chat-core.ts — 可复用的聊天组件核心（整页 / 悬浮窗共用）
 * 职责：渲染完整聊天 DOM、管理会话与流式响应、SIoT 采集、设置对话框
 * 约束：只依赖 lib/*（config/types/siot-common/ui-dropdown），零 import src/chat/* 或 src/dashboard/*
 */

import type { ChatMessage } from './types'
import { loadSettings, saveSettings, ollamaBase } from './config'
import { collectSiotData } from './siot-common'
import { createDropdown } from './ui-dropdown'

// ---- 内联 Ollama 客户端（原 src/chat/ollama.ts + sse.ts） ----

interface OllamaModel {
  name: string
  model: string
  size: number
  modified_at: string
}

interface ChatCallbacks {
  onToken: (token: string) => void
  onDone?: () => void
}

async function listModels(): Promise<OllamaModel[]> {
  let res: Response
  try {
    res = await fetch(`${ollamaBase()}/api/tags`)
  } catch {
    throw new Error(
      '无法连接 Ollama，请确认服务已启动（默认 127.0.0.1:11434）；若服务在远程或遇到跨域限制，请在⚙设置中切换为"经本地服务器代理"',
    )
  }
  if (!res.ok) throw new Error(`Ollama 返回错误: HTTP ${res.status}`)
  const data = (await res.json()) as { models?: OllamaModel[] }
  return data.models ?? []
}

async function chatStream(
  model: string,
  messages: ChatMessage[],
  cb: ChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${ollamaBase()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error(
      '无法连接 Ollama，请确认服务已启动（默认 127.0.0.1:11434）；若服务在远程或遇到跨域限制，请在⚙设置中切换为"经本地服务器代理"',
    )
  }

  if (!res.ok) {
    let msg = `Ollama 返回错误: HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg += ` — ${body.error}`
    } catch {
      // 忽略
    }
    throw new Error(msg)
  }

  await parseSseStream(
    res,
    (obj) => {
      const message = obj.message as { content?: string } | undefined
      const done = obj.done as boolean | undefined
      const content = message?.content ?? ''
      if (content) cb.onToken(content)
      if (done) cb.onDone?.()
    },
    signal,
  )
}

async function parseSseStream(
  res: Response,
  onData: (obj: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('响应没有可读取的流')

  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    if (signal?.aborted) throw new DOMException('已中止', 'AbortError')
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      handleLine(line, onData)
    }
  }

  const tail = buffer.trim()
  if (tail) handleLine(tail, onData)
}

function handleLine(line: string, onData: (obj: Record<string, unknown>) => void): void {
  if (!line) return
  const jsonText = line.startsWith('data:') ? line.slice(5).trim() : line
  if (!jsonText) return
  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>
    onData(obj)
  } catch {
    // 跳过
  }
}

// ---- 组件常量 ----

const STORAGE_KEY_SYSTEM_PROMPT = 'chatweb.systemprompt.v1'
const STORAGE_KEY_SIOT_TOPICS = 'chatweb.siot-topics.v1'

export interface ChatWidgetOpts {
  compact?: boolean
  onSettingsChange?: () => void
}

export interface ChatWidgetApi {
  open?: () => void
  close?: () => void
  dispose: () => void
  settingsDialog: HTMLDialogElement
  settingsForm: HTMLFormElement
}

export function createChatWidget(container: HTMLElement, opts?: ChatWidgetOpts): ChatWidgetApi {
  const compact = opts?.compact ?? false

  // ---- DOM 构建 ----
  const root = document.createElement('div')
  root.className = compact ? 'chat-widget chat-widget-compact' : 'chat-widget'

  root.innerHTML = `
    <header class="chat-widget-header">
      <h1 class="chat-widget-title">终端对话</h1>
      <div class="chat-widget-controls">
        <div class="model-select-wrap" id="model-select-wrap"></div>
        <button type="button" class="settings-btn" title="设置">⚙ 设置</button>
        <button type="button" class="clear-btn danger" title="清空对话">清空</button>
      </div>
    </header>
    <div class="error-banner hidden" id="error-banner">
      <span id="error-text"></span>
      <button type="button" id="retry-btn">重试</button>
    </div>
    <div class="messages" id="messages"></div>
    <footer class="chat-widget-footer">
      <details class="sys-prompt">
        <summary>系统提示词（可选）</summary>
        <textarea id="system-prompt" rows="2" placeholder="设定模型的行为、身份或约束……"></textarea>
      </details>
      <div class="input-row">
        <button type="button" id="siot-btn" class="siot-btn" title="采集 SIoT 实时数据">[SIoT]</button>
        <textarea id="prompt-input" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
        <button type="button" id="send-btn" class="primary">发送</button>
        <button type="button" id="stop-btn" class="danger hidden">停止</button>
      </div>
    </footer>

    <div id="siot-popover" class="siot-popover hidden">
      <div class="siot-popover-inner">
        <label>Topic
          <input id="siot-topic" list="siot-topic-list" placeholder="例如 xzr/001">
          <datalist id="siot-topic-list"></datalist>
        </label>
        <label>采集时长
          <div id="siot-duration-wrap"></div>
        </label>
        <button type="button" id="siot-start" class="primary">开始采集</button>
        <button type="button" id="siot-close" class="siot-close" title="关闭">✕</button>
      </div>
    </div>

    <dialog id="settings-dialog" class="settings-dialog">
      <form id="settings-form">
        <h2>设置</h2>
        <fieldset class="grid2">
          <legend>Ollama</legend>
          <label class="span2">地址
            <input name="ollamaUrl" type="url" placeholder="http://127.0.0.1:11434">
          </label>
          <label>连接方式
            <div id="ollama-mode-wrap"></div>
          </label>
        </fieldset>
        <fieldset class="grid2">
          <legend>SIoT（MQTT）</legend>
          <label class="span2">主机地址
            <input name="siotHost" placeholder="10.1.2.3">
          </label>
          <label>WebSocket 端口
            <input name="siotWsPort" type="number" min="1" max="65535" value="1888">
          </label>
          <label>路径
            <input name="siotWsPath" placeholder="如 /ws">
          </label>
          <label class="checkbox-row span2">
            <input name="siotWsTls" type="checkbox">
            启用 TLS（wss://）
          </label>
          <label>账号
            <input name="siotUser" placeholder="siot">
          </label>
          <label>密码
            <input name="siotPwd" type="password" placeholder="dfrobot">
          </label>
        </fieldset>
        <div class="dialog-actions">
          <button type="button" id="settings-cancel">取消</button>
          <button type="submit" class="primary">保存</button>
        </div>
      </form>
    </dialog>
  `

  container.appendChild(root)

  // ---- DOM 引用 ----
  const modelWrap = root.querySelector('#model-select-wrap') as HTMLElement
  const messagesEl = root.querySelector('#messages') as HTMLElement
  const promptInput = root.querySelector('#prompt-input') as HTMLTextAreaElement
  const systemPromptInput = root.querySelector('#system-prompt') as HTMLTextAreaElement
  const sendBtn = root.querySelector('#send-btn') as HTMLButtonElement
  const stopBtn = root.querySelector('#stop-btn') as HTMLButtonElement
  const clearBtn = root.querySelector('.clear-btn') as HTMLButtonElement
  const errorBanner = root.querySelector('#error-banner') as HTMLElement
  const errorText = root.querySelector('#error-text') as HTMLElement
  const retryBtn = root.querySelector('#retry-btn') as HTMLButtonElement
  const settingsBtn = root.querySelector('.settings-btn') as HTMLButtonElement
  const settingsDialog = root.querySelector('#settings-dialog') as HTMLDialogElement
  const settingsForm = root.querySelector('#settings-form') as HTMLFormElement
  const settingsCancel = root.querySelector('#settings-cancel') as HTMLButtonElement

  const siotBtn = root.querySelector('#siot-btn') as HTMLButtonElement
  const siotPopover = root.querySelector('#siot-popover') as HTMLElement
  const siotTopicInput = root.querySelector('#siot-topic') as HTMLInputElement
  const siotTopicList = root.querySelector('#siot-topic-list') as HTMLDataListElement
  const siotDurationWrap = root.querySelector('#siot-duration-wrap') as HTMLElement
  const siotStartBtn = root.querySelector('#siot-start') as HTMLButtonElement
  const siotCloseBtn = root.querySelector('#siot-close') as HTMLButtonElement
  const ollamaModeWrap = root.querySelector('#ollama-mode-wrap') as HTMLElement

  // ---- 下拉组件替换原生 select ----
  const modelDropdown = createDropdown({
    options: [],
    placeholder: '(无模型)',
    onChange: () => {
      // 仅记录选择，不触发额外动作
    },
  })
  modelWrap.appendChild(modelDropdown.el)

  const durationDropdown = createDropdown({
    options: [
      { value: '3000', label: '3 秒' },
      { value: '5000', label: '5 秒' },
      { value: '10000', label: '10 秒' },
    ],
    value: '5000',
    onChange: () => {},
  })
  siotDurationWrap.appendChild(durationDropdown.el)

  const modeDropdown = createDropdown({
    options: [
      { value: 'direct', label: '直连' },
      { value: 'proxy', label: '经本地服务器代理（/ollama）' },
    ],
    value: 'direct',
    onChange: () => {},
  })
  ollamaModeWrap.appendChild(modeDropdown.el)

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
      const prev = modelDropdown.getValue()
      modelDropdown.dispose()
      const newDropdown = createDropdown({
        options: models.map((m) => ({ value: m.name, label: m.name })),
        value: models.some((m) => m.name === prev) ? prev : undefined,
        placeholder: models.length === 0 ? '(无模型，请先 ollama pull)' : '请选择',
        onChange: () => {},
      })
      modelWrap.innerHTML = ''
      modelWrap.appendChild(newDropdown.el)
      // 更新引用
      Object.assign(modelDropdown, newDropdown)
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

    const model = modelDropdown.getValue()
    if (!model) {
      showError('没有可用的模型，请先在 Ollama 中安装（ollama pull <模型名>）')
      return
    }

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
        const partial = bubble.textContent ?? ''
        if (partial.trim()) history.push({ role: 'assistant', content: partial })
        else history.pop()
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
    modeDropdown.setValue(s.ollamaMode)
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
    s.ollamaMode = modeDropdown.getValue() === 'proxy' ? 'proxy' : 'direct'
    s.siotHost = (form.siotHost as HTMLInputElement).value.trim() || s.siotHost
    s.siotWsPort = Math.max(1, Number((form.siotWsPort as HTMLInputElement).value) || s.siotWsPort)
    s.siotWsPath = (form.siotWsPath as HTMLInputElement).value.trim()
    s.siotWsTls = (form.siotWsTls as HTMLInputElement).checked
    s.siotUser = (form.siotUser as HTMLInputElement).value.trim() || s.siotUser
    s.siotPwd = (form.siotPwd as HTMLInputElement).value || s.siotPwd
    saveSettings(s)
    opts?.onSettingsChange?.()
    void refreshModels()
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
      // 忽略
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

  function formatSiotData(
    topic: string,
    durationSec: number,
    data: { content: string; created: string }[],
  ): string {
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

    const durationMs = Number(durationDropdown.getValue())
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

  // ---- 事件绑定 ----
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

  siotBtn.addEventListener('click', () => toggleSiotPopover())
  siotCloseBtn.addEventListener('click', () => toggleSiotPopover(false))
  siotStartBtn.addEventListener('click', () => void startSiotCollect())
  refreshTopicDatalist()

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  })

  // ---- 恢复系统提示词 ----
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SYSTEM_PROMPT)
    if (saved) systemPromptInput.value = saved
  } catch {
    // 忽略
  }
  systemPromptInput.addEventListener('input', () => {
    try {
      localStorage.setItem(STORAGE_KEY_SYSTEM_PROMPT, systemPromptInput.value)
    } catch {
      // 忽略
    }
  })

  // ---- 初始化 ----
  void refreshModels()

  return {
    open: undefined,
    close: undefined,
    dispose: () => {
      modelDropdown.dispose()
      durationDropdown.dispose()
      modeDropdown.dispose()
      root.remove()
    },
    settingsDialog,
    settingsForm,
  }
}
