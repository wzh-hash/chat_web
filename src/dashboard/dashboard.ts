/**
 * dashboard.ts — 仪表盘页入口（MQTT 订阅版）
 * 职责：卡片网格、全局连接状态、SIoT 连接设置、悬浮球聊天、自定义标题
 */

import { loadSettings, saveSettings, loadTitles, saveTitles, type PageTitles } from '../lib/config'
import { createDropdown } from '../lib/ui-dropdown'
import { createChatWidget } from '../lib/chat-core'
import { iconChat, iconChart } from '../lib/icons'
import { loadConfigs, saveConfigs, defaultConfig, CHART_TYPES } from './storage'
import type { ChartCardConfig, ChartType } from './storage'
import { CardController } from './cards'
import { siotMqtt, type MqttConnState } from './mqtt'

// ---- DOM 引用 ----
const gridEl = document.getElementById('grid') as HTMLElement
const emptyHint = document.getElementById('empty-hint') as HTMLElement
const connStatus = document.getElementById('conn-status') as HTMLElement
const addBtn = document.getElementById('add-btn') as HTMLButtonElement
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement
const cardDialog = document.getElementById('card-dialog') as HTMLDialogElement
const cardForm = document.getElementById('card-form') as HTMLFormElement
const cardDialogTitle = document.getElementById('card-dialog-title') as HTMLElement
const cardCancel = document.getElementById('card-cancel') as HTMLButtonElement
const cardError = document.getElementById('card-error') as HTMLElement
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement
const settingsForm = document.getElementById('settings-form') as HTMLFormElement
const settingsCancel = document.getElementById('settings-cancel') as HTMLButtonElement
const typeWrap = document.getElementById('card-type-wrap') as HTMLElement

// 动态字段行
const unitRow = document.getElementById('unit-row') as HTMLElement
const thresholdRow = document.getElementById('threshold-row') as HTMLElement
const actionsRow = document.getElementById('actions-row') as HTMLElement

// 悬浮球
const chatBall = document.getElementById('chat-ball') as HTMLButtonElement
const chatWindow = document.getElementById('chat-window') as HTMLElement
const chatWindowHeader = document.getElementById('chat-window-header') as HTMLElement
const chatWindowMinimize = document.getElementById('chat-window-minimize') as HTMLButtonElement
const chatWidgetMount = document.getElementById('chat-widget-mount') as HTMLElement

// ---- 标题应用 ----
function applyTitles(): void {
  const t = loadTitles()
  const titleEl = document.getElementById('dash-title-text') as HTMLElement | null
  if (titleEl) titleEl.textContent = t.dashboard
}

applyTitles()
// 图标：页面标题 + 悬浮球
const dashTitleIcon = document.getElementById('dash-title-icon') as HTMLElement | null
if (dashTitleIcon) dashTitleIcon.innerHTML = iconChart
chatBall.innerHTML = iconChat

// ---- 下拉组件：图表类型 ----
const typeDropdown = createDropdown({
  options: [
    { value: 'line', label: '折线图' },
    { value: 'area', label: '面积图' },
    { value: 'bar', label: '柱状图' },
    { value: 'pie', label: '饼图（按值分类统计）' },
    { value: 'gauge', label: '仪表盘（最新值）' },
    { value: 'scatter', label: '散点图' },
    { value: 'value', label: '数值展示' },
    { value: 'control', label: '控制指令' },
    { value: 'image', label: '图传画面' },
  ],
  value: 'line',
  onChange: (v) => updateDialogFields(v as ChartType),
})
typeWrap.appendChild(typeDropdown.el)

// ---- 状态 ----
const cards = new Map<string, CardController>()
let editingId: string | null = null

// ---- 全局连接状态 ----
const CONN_LABEL: Record<MqttConnState, string> = {
  stopped: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  error: '连接错误',
}

function updateConnStatus(state: MqttConnState, message?: string): void {
  connStatus.textContent = CONN_LABEL[state]
  connStatus.dataset.state = state
  connStatus.title = message ?? ''
}

// ---- 卡片网格 ----
function renderGrid(): void {
  for (const card of cards.values()) card.stop()
  cards.clear()

  const cfgs = loadConfigs()
  cfgs.forEach((cfg, index) => {
    const card = new CardController(gridEl, cfg, {
      onEdit: (c) => openCardDialog(c),
      onDelete: (id) => deleteCard(id),
    })
    card.el.style.animationDelay = `${index * 60}ms`
    cards.set(cfg.id, card)
    card.start()
  })
  emptyHint.classList.toggle('hidden', cfgs.length > 0)
}

