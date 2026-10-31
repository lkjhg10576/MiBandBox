# BandBox歌词同步（AstroBox 插件）

手机端 AstroBox 插件：选一个 `.lrc` 文件 → 自动识别并剥离时间轴与元数据标签、
还原成**逐行纯文本** → 通过 BLE `interconnect` 推送到手环上的 BandBox 歌词本。

支持三种常见歌词格式：逐行 LRC、常规逐字 LRC（行内 `[mm:ss.xx]`）、
增强逐字 LRC（ESLyric 的 `<mm:ss.xx>` 标签）。

- API Level：**4**（`wasi_version: 3`）
- 目标快应用包名：`com.miband.box`（手环端 BandBox）
- 协议：本仓库自定义的 `bandbox-lyrics`，与手环端 `src/utils/lyricsTransfer.js` 一一对应
- 语言：JavaScript（不需要 Rust 工具链）

## 目录

```
bandbox-lyrics-sync/
├── package.json          依赖 componentize-qjs（预编译原生二进制）
├── manifest.json         AstroBox 插件清单
├── icon.png              216×216 图标
├── wit/                  AstroBox 插件 WIT（npm run wit 拉取）
├── src/
│   ├── plugin.js         入口：导出 lifecycle / event 接口对象
│   ├── lrc.js            LRC 解析（逐行/逐字/增强逐字，纯函数）
│   ├── gbk-table.js      GBK 映射表（由 scripts/gen-gbk-table.mjs 生成）
│   ├── protocol.js       消息构造与解析
│   ├── device.js         设备选择
│   └── ui.js             声明式 UI
├── scripts/
│   ├── build.mjs         componentize → dist/plugin.wasm → dist/*.abp
│   ├── fetch-wit.mjs     拉取 WIT
│   ├── gen-gbk-table.mjs 生成 GBK 映射表
│   └── gen-icon.py       生成图标
└── test/                 node:test 单测
```

## 构建

```bash
npm install          # 装 componentize-qjs（预编译二进制，约 56 MB，无需 Rust）
npm run wit          # 拉取 AstroBox 插件 WIT 到 wit/
npm run gbk          # 重新生成 src/gbk-table.js（仅修改生成逻辑时需要）
npm test             # 50 项单测
npm run package      # 产出 dist/plugin.wasm + dist/BandBox歌词同步.abp
```

`npm install` 会按当前平台自动装对应的原生包
（Linux x64/arm64、macOS x64/arm64、Windows x64），无需手工挑版本。

把 `dist/BandBox歌词同步.abp` 装到手机上的 AstroBox 里即可。

### 为什么用 componentize-qjs 而不是官方的 componentize-js

官方 `@bytecodealliance/componentize-js@0.23.0` **构建不了 API Level 4**：
它的 splicer 对 `async func` 导入还没实现，构建 `psys-world-v4` 时直接 panic：

```
thread '<unnamed>' (1) panicked at crates/spidermonkey-embedding-splicer/src/bindgen.rs:721:48:
not yet implemented
```

v4 的宿主接口（`dialog.pick-file`、`interconnect.send-qaic-message` …）全是 `async func`，
所以这条路径走不通。AstroBox 官方给的解法是打补丁的 ComponentizeJS 分支
（`AstralSightStudios/ComponentizeJS@astrobox/async-func-support`），但那需要本机装 Rust
现场编译 splicer，与「不装 Rust」的要求冲突。

这里改用 `@di-framework/componentize-qjs`（wasmtime 48 分支）：预编译原生二进制、零 Rust，
并且能正确 stub `async func` 导入。实测产物：

- `plugin.wasm` 约 2.99 MB
- 导入只含 `astrobox:psys-host-v4/*` 与 WASI，**没有 `local:` 导入**，宿主可满足
- 导出 `astrobox:psys-plugin-v4/lifecycle` 与 `astrobox:psys-plugin-v4/event`（外加一个无害的 `init`）

> `componentize-qjs` 用 QuickJS 而非 SpiderMonkey，JS 运行时不同，但组件 ABI
> （导入/导出签名）完全按 WIT 生成，宿主侧无感知。

## 运行时限制（QuickJS）

QuickJS **不是**浏览器/Node，下面这些 API 都不存在：

| 缺失 | 替代方案 |
|---|---|
| `console` | 不要打日志；错误写进 UI 状态 |
| `TextDecoder` | `src/lrc.js` 自带的 UTF-8 解码 + `src/gbk-table.js` |
| `setTimeout` / `clearTimeout` | 宿主 `astrobox:psys-host-v4/timer` 的 `setTimeout` / `clearTimer`，到期从 `onEvent('timer', …)` 回来 |

另外，API Level 4 的导出是 `async func`，**JS 侧必须导出接口对象，且方法必须是 `async`**：

```js
export const lifecycle = {
  async onLoad() {}
}

export const event = {
  async onEvent(eventType, eventPayload) { return '' },
  async onUiEvent(elementId, event, payload) { return '' },
  async onUiRender(elementId) {},
  async onCardRender(cardId) {}
}
```

顶层 `export function onLoad()`、或把方法写成同步函数，都会让宿主的 `on-load` 调用
直接 wasm trap，表现为「插件安装失败」且日志里没有任何插件输出。

