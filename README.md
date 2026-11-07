# BandBox

BandBox 是一个为小米手环 10 / 11（212×520 跑道屏）设计的本地小工具箱，包含 30 个便捷功能。

- 包名：`com.miband.box`
- 版本：0.4.2
- 技术栈：Vela JS 快应用（`.ux`）
- 屏幕：当前仅适配手环设备 212 × 520 跑道屏
- 无联网必需、无收费、无授权、除官方 AstroBox 插件外没有其他依赖
- 可选装 AstroBox 插件，把手上的 LRC 歌词推到手表歌词本，以及使用动态口令功能

## 功能

首页支持双栏网格 / 单栏列表切换（入口：应用列表最后的「设置」→「首页样式」），顶部显示最近的目标日：

| 工具 | 说明 |
|---|---|
| 计算器 | 四则运算、括号、百分号、开方、幂 |
| 笔记本 | 新建 / 编辑 / 重命名 / 二维码分享 / 删除 |
| 荧光棒 | 整屏单色循环，可暂停，最亮常亮 |
| 目标日 | 倒数 / 纪念日，两步式日期选择，本地保存 |
| 日历 | 月视图，点选日期查看农历、周几与 ISO 周数，左右切月 |
| 每日一言 | 1000 条积极短句（原创 + 开源语料筛选），可收藏，随机不重样 |
| 密码生成 | 长度 8–32，字符集可勾选，收藏夹 |
| 答案之书 | 随机答案，淡入展示 |
| 振动器 | 短振 / 长振 / 节奏，间隔可调 |
| 剩余时间 | 本分钟 / 本小时 / 今天 / 本周 / 今年倒计时 + 进度条 |
| 存储空间 | 已用 / 可用 / 总量环图 |
| 木鱼 | 自绘木鱼，今日 / 累计功德，自动敲击，本地保存 |
| 显示测试 | 12 种纯色，检查坏点与色偏 |
| 红光手电 | 红光 / 暖橙 / 白光 / 冷光，亮度拉满，进入即亮屏 |
| 手速测试 | 独立「开始」按钮，5 秒倒计时 + CPS，结算后点屏幕不会误触重开 |
| 今日饮食 | 吃什么 / 喝什么随机 |
| 随机数 | 区间调整 + 滚动抽取 |
| 数字滚动 | 自动递增计数器，间隔可调 |
| 系统信息 | 型号、系统、屏幕、设备标识、存储 |
| 性能测试 | 对象 / 数组 / 数学 / 排序四项参考分 |
| 参考分数 | 机型参考分列表 |
| 史载今日 | 全年 366 天史实条目，可上下滚动看全；当天没有史实时才显示一条小知识兜底 |
| 每日新知 | 每天固定一条科技小知识，跨天自动更换，「换一条」随手读 |
| 记分牌 | 红蓝计分 + 计时器 |
| 摩斯密码 | 文本转电码、自动播放、手动点划 |
| 垃圾分类 | 200+ 物品词表，五分类 |
| 快捷生码 | 文本 / 网址 / WiFi 二维码 |
| 跑马灯 | 文字、字号、速度、颜色；竖屏横向滚动，横屏把内容旋转 90° 后滚动 |
| 歌词本 | 本地歌词、自动滚动、横竖屏，支持「从手机传输」接收手机推送的歌词 |
| 水平仪 | 双轴倾角小圆点 + 十字准星，可校准归零 |
| 动态口令 | TOTP 本地生成 + 倒计时环，手机插件批量导入 / 编辑 / 删除并同步（详见下文） |

## 从手机传输歌词

歌词本首页顶部有一张「从手机传输」卡片，点进去进入接收页：

1. 手机装 AstroBox 插件 **BandBox辅助**（源码在 `plugin/bandbox-helper/`）
2. 手环停在「从手机传输」页面（保持长亮）
3. 手机插件里点「选择 LRC 文件」→ 选一个 `.lrc`
4. 插件自动识别逐行 LRC、常规逐字 LRC、增强逐字 LRC（ESLyric），并自动剥离时间轴与元数据标签、还原成逐行纯文本，点「发送到手环」
5. 手环弹出「已接收：<歌名>」，歌词本里随即出现该条目

