/**
 * charts.ts — ECharts 按需注册 + 各图表类型的 option 构建/更新
 * 仅仪表盘页引入，聊天页 bundle 不含 ECharts
 */

import * as echarts from 'echarts/core'
import { graphic } from 'echarts/core'
import { LineChart, BarChart, PieChart, GaugeChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ECharts, EChartsCoreOption } from 'echarts/core'
import type { ParsedDatum } from './parse'
import type { ChartType } from './storage'

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GaugeChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  CanvasRenderer,
])

/** 霓虹配色（图表系列/图例用） */
const NEON_COLORS = [
  '#38bdf8',
  '#4ade80',
  '#a78bfa',
  '#f472b6',
  '#fbbf24',
  '#fb923c',
  '#22d3ee',
  '#f87171',
]

/** 暗色主题公用轴样式（axisLabel 由各轴自行指定，避免键冲突） */
const DARK_AXIS = {
  axisLine: { lineStyle: { color: 'rgba(148,163,184,0.25)' } },
  axisTick: { lineStyle: { color: 'rgba(148,163,184,0.2)' } },
  splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } },
}

export function initChart(el: HTMLElement): ECharts {
  return echarts.init(el, undefined, { renderer: 'canvas' })
}

export function disposeChart(chart: ECharts): void {
  chart.dispose()
}

/** 判断数据是否可用于该图表类型（避免渲染假数据） */
export function hasUsableData(type: ChartType, data: ParsedDatum[]): boolean {
  if (data.length === 0) return false
  if (type === 'pie') return data.some((d) => d.category !== null)
  return data.some((d) => d.value !== null)
}

/** 全量替换 option（notMerge）以适应类型/数据完全变化 */
export function updateChart(chart: ECharts, type: ChartType, data: ParsedDatum[]): void {
  chart.setOption(buildOption(type, data), true)
}

function buildOption(type: ChartType, data: ParsedDatum[]): EChartsCoreOption {
  switch (type) {
    case 'gauge':
      return gaugeOption(data)
    case 'pie':
      return pieOption(data)
    default:
      return cartesianOption(type, data)
  }
}

/** 折线/面积/柱状/散点：x 轴用 label（category 轴，避免时区换算），y 用数值 */
function cartesianOption(type: Exclude<ChartType, "gauge" | "pie">, data: ParsedDatum[]): EChartsCoreOption {
  const labels = data.map((d) => d.label)
  const values = data.map((d) => d.value ?? 0)
  const isArea = type === 'area'
  const isScatter = type === 'scatter'
  const color = NEON_COLORS[0]
  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15,23,42,0.9)',
      borderColor: 'rgba(56,189,248,0.25)',
      textStyle: { color: '#e2e8f0' },
      extraCssText:
        'backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(0,0,0,0.45); border-radius: 8px;',
    },
    grid: { left: 52, right: 16, top: 24, bottom: 44 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { rotate: labels.length > 10 ? 30 : 0, fontSize: 11, color: '#94a3b8' },
      ...DARK_AXIS,
    },
    yAxis: { type: 'value', scale: true, axisLabel: { color: '#94a3b8' }, ...DARK_AXIS },
    series: [
      {
        type: type === 'area' ? 'line' : type,
        smooth: type === 'line' || isArea,
        symbolSize: isScatter ? 10 : 8,
        itemStyle: isScatter
          ? {
              color: NEON_COLORS[1],
              shadowBlur: 10,
              shadowColor: 'rgba(74,222,128,0.4)',
            }
          : undefined,
        lineStyle: {
          width: 2,
          color,
          shadowBlur: isScatter ? 0 : 10,
          shadowColor: isScatter ? undefined : 'rgba(56,189,248,0.45)',
        },
        areaStyle: isArea
          ? {
              color: new graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(56,189,248,0.35)' },
                { offset: 1, color: 'rgba(56,189,248,0.02)' },
              ]),
            }
          : undefined,
        data: values,
      },
    ],
  }
}

/** 仪表盘：取最后一条数值，max 自适应（1.2 倍向上取整） */
function gaugeOption(data: ParsedDatum[]): EChartsCoreOption {
  const numeric = data.filter((d) => d.value !== null).map((d) => d.value as number)
  const last = numeric.length > 0 ? numeric[numeric.length - 1] : 0
  const max = numeric.length > 0 ? Math.max(10, Math.ceil(Math.max(...numeric) * 1.2)) : 100
  return {
    series: [
      {
        type: 'gauge',
        min: 0,
        max,
        progress: { show: true, width: 14, itemStyle: { color: '#38bdf8' } },
        axisLine: { lineStyle: { width: 14, color: [[1, 'rgba(148,163,184,0.15)']] } },
        axisTick: { splitNumber: 5, lineStyle: { color: 'rgba(148,163,184,0.3)' } },
        splitLine: { length: 12, lineStyle: { color: 'rgba(148,163,184,0.25)' } },
        axisLabel: { fontSize: 10, color: '#94a3b8' },
        detail: {
          valueAnimation: true,
          fontSize: 22,
          formatter: '{value}',
          offsetCenter: [0, '60%'],
          color: '#e2e8f0',
        },
        data: [{ value: last, itemStyle: { color: '#38bdf8' } }],
        pointer: { itemStyle: { color: '#4ade80' } },
        anchor: { itemStyle: { color: '#4ade80' } },
      },
    ],
  }
}

/** 饼图：按 category 频次聚合 */
function pieOption(data: ParsedDatum[]): EChartsCoreOption {
  const counts = new Map<string, number>()
  for (const d of data) {
    const name = d.category ?? '(空)'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(15,23,42,0.9)',
      borderColor: 'rgba(56,189,248,0.25)',
      textStyle: { color: '#e2e8f0' },
      extraCssText:
        'backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(0,0,0,0.45); border-radius: 8px;',
    },
    legend: { bottom: 0, type: 'scroll', textStyle: { color: '#94a3b8' } },
    series: [
      {
        type: 'pie',
        radius: '62%',
        center: ['50%', '46%'],
        data: [...counts.entries()].map(([name, value]) => ({ name, value })),
        label: { formatter: '{b}: {c}', fontSize: 11, color: '#e2e8f0' },
        itemStyle: {
          borderColor: '#0b1120',
          borderWidth: 2,
          shadowBlur: 8,
          shadowColor: 'rgba(0,0,0,0.35)',
        },
        color: NEON_COLORS,
      },
    ],
  }
}
