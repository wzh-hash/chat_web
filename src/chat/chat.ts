/**
 * chat.ts — 聊天页入口
 * 职责：挂载 createChatWidget、应用自定义标题、扩展设置对话框（界面标题分组）
 */

import { loadTitles, saveTitles, type PageTitles } from '../lib/config'
import { createChatWidget } from '../lib/chat-core'

// ---- 标题应用 ----
function applyTitles(): void {
  const t = loadTitles()
  const h1 = document.querySelector('.chat-widget-title-text') as HTMLElement | null
  if (h1) h1.textContent = t.chat
}

// ---- 挂载组件 ----
const app = document.getElementById('app') as HTMLElement
const widget = createChatWidget(app)

// 应用标题（组件已渲染后）
applyTitles()

// ---- 扩展设置对话框：界面标题 ----
const { settingsForm } = widget

const titleGroup = document.createElement('fieldset')
titleGroup.innerHTML = `
  <legend>界面标题</legend>
  <label>聊天页标题
    <input name="chatTitle" type="text" placeholder="终端对话">
  </label>
`
settingsForm.insertBefore(titleGroup, settingsForm.querySelector('.dialog-actions'))

function openSettings(): void {
  const t = loadTitles()
  const chatInput = settingsForm.querySelector('input[name="chatTitle"]') as HTMLInputElement
  if (chatInput) chatInput.value = t.chat
}

function saveTitlesFromForm(): void {
  const t: PageTitles = loadTitles()
  const chatInput = settingsForm.querySelector('input[name="chatTitle"]') as HTMLInputElement
  if (chatInput) t.chat = chatInput.value.trim() || t.chat
  saveTitles(t)
  applyTitles()
}

const originalSettingsBtn = app.querySelector('.settings-btn') as HTMLButtonElement
originalSettingsBtn.addEventListener('click', () => {
  openSettings()
})

settingsForm.addEventListener('submit', () => {
  // 主保存逻辑由 chat-core 处理（Ollama+SIoT）
  // 这里追加标题保存
  saveTitlesFromForm()
})
