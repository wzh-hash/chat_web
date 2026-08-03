# chat_web

一组低耦合的纯静态网页（HTML + CSS + TypeScript），**无后端业务逻辑**，本地运行。

- 💬 **聊天页**（`chat.html`）：调用本地 [Ollama](https://ollama.com) 模型流式对话
- 📊 **数据仪表盘**（`dashboard.html`）：基于 [ECharts](https://echarts.apache.org) 可视化 [SIoT v2](https://siot.readthedocs.io) 各 topic 数据
- 🏠 **首页**（`index.html`）：导航入口

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 构建 + 监听 + 启动静态服务器 → http://localhost:8000
```

打开 http://localhost:8000 即可。**注意**：不要用 `file://` 直接打开页面，浏览器跨域限制会导致无法访问 Ollama/SIoT。

其他命令：

| 命令 | 说明 |
|---|---|
| `npm run build` | 一次性构建到 `dist/` |
| `npm run build -- --minify` | 压缩构建 |
| `npm run watch` | 仅监听重建（不起服务器） |
| `npm run serve` | 仅启动静态服务器 |
| `node scripts/serve.ts --siot-proxy --ollama-proxy` | 服务器并开启 SIoT/Ollama 反代 |

## 前置服务

1. **Ollama**：默认 `http://127.0.0.1:11434`，`ollama pull <模型名>` 安装模型后即可在聊天页选择。
2. **SIoT v2**：默认 `http://127.0.0.1:8080`，账号 `siot` / `dfrobot`。数据通过 `/messages` API 拉取（轮询）。

两个页面顶部的 ⚙ 设置均可修改地址、账号，以及连接方式：

- **直连**：浏览器直接请求上游（Ollama 支持 localhost 跨域；SIoT 视版本而定）
- **代理**：经本地静态服务器的 `/ollama`、`/siot` 同源代理（上游不在 `localhost` 时或遇到 CORS 问题时可选用）

## 开发

```
src/
├── index.html / chat.html / dashboard.html   # 三个独立页面
├── styles/   base.css(共享) + 各页专属 CSS
├── lib/      config.ts(共享配置/直连代理模式) + types.ts
├── chat/     sse.ts(流式解析) + ollama.ts(客户端) + chat.ts(控制器)
└── dashboard/ siot.ts(客户端) + parse.ts(数据解析) + storage.ts(配置持久化)
              + charts.ts(ECharts) + cards.ts(卡片控制器) + dashboard.ts(控制器)
```

- `chat/*` 与 `dashboard/*` **零互相依赖**，共享的只有 `lib/`
- TypeScript 经 esbuild 编译为独立 bundle（`dist/assets/*.js`），HTML/CSS 直接拷贝
- 类型检查：`npx tsc --noEmit`