连接状态不再依赖 Vela 的 `getReadyState`（AstroBox 不是官方配套 App，该状态不可靠）：
手机插件每 5 秒主动向手环发一次 `hello` 心跳，手环收到即显示「已连接手机」；
手环也会发 `ping` 探活，插件回 `pong`（部分固件下手环→手机方向不可用，因此以手机心跳为准）。
插件在 `onUiRender` / `device-action` 时会注册手环消息接收，所以手环进页面时发出的 `ready`
也能被收到并回复。协议是本仓库自定义的 `bandbox-lyrics`（JSON 字符串，`app`/`v`/`type` 三个公共字段），
手环端实现见 `src/utils/lyricsTransfer.js`，插件端实现见 `plugin/bandbox-helper/src/protocol.js`，
两端各有一套单测。手机端宿主会把 `interconnect-message` 包在
`{addr, pkgName, payloadText, payloadHex}` 信封里，插件会先解包再解析。
传输通道只有 BLE `interconnect` 一条（`system.interconnect`），
没有局域网 HTTP 兜底。长歌词分片按 UTF-8 字节计量（中文 3 字节/字），
单片正文预算 = 12 KB − 256 B 外层预留 − 标题字节；含超长单行的文件会在插件端被拒绝导入。

## 动态口令（TOTP）

「动态口令」是内置第 29 个工具：手表本地生成 TOTP 验证码（M1 支持 TOTP / SHA1 / 6 位 / 30 秒，
字段模型与 otpauth 协议已为 HOTP、SHA256/512、8 位、自定义周期预留），与手机插件共享同一条
`bandbox-lyrics` BLE 通道（协议 `bandbox-otp`，靠 `app` 字段分流，互不干扰）。

**手表端**：列表页实时验证码 + 剩余秒；详情页大字验证码 + 倒计时环；编辑页手输 Base32
（走内置输入法）；设置页可调时间偏移（±300s）并说明明文存储风险；支持 otpauth URI 二维码导出
（可被标准 Authenticator 扫码）。密钥保存在手环本地 KV，写后立即落盘。

**手机插件**：插件顶部新增「动态口令」Tab（与歌词同步同插件、同连接，无双插件注册冲突）：

1. 「拉取数据」从手环读取全部账户
2. 「批量粘贴」粘贴多行 `otpauth://` 文本导入（兼容 `\/`、`&amp;` 转义与 issuer 前缀），或逐条添加/编辑
3. 编辑/删除先写本地三态（baseline / local / deletedIds），点「保存修改」二次确认后按增量下发
4. 增量按单账户条目分片（每片 ≤ 12 KB），手环逐片确认；回执丢失时本地修改保留可重试
5. 检测到手表时间偏差 ≥ 5 秒会提示一键校时（`set_offset`，不改系统时间）

协议消息：`hello / ready / pong / list_accounts / accounts / sync_delta / set_offset /
chunk / ack / err / progress`，两端实现见 `src/utils/otpProtocol.js` 与
`plugin/bandbox-helper/src/otpProtocol.js`（常量与行为一致），算法内核
`otp.js` 双端逐字一致（SHA-256 校验），RFC 4226/6238 向量全量通过。

**安全须知**：密钥以明文存于手环本地文件（Vela 无加密存储 API），请勿把手环当作唯一 2FA
设备；建议在插件「批量导出」中离线备份 otpauth 文本。时间校准只有手动偏移与手机辅助提示，
不做联网校时。与 WhistleO 官方插件/应用互不相通（包名与协议封装不同，仅数据格式兼容）。

## 构建

```bash
npm install
npm run gate           # 发行门禁：只读静态检查，失败即阻断
npm run build          # 开发包：dist/*.debug.*.rpk
npm run build:jsc      # 生成 jsc 字节码，更接近发布包
```