还有一点：`onLoad` 在安装流程里同步执行，**不要调用需要权限的宿主接口**
（例如 `device.get-connected-device-list`），否则安装阶段会弹权限框甚至卡住安装。
本插件把设备列表放到 `onUiRender` 里取。

## 权限

| 权限 | 用途 |
|---|---|
| `device` | `device.get-connected-device-list` 找已连接的手环 |
| `interconnect` | `interconnect.send-qaic-message` 发消息 |
| `register_interconnect_recv` | `register.register-interconnect-recv` 接收手环回执 |

`dialog.pick-file`（选文件）在 v4 文档里没有单独的权限名，先不声明；
若宿主报权限不足，按宿主提示补，不要臆造。

## 协议

所有消息都是 UTF-8 JSON 字符串，公共字段 `app = "bandbox-lyrics"`、`v = 1`、`type`。

| 方向 | type | 载荷 |
|---|---|---|
| 手机→手环 | `hello` | `{id}` 探活 |
| 手机→手环 | `lyrics` | `{id, title, lines[], count, ts}` 单包直发 |
| 手机→手环 | `chunk` | `{id, seq, total, title, data}` 分片 |
| 手环→手机 | `pong` | `{id}` |
| 手环→手机 | `ack` | `{id, ok:true, name}` 落盘成功（`name` = 实际文件名） |
| 手环→手机 | `err` | `{id, reason}` 失败原因 |
| 手环→手机 | `ready` | 手环进入接收页时主动上报 |
| 手环→手机 | `progress` | `{id, received, total}` 分片进度 |

单条 JSON 超过 **12 KB** 就按行切块（不切断一行），逐片顺序发送；
手环端全部收齐后一次性落盘为「首行标题 + 其余正文」。

错误原因：`bad-json` / `not-armed` / `write-failed` / `bad-seq` / `version` / `bad-app` / `bad-type` / `empty`。

## LRC 解析规则

1. 编码：先严格 UTF-8，失败再按 GBK/GB18030 解码（国内 LRC 常见 GBK）；去 BOM
2. 元数据标签（`[ti:]`、`[ar:]`、`[al:]`、`[by:]`、`[length:]`、`[offset:]`）丢弃，
   `[ti:]` 作为标题候选，优先于文件名
3. 只把**行首连续出现**的 `[mm:ss.xx]` / `[mm:ss.xxx]` / `[mm:ss]` 当作行时间标签；
   一行有多个行首时间标签时，展开为多行同文本（保持常规 LRC 的重复行行为）
4. 行首标签之后的所有时间标签都视为逐字时间并剥离，文本按原顺序拼接：
   - 逐行 LRC：`[00:01.00]歌词`
   - 常规逐字 LRC：`[00:01.00]歌[00:01.20]词[00:02.00]`
   - 增强逐字 LRC（ESLyric）：`[00:01.00]<00:01.00>歌<00:01.20>词<00:02.00>`
5. 逐字标签只用于定位文本，不保留时间轴或逐字动画；同一时间戳的多行参照歌词
   （翻译/注释行）按文件顺序全部保留，不去重
6. 行文本去首尾空白、保留行内空格、丢弃空行
7. 结果为 `{title, lines, hasTimestamp, format}`；`lines` 为空即解析失败
8. 没有任何时间标签的纯文本 LRC，按行原样保留

## 真机验收清单

模拟器没有 BLE、也装不了 AstroBox，这条链路只能真机跑。逐项确认：

- [ ] 插件安装并加载成功，插件页 UI 正常显示（设备名、状态区、预览区）
- [ ] 选一个真实 `.lrc` → 预览显示歌名 / 行数 / 前若干行，时间轴已剥离
- [ ] 逐行 / 常规逐字 / 增强逐字（ESLyric）三种 LRC 各选一个 → 预览与手环正文都不含
      `[mm:ss]` / `<mm:ss>` 时间标签，三种格式的正文一致
- [ ] 手环停在「从手机传输」页 → 手机点「发送到手环」→ 手环 Toast「已接收：<歌名>」并落盘
- [ ] 插件显示「已发送」，歌词本里出现该条目，标题与正文正确
- [ ] 手环不在该页面时发送 → 插件 20 秒内提示「手环未响应」，手环侧不产生脏数据
- [ ] 断连蓝牙 → 插件给出明确错误；重连后重发成功
- [ ] 中文 GBK 编码的 LRC 正常显示
- [ ] > 12 KB 的长歌词走分片，最终完整落盘
- [ ] 多设备同时连接时，插件能选择目标手环

## 排障

| 现象 | 排查 |
|---|---|
| 插件加载失败 | 宿主 AstroBox 版本要支持 API Level 4 |
| 收不到手环回执 | 手环是否停在「从手机传输」页；蓝牙是否连着 |
| 提示「对端未安装」 | 手环端 BandBox 未安装或版本过旧 |
| 中文乱码 | 宿主 TextDecoder 是否带 GBK；否则把 LRC 另存为 UTF-8 |
| 构建报 `not yet implemented` | 用了官方 componentize-js，见上文「为什么用 componentize-qjs」 |
