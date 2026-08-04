#!/usr/bin/env node
/**
 * probe-mqtt.mjs — 探测 SIoT V2 的 MQTT over WebSocket 连接参数
 *
 * 用法:
 *   node scripts/probe-mqtt.mjs [主机IP] [topic] [账号] [密码] [--wss]
 * 默认值:
 *   node scripts/probe-mqtt.mjs 10.1.2.3 xzr/001 siot dfrobot
 *
 * 按端点矩阵逐一尝试: ws(wss) × 端口{1884,1888} × 路径{'',/mqtt,/ws} × 协议版本{4,3}
 * 连接成功并收到消息的端点即为可用配置；首个收到的消息会打印
 * 完整格式（hex + utf8 + 若为 JSON 打印所有键），用于确认 payload 结构。
 */
import mqtt from 'mqtt'

const HOST = process.argv[2] ?? '10.1.2.3'
const TOPIC = process.argv[3] ?? 'xzr/001'
const USER = process.argv[4] ?? 'siot'
const PWD = process.argv[5] ?? 'dfrobot'
const WITH_WSS = process.argv.includes('--wss')

const PORTS = [1884, 1888]
const PATHS = ['', '/mqtt', '/ws']
const VERSIONS = [4, 3]

const decoder = new TextDecoder()
const results = []

function printPayloadDetail(topic, payload) {
  const raw = decoder.decode(payload)
  const hex = Buffer.from(payload).toString('hex').slice(0, 64)
  console.log(`    ┌ 首条消息 topic=${topic}`)
  console.log(`    │ utf8: ${raw.slice(0, 120)}`)
  console.log(`    │ hex : ${hex}${payload.length > 32 ? '…' : ''}`)
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') {
      console.log(`    │ JSON 键: ${Object.keys(obj).join(', ')}`)
    }
  } catch {
    /* 非 JSON */
  }
  console.log('    └')
}

function probe(url, version) {
  return new Promise((resolve) => {
    const client = mqtt.connect(url, {
      username: USER,
      password: PWD,
      protocolVersion: version,
      connectTimeout: 2500,
      reconnectPeriod: 0,
      clean: true,
    })
    const msgs = []
    let settled = false
    let connected = false

    const finish = (reason) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        client.end(true)
      } catch {
        /* 忽略 */
      }
      results.push({ url, version, reason, count: msgs.length })
      console.log(
        `${msgs.length > 0 ? '[可用]' : '[  --]'} ${url} v${version} → ${reason}` +
        `${msgs.length > 0 ? `（收到 ${msgs.length} 条）` : ''}`,
      )
      resolve()
    }
    const timer = setTimeout(() => finish(connected ? '已连接但 3 秒无消息' : '连接超时'), 6000)

    client.on('connect', () => {
      connected = true
      client.subscribe(TOPIC, { qos: 1 }, (err) => {
        if (err) return finish(`订阅失败: ${err.message}`)
        setTimeout(() => finish('已连接，无消息'), 3000)
      })
    })
    client.on('message', (_t, payload) => {
      msgs.push(decoder.decode(payload))
      if (msgs.length === 1) printPayloadDetail(_t, payload)
      if (msgs.length >= 3) finish('已连接')
    })
    client.on('error', (e) => finish(`错误: ${e.message}`))
  })
}

console.log(`探测 ${HOST}，topic=${TOPIC}，账号=${USER}（矩阵: ${WITH_WSS ? 'ws+wss' : 'ws'} × ${PORTS.join('/')} × ${PATHS.map((p) => p || '(根)').join('/')} × v${VERSIONS.join('/')}）\n`)

const protos = WITH_WSS ? ['ws', 'wss'] : ['ws']
for (const proto of protos) {
  for (const port of PORTS) {
    for (const path of PATHS) {
      for (const version of VERSIONS) {
        await probe(`${proto}://${HOST}:${port}${path}`, version)
      }
    }
  }
}

const usable = results.filter((r) => r.count > 0)
console.log('\n===== 结论 =====')
if (usable.length > 0) {
  console.log(`找到可用端点 ${usable.length} 个，推荐第一个:`)
  console.log(`  ws(s)://${HOST}:${new URL(usable[0].url).port}${new URL(usable[0].url).pathname}`)
  console.log(`  protocolVersion=${usable[0].version}（仪表盘设置里填 主机/端口/路径 即可）`)
} else {
  console.log('未找到可用端点。请确认:')
  console.log('  1. SIoT V2 已启用并监听这些端口（行空板: 长按Home→应用开关→SIoT 启用）')
  console.log('  2. 主机 IP 正确（行空板默认 10.1.2.3）且同一局域网')
  console.log('  3. 账号密码正确（默认 siot/dfrobot）')
  console.log('  4. 若都不行，加 --wss 再试（部分版本走 TLS）')
}
