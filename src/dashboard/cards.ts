/**
 * cards.ts — 图表卡片控制器
 * 职责：卡片 DOM 构建、定时轮询生命周期、错误/空态展示、图表实例管理
 */

import { getMessages } from './siot'
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
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false

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

    // 卡片大小变化时自适应
    const ro = new ResizeObserver(() => this.chart.resize())
    ro.observe(this.chartHolder)

    ;(this.el.querySelector('.edit-btn') as HTMLButtonElement).addEventListener('click', () => {
      deps.onEdit(cfg)
    })
    ;(this.el.querySelector('.del-btn') as HTMLButtonElement).addEventListener('click', () => {
      deps.onDelete(cfg.id)
    })
  }

  /** 立即刷新一次，并按 refreshMs 排下一次（setTimeout 链，请求完成才排，天然防重叠） */
  start(): void {
    void this.refresh()
    this.schedule()
  }

  /** 暂停轮询（页面隐藏时调用） */
  pause(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 恢复轮询：立即刷新并重新排期 */
  resume(): void {
    void this.refresh()
    this.schedule()
  }

  /** 销毁：清定时器、释放图表、移除 DOM */
  stop(): void {
    this.pause()
    disposeChart(this.chart)
    this.el.remove()
  }

  private schedule(): void {
    this.pause()
    if (this.cfg.refreshMs <= 0) return
    this.timer = setTimeout(() => {
      void this.refresh()
      this.schedule()
    }, this.cfg.refreshMs)
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

  async refresh(): Promise<void> {
    if (this.inFlight) return
    this.inFlight = true
    try {
      if (!this.cfg.topic.trim()) {
        this.showOverlay('未设置 topic：点击"编辑"配置数据源')
        this.setStatus('未配置', true)
        return
      }

      // 卡片已被删除/重建时不再操作已销毁的 DOM
      if (!this.el.isConnected) return

      const msgs = await getMessages(this.cfg.topic, { psize: this.cfg.psize })
      const data: ParsedDatum[] = msgs
        .map((m, i) => parseContent(m.Content, m.Created, i + 1, this.cfg.jsonField))
        .sort((a, b) => a.t - b.t)

      if (!hasUsableData(this.cfg.type, data)) {
        this.showOverlay('暂无有效数据（该 topic 无数据或类型不匹配）')
        this.setStatus(`最近 ${msgs.length} 条`, false)
        return
      }

      updateChart(this.chart, this.cfg.type, data)
      this.hideOverlay()
      this.setStatus(`最近 ${data.length} 条`, false)
    } catch (err) {
      // 保留旧图表，仅显示错误状态；下个轮询周期自动恢复
      this.setStatus((err as Error).message, true)
    } finally {
      this.inFlight = false
    }
  }
}
