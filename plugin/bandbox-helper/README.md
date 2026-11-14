# BandBox辅助（AstroBox 插件）

手机端 AstroBox 插件：选一个 `.lrc` 文件 → 自动识别并剥离时间轴与元数据标签、
还原成**逐行纯文本** → 通过 BLE `interconnect` 推送到手环上的 BandBox 歌词本。

支持三种常见歌词格式：逐行 LRC、常规逐字 LRC（行内 `[mm:ss.xx]`）、
增强逐字 LRC（ESLyric 的 `<mm:ss.xx>` 标签）。

- 版本：`0.3.3`（0.3.2 新增「二维码」Tab：粘贴扫码文本下发收藏；0.3.3 修复链路健壮性：timer 事件双形态兼容、心跳错误残留清理、saved 设备回退时的 catch-all 注册、手环侧 send 断连自愈）
- API Level：**4**（`wasi_version: 3`）
- 目标快应用包名：`com.miband.bandbox`（手环端 BandBox）
- 协议：本仓库自定义的 `bandbox-lyrics`，与手环端 `src/utils/lyricsTransfer.js` 一一对应
- 语言：JavaScript（不需要 Rust 工具链）

## 目录

```
bandbox-helper/
├── package.json          依赖 componentize-qjs（预编译原生二进制）
├── manifest.json         AstroBox 插件清单
├── icon.png              216×216 图标
├── wit/                  AstroBox 插件 WIT（npm run wit 拉取）
├── world/
│   └── bandbox.wit       本地最小 world（只导入实际用到的宿主接口）
├── src/
│   ├── plugin.js         入口：导出 lifecycle / event 接口对象
│   ├── actions.js        UI 动作解析（兼容 eventId / eventPayload 两种宿主形态）
│   ├── lrc.js            LRC 解析（逐行/逐字/增强逐字，纯函数）
│   ├── gbk-table.js      GBK 映射表（由 scripts/gen-gbk-table.mjs 生成）
│   ├── protocol.js       歌词协议消息构造与解析（信封解包同时放行 bandbox-otp 裸消息）
│   ├── otp.js            OTP 内核（与手表端 src/utils/otp.js 逐字一致，SHA-256 校验）
│   ├── otpAccounts.js    账户模型 / otpauth:// 解析（与手表端逐字一致）
│   ├── otpProtocol.js    bandbox-otp 协议（常量与行为和手表端一致）
│   ├── otpSync.js        三态同步模型（baseline / local / deletedIds）
│   ├── device.js         设备选择
│   └── ui.js             声明式 UI（双 Tab：歌词同步 / 动态口令）
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
npm test             # 74 项单测
npm run package      # 产出 dist/plugin.wasm + dist/BandBox辅助.abp
```

`npm install` 会按当前平台自动装对应的原生包
（Linux x64/arm64、macOS x64/arm64、Windows x64），无需手工挑版本。

把 `dist/BandBox辅助.abp` 装到手机上的 AstroBox 里即可。
`.abp` 是标准 deflate zip（带合法 DOS 时间戳），可直接用系统解压工具查看内容。

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
- 只导入实际使用的 7 个 `astrobox:psys-host-v4/*` 接口与 WASI，**没有 `local:` 导入**，宿主可满足
- 导出 `astrobox:psys-plugin-v4/lifecycle` 与 `astrobox:psys-plugin-v4/event`（外加一个无害的 `init`）

> `componentize-qjs` 用 QuickJS 而非 SpiderMonkey，JS 运行时不同，但组件 ABI
> （导入/导出签名）完全按 WIT 生成，宿主侧无感知。

### 为什么用自定义最小 world

上游 `AstroBox-Plugin-WIT` 的 `psys-world-v4` 声明了完整宿主接口面，其中
`astrobox:psys-host-v4/canopusconnect` 在当前 AstroBox 宿主里还没有实现。
`componentize-qjs` 会把 world 里的**所有 import** 都编进组件，即使 JS 从未调用，
安装时就会在链接阶段失败：

```
Failed to link plugin component for api_level=4. detail:
component imports instance `astrobox:psys-host-v4/canopusconnect`,
but a matching implementation was not found in the linker
```

因此 `world/bandbox.wit` 定义了只包含实际用到的 7 个接口的 `bandbox-world-v4`。
`scripts/build.mjs` 构建时把 `wit/`（上游，`npm run wit` 会重新拉取）与 `world/`
（本地，入库）合并到临时目录再交给 `componentize-qjs`。
`test/world.test.mjs` 会检查 world 的 import 与 `src/` 里的宿主 import 是否一致。

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

