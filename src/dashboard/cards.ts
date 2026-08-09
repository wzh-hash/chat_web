/**
 * cards.ts — 图表卡片控制器（MQTT 订阅版）
 * 职责：卡片 DOM、订阅生命周期、消息缓冲（上限 psize）、节流渲染、空态展示
 * 连接状态由 dashboard.ts 全局展示（单例连接），卡片只展示自身数据状态
 *
 * 新增：支持 value / control / image 类型；阈值告警（is-alert）
 */

import { siotMqtt, type MqttMessage } from './mqtt'
import { parseContent, type ParsedDatum } from './parse'
import { initChart, disposeChart, updateChart, hasUsableData } from './charts'
import type { ChartCardConfig } from './storage'
import type { ECharts } from 'echarts/core'
import { iconCamera, iconPower } from '../lib/icons'

export interface CardDeps {
  onEdit: (cfg: ChartCardConfig) => void
  onDelete: (id: string) => void
}

const isEchartType = (t: string) =>
  t === 'line' || t === 'area' || t === 'bar' || t === 'pie' || t === 'gauge' || t === 'scatter'
const isNumericType = (t: string) =>
  t === 'line' || t === 'area' || t === 'bar' || t === 'gauge' || t === 'scatter' || t === 'value'

export class CardController {
  readonly cfg: ChartCardConfig
  readonly el: HTMLElement

  private chart: ECharts | null = null
  private chartHolder: HTMLElement
  private overlay: HTMLElement
  private statusEl: HTMLElement
  private alertEl: HTMLElement
  private buffer: ParsedDatum[] = []
  private counter = 0
  private dirty = false
  private rafId: number | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private detached = false
  private valueDom: {
    numberEl: HTMLElement
    unitEl: HTMLElement
    timeEl: HTMLElement
  } | null = null
  private imgEl: HTMLImageElement | null = null
  private imgTimeEl: HTMLElement | null = null

  constructor(container: HTMLElement, cfg: ChartCardConfig, deps: CardDeps) {
    this.cfg = cfg

    this.el = document.createElement('article')
    this.el.className = 'chart-card'
    this.el.innerHTML = `
      <header class="card-header">
        <h3 class="card-title"></h3>
        <span class="card-alert hidden">⚠ 超限</span>
        <span class="card-status"></span>
        <div class="card-actions">
          <button class="edit-btn" title="编辑">编辑</button>
          <button class="del-btn danger" title="删除">删除</button>
        </div>
      </header>
      <div class="chart-body">
        <div class="chart-holder"></div>
        <div class="card-overlay empty-state hidden">
          <p class="overlay-text"></p>
        </div>
      </div>
    `
    container.appendChild(this.el)

    this.chartHolder = this.el.querySelector('.chart-holder') as HTMLElement
    this.overlay = this.el.querySelector('.card-overlay') as HTMLElement
    this.statusEl = this.el.querySelector('.card-status') as HTMLElement
    this.alertEl = this.el.querySelector('.card-alert') as HTMLElement
    ;(this.el.querySelector('.card-title') as HTMLElement).textContent = cfg.title || cfg.topic || '图表'

    if (isEchartType(cfg.type)) {
      this.chart = initChart(this.chartHolder)
      const ro = new ResizeObserver(() => this.chart?.resize())
      ro.observe(this.chartHolder)
    } else if (cfg.type === 'value') {
      this.initValueDom()
    } else if (cfg.type === 'control') {
      this.initControlDom()
    } else if (cfg.type === 'image') {
      this.initImageDom()
    }

    ;(this.el.querySelector('.edit-btn') as HTMLButtonElement).addEventListener('click', () => {
      deps.onEdit(cfg)
    })
    ;(this.el.querySelector('.del-btn') as HTMLButtonElement).addEventListener('click', () => {
      deps.onDelete(cfg.id)
    })
  }

