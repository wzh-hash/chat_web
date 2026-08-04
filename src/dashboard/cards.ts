/**
 * cards.ts — 图表卡片控制器（MQTT 订阅版）
 * 职责：卡片 DOM、订阅生命周期、消息缓冲（上限 psize）、节流渲染、空态展示
 * 连接状态由 dashboard.ts 全局展示（单例连接），卡片只展示自身数据状态
 */

import { siotMqtt, type MqttMessage } from './mqtt'
import { parseContent, type ParsedDatum } from './parse'
import { initChart, disposeChart, updateChart, hasUsableData } from './charts'
import type { ChartCardConfig } from './storage'
import type { ECharts } from 'echarts/core'

export interface CardDeps {
  onEdit: (cfg: ChartCardConfig) => void
  onDelete: (id: string) => void
}

export class CardController {
  readonly cfg: ChartCardConfig
  readonly el: HTMLElement

  private chart: ECharts
  private chartHolder: HTMLElement
  private overlay: HTMLElement
  private statusEl: HTMLElement
  private buffer: ParsedDatum[] = []
  private counter = 0
  private dirty = false
  private rafId: number | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private detached = false

  constructor(container: HTMLElement, cfg: ChartCardConfig, deps: CardDeps) {
    this.cfg = cfg

    this.el = document.createElement('article')
    this.el.className = 'chart-card'
    this.el.innerHTML = `
      <header class="card-header">
        <h3 class="card-title"></h3>
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
    ;(this.el.querySelector('.card-title') as HTMLElement).textContent = cfg.title || cfg.topic || '图表'

    this.chart = initChart(this.chartHolder)

    // 卡片大小变化时图表自适应
    const ro = new ResizeObserver(() => this.chart.resize())
    ro.observe(this.chartHolder)

    ;(this.el.querySelector('.edit-btn') as HTMLButtonElement).addEventListener('click', () => {
      deps.onEdit(cfg)
    })
    ;(this.el.querySelector('.del-btn') as HTMLButtonElement).addEventListener('click', () => {
      deps.onDelete(cfg.id)
    })
  }

  /** 注册订阅（页面初始化/重建时调用） */
  start(): void {
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
    this.markDirty()
  }

  /** 销毁：退订、释放图表、移除 DOM */
  stop(): void {
    this.detached = true
    siotMqtt.unsubscribe(this.cfg.topic, this.onMessage)
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    if (this.flushTimer !== null) clearTimeout(this.flushTimer)
    disposeChart(this.chart)
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

    if (!hasUsableData(this.cfg.type, this.buffer)) {
      this.showOverlay('等待有效数据…')
      return
    }
    this.hideOverlay()
    updateChart(this.chart, this.cfg.type, this.buffer)
  }

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
}
