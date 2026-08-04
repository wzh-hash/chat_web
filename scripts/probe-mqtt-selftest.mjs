#!/usr/bin/env node
/**
 * probe-mqtt-selftest.mjs — 验证 SIoT V2 MQTT-WebSocket 的完整消息链路
 *
 * 用法: node scripts/probe-mqtt-selftest.mjs [主机IP] [账号] [密码]
 *
 * 步骤:
 *  1. 连接 ws://<host>:1888，用 QoS1 发布一条测试消息到 chatweb/probe
 *  2. 同连接订阅 chatweb/probe，验证实时送达
 *  3. 断开后用全新连接订阅 chatweb/probe，验证历史消息是否回放（决定仪表盘能否拿到历史数据）
 */
import mqtt from 'mqtt'

const HOST = process.argv[2] ?? '172.31.0.1'
const USER = process.argv[3] ?? 'siot'
const PWD = process.argv[4] ?? 'dfrobot'
const TOPIC = 'chatweb/probe'
const PORT = 1888
const PATH = '/ws' // 行空板 SIoT V2 实测端点路径

const opts = {
  username: USER,
  password: PWD,
  protocolVersion: 4,
  connectTimeout: 6000,
  reconnectPeriod: 0,
  clean: true,
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function connect(prefix) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(`ws://${HOST}:${PORT}${PATH}`, opts)
    client.on('connect', () => {
      console.log(`${prefix} 连接成功`)
      resolve(client)
    })
    client.on('error', (e) => {
      console.log(`${prefix} 错误: ${e.message}`)
      reject(e)
    })
  })
}

function printPayloadDetail(topic, payload) {
  const raw = new TextDecoder().decode(payload)
  console.log(`   topic=${topic} | utf8: ${raw.slice(0, 120)}`)
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') {
      console.log(`   JSON 键: ${Object.keys(obj).join(', ')}`)
    }
  } catch {
    /* 非 JSON */
  }
}

// --- 第 1/2 步: 发布 + 同连接订阅收实时 ---
console.log(`== 发布测试消息到 ${TOPIC} (QoS1) ==`)
const pubClient = await connect('[发布]')
await new Promise((resolve) =>
  pubClient.publish(TOPIC, `hello-${Date.now()}`, { qos: 1 }, resolve),
)
console.log('[发布] 已发送，等待 2 秒…')
await new Promise((resolve) => {
  pubClient.subscribe(TOPIC, { qos: 1 }, () => {
    let got = false
    const t = setTimeout(() => {
      console.log(got ? '[发布] 实时收到 ✓' : '[发布] 实时未收到（异常）')
      resolve()
    }, 2000)
    pubClient.on('message', (_t, payload) => {
      got = true
      console.log('[发布] 实时收到:')
      printPayloadDetail(_t, payload)
      clearTimeout(t)
      resolve()
    })
  })
})
pubClient.end(true)
await wait(500)

// --- 第 3 步: 全新连接订阅，验证历史回放 ---
console.log(`== 全新连接订阅 ${TOPIC}，验证历史回放 ==`)
const subClient = await connect('[回放]')
await new Promise((resolve) => {
  subClient.subscribe(TOPIC, { qos: 1 }, () => {
    console.log('[回放] 已订阅，等待 4 秒…')
    const msgs = []
    const t = setTimeout(() => {
      console.log(
        msgs.length > 0
          ? `[回放] 收到历史 ${msgs.length} 条（订阅会回放已保存消息）✓`
          : '[回放] 未收到任何历史消息（订阅不回放，仅实时）',
      )
      resolve()
    }, 4000)
    subClient.on('message', (_t, payload) => {
      msgs.push(payload.toString())
      console.log(`[回放] 收到: ${payload.toString().slice(0, 120)}`)
    })
  })
})
subClient.end(true)
console.log('自测完成')