function deleteCard(id: string): void {
  const card = cards.get(id)
  if (!card) return
  if (!window.confirm(`删除图表「${card.cfg.title || card.cfg.topic}」？`)) return
  const cfgs = loadConfigs().filter((c) => c.id !== id)
  saveConfigs(cfgs)
  renderGrid()
}

// ---- 添加/编辑对话框 ----
function openCardDialog(cfg: ChartCardConfig | null): void {
  editingId = cfg?.id ?? null
  cardDialogTitle.textContent = editingId ? '编辑图表' : '添加图表'
  cardError.classList.add('hidden')

  const form = cardForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ;(form.title as HTMLInputElement).value = cfg?.title ?? ''
  ;(form.topic as HTMLInputElement).value = cfg?.topic ?? ''
  ;(form.psize as HTMLInputElement).value = String(cfg?.psize ?? 50)
  ;(form.jsonField as HTMLInputElement).value = cfg?.jsonField ?? ''
  ;(form.unit as HTMLInputElement).value = cfg?.unit ?? ''
  ;(form.minValue as HTMLInputElement).value =
    cfg?.minValue !== undefined ? String(cfg.minValue) : ''
  ;(form.maxValue as HTMLInputElement).value =
    cfg?.maxValue !== undefined ? String(cfg.maxValue) : ''
  ;(form.actions as HTMLTextAreaElement).value =
    cfg?.actions?.map((a) => `${a.label}=${a.msg}`).join('\n') ?? ''
  typeDropdown.setValue(cfg?.type ?? 'line')

  updateDialogFields(typeDropdown.getValue() as ChartType)
  cardDialog.showModal()
}

function closeCardDialog(): void {
  cardDialog.close()
}

function updateDialogFields(type: ChartType): void {
  const isValue = type === 'value'
  const isNumeric = type === 'line' || type === 'area' || type === 'bar' || type === 'gauge' || type === 'scatter' || type === 'value'
  const isControl = type === 'control'

  unitRow.classList.toggle('hidden', !isValue)
  thresholdRow.classList.toggle('hidden', !isNumeric)
  actionsRow.classList.toggle('hidden', !isControl)
}

function parseActions(text: string): { label: string; msg: string }[] | undefined {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  const result: { label: string; msg: string }[] = []
  for (const line of lines) {
    const idx = line.indexOf('=')
    if (idx < 0) continue
    const label = line.slice(0, idx).trim()
    const msg = line.slice(idx + 1).trim()
    if (label && msg) result.push({ label, msg })
  }
  return result.length > 0 ? result : undefined
}

cardForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const form = cardForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  const topic = (form.topic as HTMLInputElement).value.trim()
  if (!topic) {
    cardError.textContent = 'topic 不能为空'
    cardError.classList.remove('hidden')
    return
  }

  const type = CHART_TYPES.includes(typeDropdown.getValue() as ChartType)
    ? (typeDropdown.getValue() as ChartType)
    : 'line'

  const minValRaw = (form.minValue as HTMLInputElement).value.trim()
  const maxValRaw = (form.maxValue as HTMLInputElement).value.trim()
  const minValue = minValRaw !== '' ? Number(minValRaw) : undefined
  const maxValue = maxValRaw !== '' ? Number(maxValRaw) : undefined

  const cfgs = loadConfigs()
  const existing = editingId ? cfgs.find((c) => c.id === editingId) : undefined
  const cfg: ChartCardConfig = {
    id: existing?.id ?? defaultConfig().id,
    title: (form.title as HTMLInputElement).value.trim() || topic,
    type,
    topic,
    psize: Math.min(200, Math.max(1, Number((form.psize as HTMLInputElement).value) || 50)),
    jsonField: (form.jsonField as HTMLInputElement).value.trim() || undefined,
    unit: type === 'value' ? (form.unit as HTMLInputElement).value.trim() || undefined : undefined,
    minValue: minValue !== undefined && Number.isFinite(minValue) ? minValue : undefined,
    maxValue: maxValue !== undefined && Number.isFinite(maxValue) ? maxValue : undefined,
    actions: type === 'control' ? parseActions((form.actions as HTMLTextAreaElement).value) : undefined,
  }

  if (existing) {
    Object.assign(existing, cfg)
  } else {
    cfgs.push(cfg)
  }
  saveConfigs(cfgs)
  closeCardDialog()
  renderGrid()
})

cardCancel.addEventListener('click', closeCardDialog)