## ⚠️ 宿主接口必须 await（0.2.5 修掉的根因）

Level 4 的宿主接口几乎全是 `async func`。按 `componentize-qjs` 的类型映射：

| WIT 类型 | JS 侧表现 |
|---|---|
| `async func` | 返回 **Promise**，必须 `await` 才有值 |
| 顶层 `result<T, E>` | 成功返回 `T`，失败**抛错**（reject） |
| `option<T>` | `T \| null`，`null` 表示 none |
| `list<T>` / `record` | `Array` / camelCase 对象 |

漏掉 `await` 不会报错，只会静默拿到 Promise 对象：

```js
const connected = getConnectedDeviceList() || []   // ❌ connected 是 Promise
                                                  //    connected.length === undefined
                                                  //    → 设备列表恒为空 → 心跳发不出去
                                                  //    → 手环永远「未连接手机」

const picked = pickFile(cfg, filter)               // ❌ Promise 没人 await
                                                  //    → 宿主的取文件任务被取消
                                                  //    → 点「选择 LRC 文件」不弹选择器
```

**正确写法**：所有宿主调用统一走 `hostCall()`，它负责 await 并把「失败抛错」
转成 `{ ok: false, error }`：

```js
const res = await hostCall('pickFile', () =>
  pickFile(
    { read: true, copyTo: null },          // option<string> 用 null 表示 none
    { multiple: false, extensions: ['lrc'], defaultDirectory: '', defaultFileName: '' }
  )
)
if (!res.ok) { /* res.error 是宿主给的失败原因 */ }
```

`test/host-async.test.mjs` 会静态扫描 `src/*.js`，确保每个 `async` 宿主接口调用
都被 `await` 或包在 `hostCall()` 里，防止再写回同步调用。

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
| 手环→手机 | `ping` | `{id}` 手环主动探活手机插件 |
| 手机→手环 | `pong` | `{id}` 回复手环 `ping` / `ready` |
| 手环→手机 | `pong` | `{id}` 回复手机 `hello` / `ping` |
| 手环→手机 | `ack` | `{id, ok:true, name}` 落盘成功（`name` = 实际文件名） |
| 手环→手机 | `err` | `{id, reason}` 失败原因 |
| 手环→手机 | `ready` | `{id?}` 手环进入接收页时主动上报 |
| 手环→手机 | `progress` | `{id, received, total}` 分片进度 |

### 连接状态与宿主信封

- 手环进入「从手机传输」页后发 `ready` + `ping`；插件收到后回 `pong`。
- 同时插件每 5 秒主动向已连接手环发一次 `hello` 心跳。手环收到 `hello` / `pong` 或任何合法
  协议消息即显示「已连接手机」。部分固件/签名组合下手环→手机方向会直接失败，
  因此连接状态以**手机→手环心跳**为准，手环的 `ping` 只做兼容与补充。
- 手环不再依赖 Vela 的 `getReadyState`（AstroBox 不是官方配套 App，该状态在 AstroBox 场景下不可靠）。
- 插件在 `onUiRender` 和 `device-action` 时会刷新设备并注册
  `registerInterconnectRecv(addr, "com.miband.bandbox")`，因此即使还没有点过发送，也能收到手环的
  `ready` / `ping`。
- 宿主会把 `interconnect-message` 包装成
  `{ "addr": "...", "pkgName": "...", "payloadText": "...", "payloadHex": "..." }`；
  `protocol.unwrapInterconnectPayload()` 会先解包，再交给 `decode()`。旧宿主直接传裸协议 JSON 时也能工作。
- 宿主的 `timer` 事件 payload 有两种形态：JSON 信封 `{ timerId, kind, payload }`（旧宿主实测）与
  payload 原文直投（WIT 语义）。`protocol.unwrapTimerPayload()` 两种都能解；0.3.2 及更早只认信封，
  宿主改直投后心跳会在首发后停发、ACK 超时失效。

单条 JSON 超过 **12 KB**（按 UTF-8 字节计）就按行切块（不切断一行），逐片顺序发送；
手环端全部收齐后一次性落盘为「首行标题 + 其余正文」。

