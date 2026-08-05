/**
 * storage.ts — 图表卡片配置的 localStorage 读写
 * 版本化 key + 损坏数据兜底（读失败返回默认，逐字段补缺）
 *
 * v2 变更：删除 refreshMs（MQTT 实时推送，无需轮询间隔），
 *   psize 语义改为"缓冲条数上限"；读取 v1 数据时自动迁移（丢弃 refreshMs）。
 * v3 变更：新增 chart 类型 value / control / image；
 *   ChartCardConfig 扩展 unit / minValue / maxValue / actions。
 */

import {
  uid,
  STORAGE_KEY_CARDS,
  STORAGE_KEY_CARDS_V1,
  DEFAULT_PSIZE,
} from '../lib/config'

export type ChartType = 'line' | 'area' | 'bar' | 'pie' | 'gauge' | 'scatter' | 'value' | 'control' | 'image'

export const CHART_TYPES: readonly ChartType[] = [
  'line',
  'area',
  'bar',
  'pie',
  'gauge',
  'scatter',
  'value',
  'control',
  'image',
]

export interface ChartCardConfig {
  id: string
  title: string
  type: ChartType
  topic: string
  /** 缓冲条数上限（保留最近 N 条） */
  psize: number
  jsonField?: string
  /** 数值展示单位 */
  unit?: string
  /** 告警下限（仅数值类生效） */
  minValue?: number
  /** 告警上限（仅数值类生效） */
  maxValue?: number
  /** 控制指令按钮列表 */
  actions?: { label: string; msg: string }[]
}

const DEFAULT_ACTIONS: { label: string; msg: string }[] = [
  { label: '开', msg: 'on' },
  { label: '关', msg: 'off' },
]

export function defaultConfig(): ChartCardConfig {
  return {
    id: uid(),
    title: '图表',
    type: 'line',
    topic: '',
    psize: DEFAULT_PSIZE,
  }
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function sanitizeActions(raw: unknown): { label: string; msg: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const arr = raw
    .filter((o): o is { label: string; msg: string } => {
      return (
        o !== null &&
        typeof o === 'object' &&
        typeof (o as Record<string, unknown>).label === 'string' &&
        typeof (o as Record<string, unknown>).msg === 'string'
      )
    })
    .map((o) => ({ label: o.label, msg: o.msg }))
  return arr.length > 0 ? arr : undefined
}

function sanitize(raw: unknown): ChartCardConfig | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Partial<ChartCardConfig>
  const type = CHART_TYPES.includes(o.type as ChartType) ? (o.type as ChartType) : 'line'
  const psize = type === 'image' ? 1 : clampInt(o.psize, DEFAULT_PSIZE, 1, 200)
  return {
    id: typeof o.id === 'string' && o.id ? o.id : uid(),
    title: typeof o.title === 'string' ? o.title : '图表',
    type,
    topic: typeof o.topic === 'string' ? o.topic : '',
    psize,
    jsonField: typeof o.jsonField === 'string' && o.jsonField ? o.jsonField : undefined,
    unit: typeof o.unit === 'string' && o.unit ? o.unit : undefined,
    minValue: typeof o.minValue === 'number' && Number.isFinite(o.minValue) ? o.minValue : undefined,
    maxValue: typeof o.maxValue === 'number' && Number.isFinite(o.maxValue) ? o.maxValue : undefined,
    actions: sanitizeActions(o.actions) ?? (type === 'control' ? DEFAULT_ACTIONS : undefined),
  }
}

/** 读取卡片配置；损坏数据丢弃，非法字段补默认；v1 数据自动迁移（丢弃 refreshMs） */
export function loadConfigs(): ChartCardConfig[] {
  for (const key of [STORAGE_KEY_CARDS, STORAGE_KEY_CARDS_V1]) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) continue
      const cfgs = parsed.map(sanitize).filter((c): c is ChartCardConfig => c !== null)
      // 读到 v1 时迁移写回 v2（幂等；v1 key 保留可回滚）
      if (key === STORAGE_KEY_CARDS_V1 && cfgs.length > 0) {
        saveConfigs(cfgs)
      }
      return cfgs
    } catch {
      // 尝试下一个 key
    }
  }
  return []
}

export function saveConfigs(cfgs: ChartCardConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_CARDS, JSON.stringify(cfgs))
  } catch {
    // 存储不可用（隐私模式/配额）时静默忽略
  }
}
