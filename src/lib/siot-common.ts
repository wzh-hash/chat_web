/**
 * siot-common.ts — SIoT V2 MQTT 共享工具（跨 chat/dashboard 共享）
 * 职责：
 * - payload 双分支解析（JSON 包裹 / 裸内容）
 * - MqttMessage 类型
 * - 临时短连接采集数据（供聊天页 AI 读取 SIoT 数据）
 */

import mqtt from 'mqtt'
import type { MqttClient } from 'mqtt'
import type { AppSettings } from './config'
import { siotWsUrl } from './config'

export interface MqttMessage {
  topic: string
  content: string
  created: string
}

/** payload 双分支解析：JSON 包裹（含 Content/Created）或裸内容 */
export function extractMeta(text: string): { content: string; created: string } {
  try {
    const obj = JSON.parse(text) as { Content?: unknown; Created?: unknown }
    if (obj !== null && typeof obj === 'object' && typeof obj.Content === 'string') {
      return {
        content: obj.Content,
        created: typeof obj.Created === 'string' ? obj.Created : new Date().toISOString(),
      }
    }
  } catch {
    // 非 JSON，按裸内容处理
  }
  return { content: text, created: new Date().toISOString() }
}

/** 临时短连接采集 SIoT 数据 */
export function collectSiotData(
  settings: AppSettings,
  topic: string,
  opts: { durationMs: number; maxMessages?: number; signal?: AbortSignal },
): Promise<{ content: string; created: string }[]> {
  return new Promise((resolve, reject) => {
    const results: { content: string; created: string }[] = []
    const max = opts.maxMessages ?? Infinity
    let ended = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let client: MqttClient | null = null

    function end(): void {
      if (ended) return
      ended = true
      if (timer) clearTimeout(timer)
      if (client) {
        client.removeAllListeners()
        client.end(true)
        client = null
      }
      resolve(results)
    }

    function abort(): void {
      if (ended) return
      ended = true
      if (timer) clearTimeout(timer)
      if (client) {
        client.removeAllListeners()
        client.end(true)
        client = null
      }
      resolve(results)
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        abort()
        return
      }
      opts.signal.addEventListener('abort', abort)
    }

    client = mqtt.connect(siotWsUrl(settings), {
      username: settings.siotUser,
      password: settings.siotPwd,
      protocolVersion: 4,
      connectTimeout: 4000,
      reconnectPeriod: 0,
      clean: true,
    })

    client.on('connect', () => {
      client!.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          end()
          return
        }
        timer = setTimeout(end, opts.durationMs)
      })
    })

    client.on('error', (err: Error) => {
      if (!ended) {
        ended = true
        if (timer) clearTimeout(timer)
        client!.removeAllListeners()
        client!.end(true)
        reject(err)
      }
    })

    client.on('message', (_topic, payload) => {
      if (ended) return
      const text = new TextDecoder().decode(payload)
      const { content, created } = extractMeta(text)
      results.push({ content, created })
      if (results.length >= max) {
        end()
      }
    })

    // 兜底：无论连接是否成功，超时后必须结束
    timer = setTimeout(end, opts.durationMs + 5000)
  })
}
