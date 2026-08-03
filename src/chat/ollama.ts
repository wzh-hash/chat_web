/**
 * ollama.ts — Ollama HTTP 客户端
 * API: GET /api/tags 列模型；POST /api/chat 流式对话（NDJSON）
 */

import type { ChatMessage } from '../lib/types'
import { ollamaBase } from '../lib/config'
import { parseSseStream } from './sse'

export interface OllamaModel {
  name: string
  model: string
  size: number
  modified_at: string
}

export interface ChatCallbacks {
  onToken: (token: string) => void
  onDone?: () => void
}

/** 拉取已安装的模型列表 */
export async function listModels(): Promise<OllamaModel[]> {
  let res: Response
  try {
    res = await fetch(`${ollamaBase()}/api/tags`)
  } catch {
    // 服务未启动或跨域(CORS)被拦截都会抛 TypeError
    throw new Error('无法连接 Ollama，请确认服务已启动（默认 127.0.0.1:11434）；若服务在远程或遇到跨域限制，请在⚙设置中切换为"经本地服务器代理"')
  }
  if (!res.ok) throw new Error(`Ollama 返回错误: HTTP ${res.status}`)
  const data = (await res.json()) as { models?: OllamaModel[] }
  return data.models ?? []
}

/** 流式对话：逐 token 回调；signal 中止时抛出 AbortError */
export async function chatStream(
  model: string,
  messages: ChatMessage[],
  cb: ChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${ollamaBase()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error('无法连接 Ollama，请确认服务已启动（默认 127.0.0.1:11434）；若服务在远程或遇到跨域限制，请在⚙设置中切换为"经本地服务器代理"')
  }

  if (!res.ok) {
    let msg = `Ollama 返回错误: HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg += ` — ${body.error}`
    } catch {
      // 响应体解析失败则只报状态码
    }
    throw new Error(msg)
  }

  await parseSseStream(
    res,
    (obj) => {
      const message = obj.message as { content?: string } | undefined
      const done = obj.done as boolean | undefined
      const content = message?.content ?? ''
      if (content) cb.onToken(content)
      if (done) cb.onDone?.()
    },
    signal,
  )
}