分片按 **UTF-8 字节**计量（中文 3 字节/字，并计入 JSON 转义开销），单片正文预算 =
12 KB − 外层消息预留 256 B − 标题字节；单行正文超预算的文件（手环端切不开、
会破坏「不切断一行」约定）会在插件解析阶段被直接拒绝导入。

错误原因：`bad-json` / `not-armed` / `write-failed` / `bad-seq` / `version` / `bad-app` / `bad-type` / `empty`。

## 动态口令协议（bandbox-otp）

0.3.0 起，同一个插件、同一条 `registerInterconnectRecv(addr, "com.miband.bandbox")` 通道同时承载
歌词协议与动态口令协议：`handleReply` 按 `app` 字段分流（歌词 `bandbox-lyrics`，口令
`bandbox-otp`），`protocol.unwrapInterconnectPayload` 对两种裸消息都直接放行。
`hello` 心跳在每次设备遍历里多发一条 `bandbox-otp` 的 hello（带手机 Unix 秒，手表用于偏差提示），
不新建第二个心跳 timer；OTP 的 ACK 超时用独立 `otpTimer` 与 `otp-ack:<id>` payload 前缀，
与歌词的 `pendingId` 互不串扰。

| 方向 | type | 载荷 |
|---|---|---|
| 手机→手环 | `hello` | `{id, time}` 心跳 + 手机时间 |
| 手机→手环 | `list_accounts` | `{id}` 拉全量 |
| 手机→手环 | `sync_delta` | `{id, upsert[], remove[]}` 增量（超 12KB 按单账户条目分片） |
| 手机→手环 | `set_offset` | `{id, offset}` 时间偏移（秒，快了为负） |
| 手机→手环 | `chunk` | `{id, seq, total, kind, field, data}` |
| 手环→手机 | `ready` / `pong` | `{accountsCount, timeOffsetSec, time, id?}` |
| 手环→手机 | `accounts` | `{id, accounts[]}` 全量应答（账户多时也分片） |
| 手环→手机 | `ack` / `err` / `progress` | `{id, ok?/reason/received,total}` |

