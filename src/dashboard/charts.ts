/**
 * charts.ts — ECharts 按需注册 + 各图表类型的 option 构建/更新
 * 仅仪表盘页引入，聊天页 bundle 不含 ECharts
 */

import * as echarts from 'echarts/core'
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

export function initChart(el: HTMLElement): ECharts {
  return echarts.init(el)
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
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 16, top: 24, bottom: 44 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { rotate: labels.length > 10 ? 30 : 0, fontSize: 11 },
    },
    yAxis: { type: 'value', scale: true },
    series: [
      {
        type: type === 'area' ? 'line' : type,
        smooth: type === 'line' || isArea,
        symbolSize: 8,
        areaStyle: isArea ? { opacity: 0.25 } : undefined,
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
        progress: { show: true, width: 14 },
        axisLine: { lineStyle: { width: 14 } },
        axisTick: { splitNumber: 5 },
        splitLine: { length: 12 },
        axisLabel: { fontSize: 10 },
        detail: {
          valueAnimation: true,
          fontSize: 22,
          formatter: '{value}',
          offsetCenter: [0, '60%'],
        },
        data: [{ value: last }],
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
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        type: 'pie',
        radius: '62%',
        center: ['50%', '46%'],
        data: [...counts.entries()].map(([name, value]) => ({ name, value })),
        label: { formatter: '{b}: {c}', fontSize: 11 },
      },
    ],
  }
}
