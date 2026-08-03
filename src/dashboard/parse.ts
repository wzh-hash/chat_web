/**
 * parse.ts — SIoT Content 解析策略
 * 1. 纯数字字符串 → number
 * 2. JSON 对象 → 取指定字段（未指定则自动探测首个数字字段）
 * 3. 其余 → category（按原字符串分类）
 *
 * label/t 由消息的 Created 时间字段生成（失败回退序号）
 */

export type DataKind = 'number' | 'json' | 'category'

export interface ParsedDatum {
  kind: DataKind
  value: number | null
  category: string | null
  label: string
  t: number
  raw: string
}

/** 解析单条消息；index 为序号（从 1 开始，用于 label/t 回退） */
export function parseContent(
  content: string,
  created: string,
  index: number,
  jsonField?: string,
): ParsedDatum {
  const trimmed = content.trim()

  // 1. 纯数字（防 Number('')===0 陷阱）
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return datum('number', Number(trimmed), null, content, created, index)
  }

  // 2. JSON 对象
  let parsed: unknown = null
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // 非 JSON，落到第 3 步
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    // 指定字段优先；否则自动探测第一个值为数字的字段（一层）
    const field = jsonField ?? firstNumberField(obj)
    if (field !== undefined) {
      const v = obj[field]
      if (typeof v === 'number' && Number.isFinite(v)) {
        return datum('json', v, null, content, created, index)
      }
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.trim()))) {
        return datum('json', Number(v.trim()), null, content, created, index)
      }
    }
  }

  // 3. 分类
  return datum('category', null, trimmed === '' ? '(空)' : trimmed, content, created, index)
}

function firstNumberField(obj: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number' && Number.isFinite(value)) return key
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) {
      return key
    }
  }
  return undefined
}

function datum(
  kind: DataKind,
  value: number | null,
  category: string | null,
  raw: string,
  created: string,
  index: number,
): ParsedDatum {
  return {
    kind,
    value,
    category,
    raw,
    label: makeLabel(created, index),
    t: timeOf(created, index),
  }
}

/** Created 形如 "2026-08-03 11:55:33" 或 ISO；解析失败回退序号 */
function makeLabel(created: string, index: number): string {
  const ts = Date.parse(created.replace(' ', 'T'))
  if (Number.isNaN(ts)) return `#${index}`
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function timeOf(created: string, index: number): number {
  const ts = Date.parse(created.replace(' ', 'T'))
  return Number.isNaN(ts) ? index : ts
}