account 字段与 otpauth:// 数据格式同两类参考实现（MIT）：`{id, name, issuer, secret, type,
algorithm, digits, period, counter, createdAt, counterModifiedAt, extraParams}`；
M1 固定 `totp/SHA1/6/30`，字段全保留以便后续扩展。同步是三态模型：拉取重建 baseline →
本地编辑写 local/deletedIds → 「保存修改」二次确认后 `getSyncDelta` 增量下发 → ack 后推进
baseline；回执丢失时 local 保留可重试。单账户超预算（too-large）在解析期拒绝。

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
9. 安卓文件选择器可能只返回 content URI 片段（没有真实文件名）：歌名优先用 `[ti:]`，
   没有 `[ti:]` 时回退到首行歌词，避免把 `audio%3A...` 当成歌名

## 真机验收清单

模拟器没有 BLE、也装不了 AstroBox，这条链路只能真机跑。逐项确认：

- [ ] 插件安装并加载成功，插件页 UI 正常显示（设备名、状态区、预览区）
- [ ] 手机点「选择 LRC 文件」→ 系统文件选择器正常弹出（手机端事件 id 兼容）
- [ ] 手环连上 AstroBox 后打开「从手机传输」→ 10 秒内从「检测中」变「已连接手机」
- [ ] 关闭插件 / 断开手环 → 25 秒内变「未连接手机」并显示具体提示
- [ ] 选一个真实 `.lrc` → 预览显示歌名 / 行数 / 前若干行，时间轴已剥离
- [ ] 逐行 / 常规逐字 / 增强逐字（ESLyric）三种 LRC 各选一个 → 预览与手环正文都不含
      `[mm:ss]` / `<mm:ss>` 时间标签，三种格式的正文一致
- [ ] 手环停在「从手机传输」页 → 手机点「发送到手环」→ 手环 Toast「已接收：<歌名>」并落盘
- [ ] 插件显示「已发送」，歌词本里出现该条目，标题与正文正确
- [ ] 手环不在该页面时发送 → 插件 20 秒内提示「手环未响应」，手环侧不产生脏数据
- [ ] 断连蓝牙 → 插件给出明确错误；重连后重发成功
- [ ] 中文 GBK 编码的 LRC 正常显示
- [ ] > 12 KB 的长歌词走分片，最终完整落盘
- [ ] 含超长单行的 LRC 被拒绝导入，提示「歌词文件存在异常（单行过长）…导入失败」，
      且不出现「发送到手环」按钮
- [ ] 多设备同时连接时，插件能选择目标手环

动态口令 Tab（0.3.0 新增，与歌词互不干扰）：

- [ ] 插件顶部两个 Tab 可切换，歌词功能全回归正常（发歌词不误改 OTP 账户）
- [ ] 「拉取数据」5 秒内回显账户数；0 / 1 / 20 条各验一次
- [ ] 批量粘贴 3 条 otpauth://（含 `\/`、`&amp;`、大小写参数、issuer 前缀）→ 二次确认 →
      手环列表出现且验证码正确；手表与手机同一账户同一时刻显示相同验证码
- [ ] 编辑一条 → 下发只含 1 条 upsert；删除一条 → 两端一致消失
- [ ] ≥60 个账户触发分片，逐片 progress、收齐一次性落盘，无乱码缺条
- [ ] 杀插件后重发 → 提示「未收到手环确认」且本地修改保留可重试
- [ ] 手表钟快 90 秒 → 插件提示偏差 → 一键校时后双端验证码恢复一致
- [ ] 账户密钥明文存储风险已在 UI 与 README 提示；「批量导出」能导出 otpauth 多行文本

## 排障

| 现象 | 排查 |
|---|---|
| 心跳/歌词/口令全都不通，但 AstroBox 已连手环、权限已给齐 | 按诊断卡逐段定位：① `插件：` 行——0.3.1 及更早的目标包是 `com.miband.box`（改名前），手环端已是 `com.miband.bandbox` 时整条链路必断，重装 0.3.2+ 的 abp；② `设备：` 行——0 个（saved）时是 `get-connected-device-list` 没返回运行中设备（权限/设备实体问题）；③ `心跳：` 行——轮数不涨 = 宿主 timer 事件没进来；④ `收到：` 行——恒为 0 = 手环→手机方向没有事件到达（注册地址/权限问题）；⑤ `宿主：` 行——`sendQaicMessage ✗ …` 的错误原文即发送失败原因。0.1.0 起包名由 `com.miband.box` 更名而来，真机换包按官方要求**先按名卸载旧包再装新包**，装完重启一次 AstroBox 让设备资源缓存刷新 |
| 手环一直「未连接手机」且日志无发送错误 | 看诊断卡 `宿主：` 行；0.3.3 起心跳错误会在恢复后自动清除，若仍显示「心跳发送失败：…」即当前确实发不出去 |
| 插件加载失败 | 宿主 AstroBox 版本要支持 API Level 4 |
| 安装失败，日志含 `canopusconnect` | 用了上游完整 world，改用 `world/bandbox.wit` 构建 |
| 手机点「选择 LRC 文件」没反应 | 0.2.5 起所有宿主调用都 `await` 了；若仍不弹，点插件页「诊断」，把 `宿主：` / `选择：` 两行发来（`宿主：pickFile → …` 能直接区分是宿主没返回还是插件没接住） |
| 诊断卡显示「平台：[object Promise]」 | 0.2.4 的症状：宿主调用没 `await`。装 0.2.5 即可 |
| 手环提示「互传通道未就绪」 | 0.2.4 起不再直接判死：插件每 5 秒发 `hello` 心跳，手环收到即显示已连接；若仍失败，检查插件是否已加载、`interconnect` 权限是否已授予 |
| 手机插件不显示「在线」 | 看诊断卡 `手环：` 行；确认设备列表非空、`interconnect` 权限已授予、手环端 BandBox 已安装 |
| 手环一直显示「未连接手机」 | 手环是否停在「从手机传输」页；AstroBox 是否已连接手环；插件是否已加载；「诊断码」可用于区分蓝牙/插件问题。0.2.4 及更早版本因设备列表恒为空而永远发不出心跳，须升级到 0.2.5 |
| 插件一直显示「手环未响应」 | 确认手环停在接收页；插件已解宿主信封并处理 ack，若仍超时请看诊断卡的 `手环：` 行 |
| 收不到手环回执 | 手环是否停在「从手机传输」页；蓝牙是否连着 |
| 中文乱码 | 宿主 TextDecoder 是否带 GBK；否则把 LRC 另存为 UTF-8 |
| 构建报 `not yet implemented` | 用了官方 componentize-js，见上文「为什么用 componentize-qjs」 |