  /** 注册订阅（页面初始化/重建时调用） */
  start(): void {
    if (this.cfg.type === 'control') {
      this.setStatus('控制面板', false)
      return
    }
    if (!this.cfg.topic.trim()) {
      this.showOverlay('未设置 topic：点击"编辑"配置数据源')
      return
    }
    siotMqtt.subscribe(this.cfg.topic, this.onMessage)
    this.setStatus('等待数据…', false)
  }

  /** 换服务器/清空历史时调用（不清连接、保留订阅） */
  clearBuffer(): void {
    this.buffer = []
    this.counter = 0
    this.setStatus('等待数据…', false)
    this.showOverlay('等待数据…')
    this.el.classList.remove('is-alert')
    this.alertEl.classList.add('hidden')
    if (this.cfg.type === 'value') {
      this.valueDom!.numberEl.textContent = '—'
      this.valueDom!.timeEl.textContent = ''
    } else if (this.cfg.type === 'image') {
      this.imgEl!.src = ''
      this.imgEl!.classList.add('hidden')
      this.imgTimeEl!.textContent = ''
    }
    this.markDirty()
  }

  /** 销毁：退订、释放图表、移除 DOM */
  stop(): void {
    this.detached = true
    if (this.cfg.type !== 'control') {
      siotMqtt.unsubscribe(this.cfg.topic, this.onMessage)
    }
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    if (this.flushTimer !== null) clearTimeout(this.flushTimer)
    if (this.chart) {
      disposeChart(this.chart)
      this.chart = null
    }
    this.el.remove()
  }

  // ---- 内部 ----

  private onMessage = (msg: MqttMessage): void => {
    if (this.detached) return
    this.buffer.push(parseContent(msg.content, msg.created, ++this.counter, this.cfg.jsonField))
    if (this.buffer.length > this.cfg.psize) this.buffer.shift()
    this.setStatus(`${this.buffer.length} 条`, false)
    this.markDirty()
  }