`aiot-toolkit` 已写入 `devDependencies`。如果使用 AIoT-IDE 的内置工具链，也可在 IDE 中直接构建。
`build` / `build:jsc` 的 `pre*` 钩子会先跑门禁，规则见 `tools/release-gate.mjs` 文件头。

发布包需要自己的签名证书（`aiot release`），开发/模拟器验证用 `npm run build` 即可。

## 性能

工具链把每个页面打成独立 bundle，公共模块原本在每个 bundle 里各有一份副本。
现在公共模块统一挂在全局单例上（`src/global.js` + `src/utils/g.js`），
页面只 import shim；各页的 20s 时钟合并成一个全局时钟（`src/utils/clock.js`）。

| 指标 | 优化前 | 优化后 |
|---|---|---|
| rpk 大小 | 966,411 B | **648,685 B**（−32.9%） |
| bundle 原始总量 | 8,712,032 B | 4,618,834 B（−47%） |
| router / file / kv 模块副本 | 59 / 37 / 23 | **1 / 1 / 1** |
| 20s 时钟定时器 | 49 个 | **1 个**（无订阅时自动停） |
| PNG 资源 | 102 张 / 156,869 B | 52 张 / 68,573 B（RGBA，保留抗锯齿边缘） |

包体大小可自行复现：`npm run build:jsc` 后看 `dist/*.rpk` 的大小；
本表其余指标由内部工具链实测，工具链本身不入库。

### 0.4.1 修的是什么

0.4.0 的 PNG8 瘦身用 `tools/pnglib.mjs` 自己拼 PNG，`assemble()` 漏了 IEND 块，
47 张图（含应用图标 `common/icon.png`）都成了「以 IDAT 结尾的截断文件」。
手环开机要解码图标画应用列表，解码器找不到 IEND 就卡死/越界，系统起不来，
连续启动失败后进 Recovery 报「系统异常」，恢复出厂才恢复。模拟器解码器宽容，因此没被发现。

0.4.1 在 `assemble()` 里补 IEND，另附 `tools/png-fix-iend.mjs` 给已有 47 张图就地补
12 字节（不动像素），并在门禁里加了 PNG 完整性检查。

发行前跑 `npm run gate`（`tools/release-gate.mjs`）：PNG 完整性（签名 / CRC / 越界 /
IEND 末块 / PLTE·tRNS 顺序）、`perf` 开关、启动路径打点、`data`/`private` 共存、
路由缺页、版本号不一致，任何一条不过都阻断。`make-release.sh` 与 `build:jsc` 都会先过这道门。

### 0.4.2 改了什么

- **图标恢复清晰**：0.4.0 的 PNG8 瘦身把 UI 小图做了 44×44→28×28 盒式重采样 + 256 色量化，
  非预乘 alpha 让边缘混入透明黑、抖动在抗锯齿边缘撒彩色噪点，真机上笔画发毛、细节糊成一团。
  0.4.2 把 46 张图（首页 30 个图标、应用图标、输入法按键等）全部恢复成原始 RGBA 版本，
  代价是 rpk 613,476 B → 648,685 B（+5.7%）。`tools/png8.mjs` 已注明：**禁止**再对带抗锯齿边缘的
  UI 小图跑 `--convert` / `--resize`。
- **新增「每日新知」**：205 条科技小知识独立成第 30 个工具，进入即显示当天固定一条
  （按日期稳定散列，跨天自动更换），「换一条」只对本次有效，重进恢复当日条目。
- **史载今日回归史实**：原先每天会在史实后面追加小知识兜底条目，现在只有当天没有史实时
  才兜底一条小知识。
- 0.4.1 的 IEND 修复、门禁规则、性能改动全部保留。

## 安装到模拟器

模拟器需先启动（AIoT-IDE 的 Vela 模拟器，212×520，skin `xiaomi_band_10`）；
也可以脱离 IDE 从命令行启动（必须带 `-vela` 旗标）

