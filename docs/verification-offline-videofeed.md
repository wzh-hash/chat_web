# 验证报告：离线可用性 + 实时图传

日期：2026-08-14
验证方式：Hermes 静态审计（并行子代理）+ 主代理运行时网络监控 + 沙箱模拟全链路

## 验证 1：完全离线可用性（严格标准）

### 静态审计（Hermes，源码层 + dist 产物层 + 依赖层）

- 所有 `<link href>`（7 处）/ `<script src>`（3 处）均为相对路径 `assets/*`
- CSS 零 `@import`、零 `url(http)`、零 `@font-face`；字体为系统字体栈
- 依赖仅 echarts/mqtt，经 esbuild `bundle:true` 静态打包进 dist，无 CDN
- 未发现 favicon 外链 / manifest / analytics / iframe / 图片外链
- 全部 `fetch`/`WebSocket` 目标由 `ollamaBase()`/`siotWsUrl()` 生成，默认本地回环/局域网
- dist 内仅剩第三方库许可证注释（无害，不触发请求）

### 运行时网络监控（无头浏览器，不启动任何本地服务=断网模拟）

- 三页面加载全量请求监控：**零外部请求**（仅 localhost:8000 同源 + 本地 Ollama 探测）
- 无 JS 错误（仅预期的离线连接错误，已过滤）
- 三页面骨架完整渲染，状态灯正确显示离线/错误提示

### 结论

**该网站不存在任何外网/CDN 依赖，完全断网可用。** 唯一需要的是本地服务：
Ollama（127.0.0.1:11434）与 SIoT（局域网 MQTT broker）——均属本机/局域网，非外网。

## 验证 2：实时图传全链路（沙箱模拟，不等硬件）

### 方法

- 生成真实 PNG 测试帧（200×150，两帧交替）→ base64
- 本地 mock SIoT broker（aedes，ws://127.0.0.1:1888/ws）以 ~1fps 发布 JSON 包裹消息
  （`{Topic, Content: base64, Created}`，验证 JSON 包裹解析 + data: 前缀自动补全）
- 无头浏览器注入图传卡订阅 test/cam

### 结果

| 检查项 | 结果 |
|---|---|
| 图片渲染：`data:image/jpeg;base64,` 前缀 + `naturalWidth>0`（真实解码） | ✅ 200×150 |
| 等待占位在有帧后隐藏 | ✅（修复了发现的 bug） |
| 帧时间戳"最新帧 MM-DD HH:MM:SS"（Created 解析） | ✅ |
| 帧实时更新（交替帧 src 变化） | ✅ |
| 10+ 帧连续推送：无崩溃、无页面错误、解码正常 | ✅ |

### 验证中修复的 bug

- **图传占位未隐藏**：首帧到达后 `.image-placeholder` 仍显示（图片与占位同框）。
  修复：`flushImage` 有帧时隐藏占位、无帧时恢复；`clearBuffer` 同步恢复占位。

## 结论

- 离线可用：✅ 严格通过（静态+运行时双保险，零外网依赖）
- 实时图传：✅ 全链路通过（渲染/更新/时间戳/稳定性），硬件就绪后仅需按 topic 接入即可
