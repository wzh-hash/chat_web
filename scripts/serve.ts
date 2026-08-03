/**
 * serve.ts — 零依赖静态文件服务器（含可选反向代理）
 *
 * 用法:
 *   node scripts/serve.ts [--port 8000] [--dir dist]
 *     [--siot-proxy]   [--siot-target http://127.0.0.1:8080]
 *     [--ollama-proxy] [--ollama-target http://127.0.0.1:11434]
 *
 * - 静态文件从 --dir 目录提供，路径穿越防护
 * - 代理默认关闭；--siot-proxy / --ollama-proxy 分别开启
 *   /siot/ 与 /ollama/ 前缀的反向代理（绕过浏览器 CORS 限制）
 * - 上游不可达时返回 502 + JSON 错误体
 * - 端口默认 8000（刻意避开 SIoT 的 8080）
 */

import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, extname, resolve } from 'node:path'

type Proxy = { prefix: string; target: URL }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}

function parseArgs(argv: string[]): {
  port: number
  dir: string
  proxies: Proxy[]
} {
  let port = 8000
  let dir = resolve('dist')
  const proxies: Proxy[] = []

  let i = 0
  // 仅当下一个参数不是 -- 开头的标志时，才把它作为值消费
  const takeValue = (fallback: string): string => {
    const nextArg = argv[i + 1]
    if (nextArg !== undefined && !nextArg.startsWith('--')) {
      i++
      return nextArg
    }
    return fallback
  }

  for (; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') port = Number(takeValue(String(port)))
    else if (a === '--dir') dir = resolve(takeValue(dir))
    else if (a === '--siot-proxy') {
      proxies.push({ prefix: '/siot/', target: new URL(takeValue('http://127.0.0.1:8080')) })
    } else if (a === '--ollama-proxy') {
      proxies.push({ prefix: '/ollama/', target: new URL(takeValue('http://127.0.0.1:11434')) })
    }
  }
  return { port, dir, proxies }
}

function sendError(res: import('node:http').ServerResponse, status: number, msg: string): void {
  const body = JSON.stringify({ code: status, msg })
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** 反向代理：保留 path+query，请求体流式转发（SSE chunked 不变形） */
function handleProxy(proxy: Proxy, req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse): void {
  const upstreamPath = (req.url ?? '').slice(proxy.prefix.length)
  const upstreamUrl = new URL(upstreamPath, proxy.target)
  const doRequest = upstreamUrl.protocol === 'https:' ? httpsRequest : httpRequest

  const upstreamReq = doRequest(upstreamUrl, {
    method: req.method,
    headers: { ...req.headers, host: upstreamUrl.host },
  }, (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.headers)
    upRes.pipe(res)
  })

  upstreamReq.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ECONNREFUSED') {
      sendError(res, 502, `代理目标不可达: ${proxy.target.host}（请确认上游服务已启动）`)
    } else {
      sendError(res, 502, `代理错误: ${err.message}`)
    }
  })

  req.pipe(upstreamReq)
}

/** 静态文件响应；index 目录回退；路径穿越防护 */
function handleStatic(dir: string, req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse): void {
  let pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  if (pathname === '/') pathname = '/index.html'

  const filePath = normalize(join(dir, pathname))
  if (!filePath.startsWith(normalize(dir))) {
    sendError(res, 403, '禁止访问')
    return
  }

  // 目录 → index.html
  let finalPath = filePath
  if (!extname(filePath) || (existsSync(finalPath) && statSync(finalPath).isDirectory())) {
    finalPath = join(finalPath, 'index.html')
  }

  if (!existsSync(finalPath) || !statSync(finalPath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>404</title></head><body style="font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div><h1>404 页面不存在</h1><p><a href="/">返回首页</a></p></div></body></html>')
    return
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(finalPath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  createReadStream(finalPath).pipe(res)
}

const { port, dir, proxies } = parseArgs(process.argv.slice(2))

const server = createServer((req, res) => {
  const url = req.url ?? '/'

  // 代理优先级：匹配前缀则转发
  for (const p of proxies) {
    if (url.startsWith(p.prefix)) {
      handleProxy(p, req, res)
      return
    }
  }

  handleStatic(dir, req, res)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用，请用 --port 换一个端口`)
    process.exit(1)
  }
  throw err
})

server.listen(port, () => {
  console.log(`静态服务器: http://localhost:${port}/  (目录: ${dir})`)
  for (const p of proxies) {
    console.log(`代理: ${p.prefix} → ${p.target.href}`)
  }
})
