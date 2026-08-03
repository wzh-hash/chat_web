/**
 * siot.ts — SIoT v2 HTTP 客户端
 * API: GET /messages 拉取历史消息；GET /lastmessage 拉取最新一条
 * 直连/代理模式由 lib/config 的 siotBase() 透明处理
 */

import { siotBase, siotCred } from '../lib/config'

export interface SiotMessage {
  ID: number
  Topic: string
  Content: string
  Created: string
}

interface SiotResponse {
  code: number
  msg?: string
  data?: SiotMessage[]
}

/** 拉取 topic 的历史消息（按 ID 升序返回） */
export async function getMessages(
  topic: string,
  opts?: { psize?: number },
): Promise<SiotMessage[]> {
  const psize = Math.min(200, Math.max(1, opts?.psize ?? 50))
  const cred = siotCred()
  const url = `${siotBase()}/messages?topic=${encodeURIComponent(topic)}` +
    `&iname=${encodeURIComponent(cred.iname)}&ipwd=${encodeURIComponent(cred.ipwd)}` +
    `&pnum=1&psize=${psize}`

  const body = await requestJson(url, '无法连接 SIoT，请确认服务已启动（默认 127.0.0.1:8080）')

  if (body.code !== 1) {
    throw new Error(`SIoT 返回错误: ${body.msg ?? `code=${body.code}`}`)
  }
  return Array.isArray(body.data) ? body.data : []
}

/** 拉取最新一条消息；无数据时返回 null（不抛错） */
export async function getLastMessage(topic: string): Promise<SiotMessage | null> {
  const cred = siotCred()
  const url = `${siotBase()}/lastmessage?topic=${encodeURIComponent(topic)}` +
    `&iname=${encodeURIComponent(cred.iname)}&ipwd=${encodeURIComponent(cred.ipwd)}`

  const body = await requestJson(url, '无法连接 SIoT，请确认服务已启动（默认 127.0.0.1:8080）')

  if (body.code !== 1 || !Array.isArray(body.data) || body.data.length === 0) {
    return null
  }
  return body.data[0]
}

async function requestJson(url: string, offlineMsg: string): Promise<SiotResponse> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error(offlineMsg)
  }
  if (!res.ok) {
    throw new Error(`SIoT 返回错误: HTTP ${res.status}`)
  }
  return (await res.json()) as SiotResponse
}
