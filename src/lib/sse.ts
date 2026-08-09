/**
 * sse.ts — 流式响应解析器（Ollama 聊天用，chat-core 共享）
 * 防御式：NDJSON 裸行与 "data:" 前缀都接受，缓冲到换行防分片，无效行跳过
 */

export async function parseSseStream(
  res: Response,
  onData: (obj: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('响应没有可读取的流')

  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    if (signal?.aborted) throw new DOMException('已中止', 'AbortError')
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      handleLine(line, onData)
    }
  }

  const tail = buffer.trim()
  if (tail) handleLine(tail, onData)
}

function handleLine(line: string, onData: (obj: Record<string, unknown>) => void): void {
  if (!line) return
  const jsonText = line.startsWith('data:') ? line.slice(5).trim() : line
  if (!jsonText) return
  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>
    onData(obj)
  } catch {
    // 单行解析失败则跳过
  }
}
