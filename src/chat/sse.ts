/**
 * sse.ts — 流式响应解析器
 * Ollama 返回 NDJSON 裸行（每行一个 JSON 对象），部分实现会带 "data:" 前缀。
 * 这里防御式两种都接受：按行缓冲解析（防分片跨行），行首 "data:" 前缀剥离，
 * 空行与无效 JSON 行跳过。
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

  // 处理末尾残余（无换行结尾的最后一行）
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
    // 单行解析失败则跳过（可能是不完整的数据）
  }
}