  /** 合并渲染：raf 处理突发（历史重放），setTimeout 兜底后台 tab */
  private markDirty(): void {
    if (this.dirty) return
    this.dirty = true
    this.rafId = requestAnimationFrame(() => this.flush())
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), 250)
    }
  }

  private flush(): void {
    this.dirty = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.detached) return

    if (this.cfg.type === 'value') {
      this.flushValue()
      return
    }
    if (this.cfg.type === 'image') {
      this.flushImage()
      return
    }
    if (this.cfg.type === 'control') return

    if (!hasUsableData(this.cfg.type, this.buffer)) {
      this.showOverlay('等待有效数据…')
      return
    }
    this.hideOverlay()
    updateChart(this.chart!, this.cfg.type, this.buffer)
    this.checkAlert()
  }

  // ---- value 类型 ----

  private initValueDom(): void {
    this.chartHolder.innerHTML = `
      <div class="value-display">
        <div class="value-number">—</div>
        <div class="value-meta">
          <span class="value-unit"></span>
          <span class="value-time"></span>
        </div>
      </div>
    `
    this.valueDom = {
      numberEl: this.chartHolder.querySelector('.value-number') as HTMLElement,
      unitEl: this.chartHolder.querySelector('.value-unit') as HTMLElement,
      timeEl: this.chartHolder.querySelector('.value-time') as HTMLElement,
    }
    if (this.cfg.unit) {
      this.valueDom.unitEl.textContent = this.cfg.unit
    }
  }

  private flushValue(): void {
    const latest = this.findLatestNumeric()
    if (!latest) {
      this.showOverlay('等待数据…')
      this.valueDom!.numberEl.textContent = '—'
      this.valueDom!.timeEl.textContent = ''
      this.el.classList.remove('is-alert')
      this.alertEl.classList.add('hidden')
      return
    }
    this.hideOverlay()
    this.valueDom!.numberEl.textContent =
      latest.value !== null ? String(latest.value) : latest.category ?? '—'
    this.valueDom!.timeEl.textContent = latest.label
    this.checkAlert()
  }

  // ---- image 类型 ----

  private initImageDom(): void {
    this.chartHolder.innerHTML = `
      <div class="image-display">
        <img class="hidden" src="" alt="图传画面">
        <div class="image-placeholder">
          ${iconCamera}
          <p>等待图像数据…</p>
          <p class="sub">设备发送图片消息后自动显示</p>
        </div>
        <div class="image-time"></div>
      </div>
    `
    this.imgEl = this.chartHolder.querySelector('img') as HTMLImageElement
    this.imgTimeEl = this.chartHolder.querySelector('.image-time') as HTMLElement
  }

  private flushImage(): void {
    const last = this.buffer[this.buffer.length - 1]
    if (!last) {
      this.showOverlay('等待数据…')
      this.imgEl!.classList.add('hidden')
      this.imgTimeEl!.textContent = ''
      return
    }
    this.hideOverlay()
    const raw = last.raw.trim()
    let src = raw
    if (!raw.startsWith('data:image/')) {
      src = `data:image/jpeg;base64,${raw}`
    }
    this.imgEl!.src = src
    this.imgEl!.classList.remove('hidden')
    this.imgEl!.alt = '图传画面'
    this.imgTimeEl!.textContent = `最新帧 ${last.label}`
  }

  // ---- control 类型 ----

  private initControlDom(): void {
    const actions = this.cfg.actions ?? [{ label: '开', msg: 'on' }, { label: '关', msg: 'off' }]
    const btnsHtml = actions
      .map(
        (a, i) =>
          `<button class="ctrl-btn" data-idx="${i}" data-msg="${this.escapeHtml(a.msg)}" data-label="${this.escapeHtml(a.label)}">
            <span class="ctrl-icon">${iconPower}</span>
            <span class="ctrl-label">${this.escapeHtml(a.label)}</span>
          </button>`,
      )
      .join('')
    this.chartHolder.innerHTML = `
      <div class="control-panel">
        <div class="control-buttons">${btnsHtml}</div>
        <div class="control-feedback hidden"></div>
      </div>
    `
    const panel = this.chartHolder.querySelector('.control-buttons') as HTMLElement
    const feedback = this.chartHolder.querySelector('.control-feedback') as HTMLElement
    panel.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('.ctrl-btn') as HTMLButtonElement | null
      if (!btn) return
      const msg = btn.dataset.msg!
      const label = btn.dataset.label!
      if (!window.confirm(`向 topic「${this.cfg.topic}」发送指令「${label}」？`)) return
      try {
        await siotMqtt.publish(this.cfg.topic, msg)
        feedback.textContent = '已发送 ✓'
        feedback.classList.remove('hidden')
        setTimeout(() => feedback.classList.add('hidden'), 1500)
      } catch (err) {
        feedback.textContent = (err as Error).message || '发送失败'
        feedback.classList.remove('hidden')
        setTimeout(() => feedback.classList.add('hidden'), 2000)
      }
    })
  }

  // ---- 告警检测 ----

  private checkAlert(): void {
    if (!isNumericType(this.cfg.type)) {
      this.el.classList.remove('is-alert')
      this.alertEl.classList.add('hidden')
      return
    }
    const latest = this.findLatestNumeric()
    const min = this.cfg.minValue
    const max = this.cfg.maxValue
    let alert = false
    if (latest && latest.value !== null && (min !== undefined || max !== undefined)) {
      if (min !== undefined && latest.value < min) alert = true
      if (max !== undefined && latest.value > max) alert = true
    }
    this.el.classList.toggle('is-alert', alert)
    this.alertEl.classList.toggle('hidden', !alert)
  }

  private findLatestNumeric(): ParsedDatum | null {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const d = this.buffer[i]
      if (d.value !== null) return d
    }
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null
  }

  // ---- DOM 辅助 ----

  private showOverlay(text: string): void {
    ;(this.overlay.querySelector('.overlay-text') as HTMLElement).textContent = text
    this.overlay.classList.remove('hidden')
  }

  private hideOverlay(): void {
    this.overlay.classList.add('hidden')
  }

  private setStatus(text: string, isError: boolean): void {
    this.statusEl.textContent = text
    this.statusEl.classList.toggle('is-error', isError)
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }
}
