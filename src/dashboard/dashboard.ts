/**
 * dashboard.ts — 仪表盘页入口（MQTT 订阅版）
 * 职责：卡片网格（增/删/改）、全局连接状态、SIoT 连接设置、
 *       设置变更时重连并清空各卡缓冲（防新旧数据混合）
 */

import { loadSettings, saveSettings } from '../lib/config'
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
const typeSelect = document.getElementById('card-type') as HTMLSelectElement

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
  for (const cfg of cfgs) {
    const card = new CardController(gridEl, cfg, {
      onEdit: (c) => openCardDialog(c),
      onDelete: (id) => deleteCard(id),
    })
    cards.set(cfg.id, card)
    card.start()
  }
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

  const form = cardForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement>
  ;(form.title as HTMLInputElement).value = cfg?.title ?? ''
  ;(form.topic as HTMLInputElement).value = cfg?.topic ?? ''
  ;(form.psize as HTMLInputElement).value = String(cfg?.psize ?? 50)
  ;(form.jsonField as HTMLInputElement).value = cfg?.jsonField ?? ''
  typeSelect.value = cfg?.type ?? 'line'

  cardDialog.showModal()
}

function closeCardDialog(): void {
  cardDialog.close()
}

cardForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const form = cardForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement>
  const topic = (form.topic as HTMLInputElement).value.trim()
  if (!topic) {
    cardError.textContent = 'topic 不能为空'
    cardError.classList.remove('hidden')
    return
  }

  const cfgs = loadConfigs()
  const existing = editingId ? cfgs.find((c) => c.id === editingId) : undefined
  const cfg: ChartCardConfig = {
    id: existing?.id ?? defaultConfig().id,
    title: (form.title as HTMLInputElement).value.trim() || topic,
    type: CHART_TYPES.includes(typeSelect.value as ChartType)
      ? (typeSelect.value as ChartType)
      : 'line',
    topic,
    psize: Math.min(200, Math.max(1, Number((form.psize as HTMLInputElement).value) || 50)),
    jsonField: (form.jsonField as HTMLInputElement).value.trim() || undefined,
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
  const form = settingsForm as unknown as Record<string, HTMLInputElement | HTMLSelectElement>
  ;(form.siotHost as HTMLInputElement).value = s.siotHost
  ;(form.siotWsPort as HTMLInputElement).value = String(s.siotWsPort)
  ;(form.siotWsPath as HTMLInputElement).value = s.siotWsPath
  ;(form.siotWsTls as HTMLInputElement).checked = s.siotWsTls
  ;(form.siotUser as HTMLInputElement).value = s.siotUser
  ;(form.siotPwd as HTMLInputElement).value = s.siotPwd
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

  // 换连接：重连 + 全卡清缓冲（防新旧服务器数据混合）
  siotMqtt.updateSettings(s)
  for (const card of cards.values()) card.clearBuffer()

  settingsDialog.close()
})

settingsCancel.addEventListener('click', () => settingsDialog.close())

// ---- 初始化 ----
addBtn.addEventListener('click', () => openCardDialog(null))
settingsBtn.addEventListener('click', openSettingsDialog)

const settings = loadSettings()
siotMqtt.setStateListener(updateConnStatus)
siotMqtt.updateSettings(settings)
renderGrid()
