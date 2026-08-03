# chat_web 设计文档

- 日期：2026-08-03
- 状态：已批准（用户已确认四项决策：ECharts / esbuild+Node 静态服务器 / HTTP 定时轮询 / 多页面+首页导航）

## 目标

一组低耦合的纯静态网页（HTML + CSS + TypeScript），无后端业务逻辑，本地运行。UI 语言：中文。

- **功能 1（聊天页 chat.html）**：调用本地 Ollama（`http://127.0.0.1:11434`）模型进行流式对话。
- **功能 2（仪表盘页 dashboard.html）**：ECharts 数据可视化，数据源为 SIoT v2（DFRobot 本地 MQTT 服务器，默认 `http://127.0.0.1:8080`，账号 `siot`/`dfrobot`），从不同 topic 拉取数据。
- **功能 3（首页 index.html）**：导航入口。

## 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 图表库 | ECharts（npm，`echarts/core` 按需注册） | 类型丰富、中文文档完善、DFRobot 官方面板同款 |
| 构建 | esbuild 多入口 bundle | 快、脚本可控 |
| 服务 | Node 零依赖静态服务器（默认端口 8000） | 页面必须从 http://localhost 打开（Ollama/SIoT CORS 限制），且提供可选 `/siot/`、`/ollama/` 反代兜底 |
| 数据刷新 | 每卡片独立 setTimeout 链轮询 | 简单稳定，请求完成才排下次，天然防重叠 |
| 页面组织 | 多页面 + 首页导航 | 低耦合，页面互不依赖 |

## 外部 API

### Ollama
- `GET /api/tags` → `{"models":[{"name","model","size","modified_at",...}]}`
- `POST /api/chat` `{"model","messages":[{role,content}],"stream":true}` → 流式 NDJSON 裸行 `{"message":{"role","content"},"done":bool}`（防御式解析，兼容 `data:` 前缀）
- 默认放行 `http://localhost:*` / `http://127.0.0.1:*` origin

### SIoT v2
- `GET /messages?topic=<t>&iname=siot&ipwd=dfrobot&pnum=1&psize=N` → `{"code":1,"data":[{"ID","Topic","Content","Created"}]}`
- `GET /lastmessage?topic=<t>&iname=...&ipwd=...` → 最新一条
- `code !== 1` 视为错误

## 文件结构

```
/projects/chat_web/
├── package.json / tsconfig.json / .gitignore
├── scripts/
│   ├── build.ts   # esbuild 三入口 bundle + 拷贝 HTML/CSS；--watch/--serve/--minify
│   └── serve.ts   # 静态服务器 + 可选 /siot/ /ollama/ 反代
├── src/
│   ├── index.html / chat.html / dashboard.html
│   ├── styles/  base.css + index.css / chat.css / dashboard.css
│   ├── lib/     config.ts（常量/直连代理模式/uid）+ types.ts
│   ├── index.ts
│   ├── chat/    sse.ts + ollama.ts + chat.ts
│   └── dashboard/ siot.ts + parse.ts + storage.ts + charts.ts + cards.ts + dashboard.ts
└── dist/        # 构建产物（gitignore）
```

**低耦合约束**：`chat/*` 与 `dashboard/*` 零互相 import；共享仅 `lib/config.ts` 与 `lib/types.ts`。scripts 内禁用 enum/namespace（Node 24 直接运行 TS，type-stripping 限制）。

## 数据解析策略（parseContent）

1. trim 非空且 `Number()` 为有限数 → number（防 `Number('')===0`）
2. `JSON.parse` 成功且为对象 → 取 jsonField（未配置自动探测首个数字字段）→ 数字则 kind=json
3. 其余 → category
4. label：`Created` 解析为时间戳成功 → `MM-DD HH:mm:ss`；失败回退序号
5. 数据按 t 升序；chart 的 x 轴用 label（category 轴）

## 图表类型

line / area / bar / pie / gauge / scatter。gauge 取末值、max 自适应（1.2× 向上取整）；pie 按 category 频次聚合；数值类图表遇 category 数据（或反之）显示空态，不渲染假数据。

## 轮询机制

- 每卡片独立 setTimeout 链；refreshMs=0 不自动刷新
- 卡片错误：保留旧图 + 错误横幅，下周期自动恢复
- `document.hidden` 全网格暂停，恢复可见立即刷新
- 删除卡片 → stop() 清理定时器与图表实例

## 配置持久化

- localStorage key：`chatweb.cards.v1`（卡片配置）、`chatweb.settings.v1`（SIoT 地址/账号/直连代理模式）
- 版本化 key、JSON try/catch、字段级补默认

## 设置与代理

- 设置面板：SIoT 地址、账号密码、直连/代理切换；Ollama 地址 + 直连/代理切换
- 默认直连；切换模式后全网格立即刷新

## 工具脚本

- `npm run dev`：构建 + watch + 起服务（端口 8000）
- `npm run build`：一次性构建（--minify 可压缩）
- `node scripts/serve.ts [--port N] [--siot-proxy] [--ollama-proxy]`

## 实现约束（用户要求）

- kimi code 可用时由 kimi 编写前端代码；不可用时先完成基建（工具脚本/后端部分），再自行编写前端
- kimi code 每单元 600 秒超时，超时未完成 → cancel_delegation 终止 → 自行补写

## 验证

1. `npm run dev` 三个页面正常打开
2. 离线错误态（Ollama/SIoT 未启动）：聊天页错误横幅、仪表盘卡片错误态，不崩溃
3. Ollama 运行后：模型列表、流式输出、停止生成、多轮上下文
4. SIoT 运行后：topic 数据图表渲染、轮询更新、配置持久化