// ---- SIoT 连接设置对话框 ----
function openSettingsDialog(): void {
  const s = loadSettings()
  const t = loadTitles()
  const form = settingsForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement>
  ;(form.siotHost as HTMLInputElement).value = s.siotHost
  ;(form.siotWsPort as HTMLInputElement).value = String(s.siotWsPort)
  ;(form.siotWsPath as HTMLInputElement).value = s.siotWsPath
  ;(form.siotWsTls as HTMLInputElement).checked = s.siotWsTls
  ;(form.siotUser as HTMLInputElement).value = s.siotUser
  ;(form.siotPwd as HTMLInputElement).value = s.siotPwd
  ;(form.dashboardTitle as HTMLInputElement).value = t.dashboard
  settingsDialog.showModal()
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const form = settingsForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement>
  const s = loadSettings()
  s.siotHost = (form.siotHost as HTMLInputElement).value.trim() || s.siotHost
  s.siotWsPort = Math.max(1, Number((form.siotWsPort as HTMLInputElement).value) || s.siotWsPort)
  s.siotWsPath = (form.siotWsPath as HTMLInputElement).value.trim()
  s.siotWsTls = (form.siotWsTls as HTMLInputElement).checked
  s.siotUser = (form.siotUser as HTMLInputElement).value.trim() || s.siotUser
  s.siotPwd = (form.siotPwd as HTMLInputElement).value || s.siotPwd
  saveSettings(s)

  // 保存标题
  const t: PageTitles = loadTitles()
  t.dashboard = (form.dashboardTitle as HTMLInputElement).value.trim() || t.dashboard
  saveTitles(t)
  applyTitles()

  // 换连接：重连 + 全卡清缓冲（防新旧服务器数据混合）
  siotMqtt.updateSettings(s)
  for (const card of cards.values()) card.clearBuffer()

  settingsDialog.close()
})

settingsCancel.addEventListener('click', () => settingsDialog.close())

// ---- 悬浮球聊天 ----
let chatWidget: ReturnType<typeof createChatWidget> | null = null

function openChatWindow(): void {
  chatWindow.classList.remove('hidden')
  chatWindow.classList.add('entering')
  chatBall.classList.add('hidden')
  requestAnimationFrame(() => {
    chatWindow.classList.remove('entering')
  })
  if (!chatWidget) {
    chatWidget = createChatWidget(chatWidgetMount, {
      compact: true,
      onSettingsChange: () => {
        // 聊天设置中可能修改了 SIoT 参数，同步到仪表盘连接
        const s = loadSettings()
        siotMqtt.updateSettings(s)
        for (const card of cards.values()) card.clearBuffer()
      },
    })
  }
}

function minimizeChatWindow(): void {
  chatWindow.classList.add('hidden')
  chatBall.classList.remove('hidden')
}

chatBall.addEventListener('click', openChatWindow)
chatWindowMinimize.addEventListener('click', minimizeChatWindow)

// ---- 拖拽 ----
let dragging = false
let dragOffsetX = 0
let dragOffsetY = 0

chatWindowHeader.addEventListener('pointerdown', (e) => {
  // 拖拽手柄内的按钮（最小化等）不触发拖拽，避免 pointer capture 劫持 click
  if ((e.target as HTMLElement).closest('button')) return
  dragging = true
  const rect = chatWindow.getBoundingClientRect()
  dragOffsetX = e.clientX - rect.left
  dragOffsetY = e.clientY - rect.top
  chatWindowHeader.setPointerCapture(e.pointerId)
  chatWindow.style.transition = 'none'
})

chatWindowHeader.addEventListener('pointermove', (e) => {
  if (!dragging) return
  let x = e.clientX - dragOffsetX
  let y = e.clientY - dragOffsetY
  const maxX = window.innerWidth - chatWindow.offsetWidth
  const maxY = window.innerHeight - chatWindow.offsetHeight
  x = Math.max(0, Math.min(x, maxX))
  y = Math.max(0, Math.min(y, maxY))
  chatWindow.style.left = `${x}px`
  chatWindow.style.top = `${y}px`
  chatWindow.style.right = 'auto'
  chatWindow.style.bottom = 'auto'
})

chatWindowHeader.addEventListener('pointerup', (e) => {
  if (!dragging) return
  dragging = false
  chatWindowHeader.releasePointerCapture(e.pointerId)
  chatWindow.style.transition = ''
})

// ---- 初始化 ----
addBtn.addEventListener('click', () => openCardDialog(null))
settingsBtn.addEventListener('click', openSettingsDialog)

const settings = loadSettings()
siotMqtt.setStateListener(updateConnStatus)
siotMqtt.updateSettings(settings)
renderGrid()
