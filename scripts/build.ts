/**
 * build.ts — esbuild 多入口打包 + HTML/CSS 拷贝
 *
 * 用法:
 *   node scripts/build.ts            # 一次性构建到 dist/
 *   node scripts/build.ts --watch    # 增量监听（TS 用 esbuild context，HTML/CSS 用 fs.watch）
 *   node scripts/build.ts --serve    # 构建后启动静态服务器
 *   node scripts/build.ts --minify   # 压缩产物
 */

import { build, context } from 'esbuild'
import type { BuildOptions } from 'esbuild'
import { cpSync, existsSync, rmSync, watch } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const SRC = resolve('src')
const DIST = resolve('dist')

const entries = [
  resolve(SRC, 'index.ts'),
  resolve(SRC, 'chat/chat.ts'),
  resolve(SRC, 'dashboard/dashboard.ts'),
]

const common: BuildOptions = {
  entryPoints: entries,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  entryNames: 'assets/[name]',
  outdir: DIST,
}

/** 拷贝 HTML 与 CSS（esbuild 不处理它们） */
function copyAssets(): void {
  cpSync(resolve(SRC, 'index.html'), resolve(DIST, 'index.html'))
  cpSync(resolve(SRC, 'chat.html'), resolve(DIST, 'chat.html'))
  cpSync(resolve(SRC, 'dashboard.html'), resolve(DIST, 'dashboard.html'))
  cpSync(resolve(SRC, 'styles'), resolve(DIST, 'assets'), { recursive: true })
}

function clean(): void {
  if (!existsSync(DIST)) return
  try {
    rmSync(DIST, { recursive: true, force: true })
  } catch (err) {
    // 常见于复制/解压的项目：dist 归属 root 而当前用户无写权限
    console.warn(`警告: 无法清空 ${DIST} (${(err as Error).message})`)
    console.warn('若构建随后因权限失败，请先修复目录所有权:')
    console.warn(`  sudo chown -R $(whoami) ${resolve('..')}`)
  }
}

async function buildOnce(minify: boolean): Promise<void> {
  clean()
  await build({ ...common, minify })
  copyAssets()
  console.log(`构建完成 → ${DIST}`)
}

async function watchMode(minify: boolean, serve: boolean): Promise<void> {
  clean()
  const ctx = await context({ ...common, minify, logLevel: 'info' })
  await ctx.watch()
  copyAssets()
  console.log('监听中: TS 增量重建, HTML/CSS 变化自动拷贝 (Ctrl+C 退出)')

  // HTML/CSS 变化监听
  watch(SRC, { recursive: true }, (_evt, filename) => {
    if (/\.(html|css)$/.test(filename ?? '')) {
      copyAssets()
      console.log(`已拷贝: ${filename}`)
    }
  })

  if (serve) startServer()
}

function startServer(): void {
  // 默认开启 SIoT/Ollama 同源代理（页面设置中可切换直连/代理）
  const child = spawn(process.execPath, [
    resolve('scripts/serve.ts'),
    '--siot-proxy',
    '--ollama-proxy',
  ], {
    stdio: 'inherit',
  })
  child.on('error', (err) => console.error('启动服务器失败:', err))
}

const args = process.argv.slice(2)
const isWatch = args.includes('--watch')
const isServe = args.includes('--serve')
const isMinify = args.includes('--minify')

if (isWatch) {
  watchMode(isMinify, isServe).catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else {
  buildOnce(isMinify)
    .then(() => {
      if (isServe) startServer()
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
