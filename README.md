# chat_web

一组低耦合的纯静态网页（HTML + CSS + TypeScript），**无后端业务逻辑**，本地运行。

- 💬 **聊天页**（`chat.html`）：调用本地 [Ollama](https://ollama.com) 模型流式对话
- 📊 **数据仪表盘**（`dashboard.html`）：基于 [ECharts](https://echarts.apache.org) 实时可视化 [SIoT V2](https://siot.readthedocs.io) 各 topic 数据（MQTT 订阅）
- 🏠 **首页**（`index.html`）：导航入口

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 构建 + 监听 + 启动静态服务器 → http://localhost:8000
```

打开 http://localhost:8000 即可。**注意**：不要用 `file://` 直接打开页面，浏览器跨域限制会导致无法访问 Ollama。

其他命令：

| 命令 | 说明 |
|---|---|
| `npm run build` | 一次性构建到 `dist/` |
| `npm run build -- --minify` | 压缩构建 |
| `npm run watch` | 仅监听重建（不起服务器） |
| `npm run serve` | 仅启动静态服务器（含 `/ollama` 代理） |
| `node scripts/probe-mqtt.mjs <主机IP> <topic>` | 探测 SIoT V2 的 MQTT 连接参数 |
| `node scripts/probe-mqtt-selftest.mjs <主机IP>` | 发布→订阅回环自测（验证历史回放） |

## 前置服务

1. **Ollama**：默认 `http://127.0.0.1:11434`，`ollama pull <模型名>` 安装模型后即可在聊天页选择。聊天页 ⚙ 可改地址/切换同源代理。
2. **SIoT V2**：仪表盘通过 **MQTT over WebSocket** 订阅 topic 实时获取数据（订阅后收到的消息实时入图）。推荐部署在**行空板 M10**（官方支持，长按 Home → 应用开关 → 启用 SIoT；默认 IP `10.1.2.3`），也可在 Windows 运行。

## 仪表盘使用

1. 顶部连接状态显示 MQTT 连接情况；⚙ 设置里填 SIoT 的 **主机/WebSocket端口（默认 1888）/路径/账号密码**（默认 `siot`/`dfrobot`）
2. 连接参数不确定时，先用探测脚本确认：
   ```bash
   node scripts/probe-mqtt.mjs 10.1.2.3 xzr/001
   ```
   脚本会尝试 1884/1888 × 路径 × 协议版本的组合，找到可用端点并打印消息格式
3. 「+ 添加图表」→ 选图表类型、填 topic（如 `xzr/001`）→ 保存即开始实时接收
4. 图表数据在**订阅之后**累积（若 SIoT 订阅时回放历史则包含历史）；数值/JSON/分类数据自动识别，JSON 可选字段

## WSL 环境（服务在 Windows 上）

- 页面正常打开（WSL2 自动转发 localhost 端口）
- **聊天页**：保持**直连**（浏览器在 Windows 上直达 Windows 的 Ollama）
- **仪表盘**：连行空板/局域网内的 SIoT 直接用其 IP；若连 Windows 本机 SIoT，需确认其 WebSocket 端口对外监听（`netstat -ano | findstr 1888`），并在 ⚙ 里填 Windows 主机 IP（WSL 的 `127.0.0.1` 是 WSL 自己）

## 开发

```
src/
├── index.html / chat.html / dashboard.html   # 三个独立页面
├── styles/   base.css(共享) + 各页专属 CSS
├── lib/      config.ts(共享配置/settings v2 迁移) + types.ts
├── chat/     sse.ts(流式解析) + ollama.ts(客户端) + chat.ts(控制器)
└── dashboard/ mqtt.ts(MQTT订阅客户端) + parse.ts(数据解析) + storage.ts(配置持久化)
              + charts.ts(ECharts) + cards.ts(卡片控制器) + dashboard.ts(控制器)
```

- `chat/*` 与 `dashboard/*` **零互相依赖**，共享的只有 `lib/`
- TypeScript 经 esbuild 编译为独立 bundle（`dist/assets/*.js`），HTML/CSS 直接拷贝
- 类型检查：`npx tsc --noEmit`
- `src/dashboard/mqtt.ts` 单例共享连接，卡片按 topic 引用计数订阅，自动重连、传输层去重