```bash
# 先构建：npm run build:jsc（产物在 dist/*.rpk）

# 手动安装（必须用 pm install）
adb push dist/*.rpk /data/app/com.miband.box.rpk
adb shell pm install /data/app/com.miband.box.rpk
adb shell am start com.miband.box
```

> 不要用 `rm -rf /data/app/<pkg>` + `unzip` 的方式安装：那样 AMS 里会残留
> 「文件已删、状态还在」的坏应用，之后 `am start` 只出黑屏。用 `pm install` 覆盖即可。

## 目录

```
src/
├── manifest.json          54 条路由、权限、features
├── app.ux                 全局 KV / 互联初始化
├── common/                自绘图标、公共图
├── components/
│   ├── BackBtn.ux         统一返回按钮
│   └── Ring.ux            弧形进度环（原生 progress arc）
├── data/                  自建数据集（apps/quotes/answers/food/history/waste/morse/colors/perf）
├── utils/                 kv / fs / docs / time / haptic / router / calc / inputResult / textInput / keyboardText / homeLayout
│                          interconnect（手机互传通道）/ lyricsTransfer（歌词传输协议）
│                          otp / otpAccounts / otpProtocol（动态口令内核与协议，双端一致副本）
│                          otpStore（口令存储）/ otpBridge（常驻接收层）
│                          marqueeState（跑马灯配置的跨页同步传递）
└── pages/                 54 个页面（含 input 文本输入页、lyrics/transfer 接收页、otp/ 动态口令四页）

plugin/
└── bandbox-helper/       AstroBox 插件（API Level 4）：手机端选 LRC 并推送 / 动态口令账户同步
```

## 许可

- 字体使用设备系统字体（Band 10/11 的 MiSans / MiLan Pro），不内置字体子集。
- 内置输入法组件来自 [NEORUAA/Vela_input_method](https://github.com/NEORUAA/Vela_input_method)（MIT），许可证见 `src/components/InputMethod/LICENSE`，在此感谢该作者对 Vela 提供输入法的支持。

## 已知限制

- 文本输入使用随包内置的 `Vela_input_method` 组件（MIT），支持中文拼音、英文、数字；短字段在页面内直接输入，长文本（笔记正文、歌词正文）在独立编辑页输入。
- 歌词本完全离线，不提供在线搜索（避免第三方接口依赖）。
- 「从手机传输」需要手机端安装 AstroBox 插件「BandBox辅助」，且手环需停留在接收页；
  没装插件或插件未加载时，手环页会显示「未连接手机」并给出诊断提示。
- 动态口令密钥明文存储（Vela 无加密存储 API），仅适合低敏账户或做备用 2FA；
  时间校准依赖手动偏移 / 手机提示，不联网校时。
- 性能分为相对参考值，受温度、后台任务和模拟器影响。
- 荧光棒与跑马灯用原生 `@keyframes` 驱动（软件渲染的满帧重绘），长亮页面注意发热；
  动画在 `play.ux` / `textShow.ux` 里，真机若帧率不达标可改回 JS 定时器。
- 模拟器里的快应用绘制区域为 212×466（底部 54px 为系统手势栏）；真机照片显示可继续绘制到约 500，但底部是药丸屏收窄区，仅适合居中窄内容。
- 模拟器冷启动约 10 秒，是 Vela 运行时调试器发现超时导致；真机通常更快。
- 模拟器的鼠标/触摸坐标与画面存在约 40 px 偏移，自动化截图时需自行校准；真机触摸正常。
- Vela 模拟器镜像的文本渲染不稳：重装应用后偶发整页中文变豆腐块或错位，
  重启模拟器（清字体缓存）后恢复。这是模拟器侧的问题，手表真机不受影响。

## 致谢

感谢小米 Vela 平台、AstroBox 平台、米坛社区，以及各开源社区提供的文档与示例。没有你们，这个项目将无法诞生。

## 赞助
本项目开源免费，若你从任何渠道购买，请立即申请退款，并前往官方渠道下载。若你愿意小小的赞助作者一杯咖啡，作者将感激不尽，并会在赞助者名单中写上你的名字！