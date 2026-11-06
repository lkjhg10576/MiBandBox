# BandBox

BandBox 是一个为小米手环 10 / 11（212×520 跑道屏）设计的本地小工具箱，包含 28 个应用、51 个页面。

- 包名：`com.miband.box`
- 版本：0.3.6
- 技术栈：Vela JS 快应用（`.ux`）
- 屏幕：212 × 520 跑道屏；模拟器应用区 212 × 466，真机可绘制到约 500（底部为药丸收窄区）
- 体积：约 380 KB（使用系统字体，无内置字体子集）
- 无联网必需、无收费、无授权、无第三方 App 依赖
- 手机端可选装 AstroBox 插件「BandBox歌词同步」，把手上的 LRC 歌词推到手表歌词本

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
| 史载今日 | 全年 366 天，每天都有史实条目 + 科技小知识，可上下滚动看全 |
| 记分牌 | 红蓝计分 + 计时器 |
| 摩斯密码 | 文本转电码、自动播放、手动点划 |
| 垃圾分类 | 200+ 物品词表，五分类 |
| 快捷生码 | 文本 / 网址 / WiFi 二维码 |
| 跑马灯 | 文字、字号、速度、颜色；竖屏横向滚动，横屏把内容旋转 90° 后滚动 |
| 歌词本 | 本地歌词、自动滚动、横竖屏，支持「从手机传输」接收手机推送的歌词 |
| 水平仪 | 双轴倾角小圆点 + 十字准星，可校准归零 |

## 从手机传输歌词

歌词本首页顶部有一张「从手机传输」卡片，点进去进入接收页：

1. 手机装 AstroBox 插件 **BandBox歌词同步**（源码在 `plugin/bandbox-lyrics-sync/`）
2. 手环停在「从手机传输」页面（页面会置常亮，并用 ping/pong 心跳检测手机插件是否在线）
3. 手机插件里点「选择 LRC 文件」→ 选一个 `.lrc`
4. 插件自动识别逐行 LRC、常规逐字 LRC（行内时间标签）和增强逐字 LRC（ESLyric），
   剥掉时间轴与元数据标签、还原成逐行纯文本，点「发送到手环」
5. 手环弹出「已接收：<歌名>」，歌词本里随即出现该条目

连接状态不再依赖 Vela 的 `getReadyState`（AstroBox 不是官方配套 App，该状态不可靠）：
手机插件每 5 秒主动向手环发一次 `hello` 心跳，手环收到即显示「已连接手机」；
手环也会发 `ping` 探活，插件回 `pong`（部分固件下手环→手机方向不可用，因此以手机心跳为准）。
插件在 `onUiRender` / `device-action` 时会注册手环消息接收，所以手环进页面时发出的 `ready`
也能被收到并回复。协议是本仓库自定义的 `bandbox-lyrics`（JSON 字符串，`app`/`v`/`type` 三个公共字段），
手环端实现见 `src/utils/lyricsTransfer.js`，插件端实现见 `plugin/bandbox-lyrics-sync/src/protocol.js`，
两端各有一套单测。手机端宿主会把 `interconnect-message` 包在
`{addr, pkgName, payloadText, payloadHex}` 信封里，插件会先解包再解析。
传输通道只有 BLE `interconnect` 一条（`system.interconnect`），
没有局域网 HTTP 兜底。长歌词分片按 UTF-8 字节计量（中文 3 字节/字），
单片正文预算 = 12 KB − 256 B 外层预留 − 标题字节；含超长单行的文件会在插件端被拒绝导入。

### 落盘格式

歌词统一存在 `internal://files/bandbox/lyrics/<encodeURIComponent(歌名)>.txt`：

```
第 1 行：歌名（标题）
第 2 行起：歌词正文（逐行）
```

单包与分片两条导入路径都按这个格式落盘（分片正文在重组后补上标题行）。
展示页与编辑页共用同一套解析规则（`src/utils/lyricsDoc.js`）：**只有首行归一化后与文件名一致
才当作标题**，否则首行属于正文——所以早期版本分片导入、缺少标题行的文件，
打开后第一句歌词不会丢。读取失败时展示页会提示「歌词读取失败」而不是留白。

## 构建

```bash
npm install
npm run build          # 开发包：dist/*.debug.*.rpk
npm run build:jsc      # 生成 jsc 字节码，更接近发布包
```

`aiot-toolkit` 已写入 `devDependencies`。如果使用 AIoT-IDE 的内置工具链，也可在 IDE 中直接构建。

发布包需要自己的签名证书（`aiot release`），开发/模拟器验证用 `npm run build` 即可。

## 安装到模拟器

模拟器需先启动（AIoT-IDE 的 Vela 模拟器，212×520，skin `xiaomi_band_10`）；
也可以脱离 IDE 从命令行启动（必须带 `-vela` 旗标），见 `docs/emulator-fix.md`。

```bash
# 自动构建 + 安装 + 启动
./tools/deploy.sh

# 或手动（必须用 pm install）
adb push dist/*.rpk /data/app/com.miband.box.rpk
adb shell pm install /data/app/com.miband.box.rpk
adb shell am start com.miband.box
```

> 不要用 `rm -rf /data/app/<pkg>` + `unzip` 的方式安装：那样 AMS 里会残留
> 「文件已删、状态还在」的坏应用，之后 `am start` 只出黑屏。用 `pm install` 覆盖即可。

截图 / 触摸 / 日志：

```bash
.venv-emu/bin/python tools/emu.py shot out.png
.venv-emu/bin/python tools/emu.py tap 106 260
.venv-emu/bin/python tools/emu.py swipe 106 450 106 120 --ms 600
```

## 目录

```
src/
├── manifest.json          50 条路由、权限、features
├── app.ux                 全局 KV / 互联初始化
├── common/                自绘图标、公共图
├── components/
│   ├── BackBtn.ux         统一返回按钮
│   └── Ring.ux            弧形进度环（原生 progress arc）
├── data/                  自建数据集（apps/quotes/answers/food/history/waste/morse/colors/perf）
├── utils/                 kv / fs / docs / time / haptic / router / calc / inputResult / textInput / keyboardText / homeLayout
│                          interconnect（手机互传通道）/ lyricsTransfer（歌词传输协议）
│                          marqueeState（跑马灯配置的跨页同步传递）
└── pages/                 50 个页面（含 input 文本输入页、lyrics/transfer 接收页）

plugin/
└── bandbox-lyrics-sync/   AstroBox 插件（API Level 4）：手机端选 LRC 并推送

tools/
├── test-protocol.mjs       手环端协议单测（node tools/test-protocol.mjs）
├── test-calendar.mjs       农历 / 日历纯逻辑单测（node tools/test-calendar.mjs）
├── test-input.mjs          原生输入工具单测（node tools/test-input.mjs）
├── test-history.mjs        史载今日数据单测（node tools/test-history.mjs）
├── test-marquee.mjs        跑马灯配置与宽度估算单测（node tools/test-marquee.mjs）
├── test-screen.mjs         屏幕亮度与常亮控制单测（node tools/test-screen.mjs）
└── gen-assets/gen.py       图标与公共图生成
```

## 许可

- 字体使用设备系统字体（Band 10/11 的 MiSans / MiLan Pro），不再内置字体子集。
- 内置输入法组件来自 [NEORUAA/Vela_input_method](https://github.com/NEORUAA/Vela_input_method)（MIT），许可证见 `src/components/InputMethod/LICENSE`。

## 已知限制

- 文本输入使用随包内置的 `Vela_input_method` 组件（MIT），支持中文拼音、英文、数字；短字段在页面内直接输入，长文本（笔记正文、歌词正文）在独立编辑页输入。
- 输入法词库通过 `@system.file` 从包内 `components/InputMethod/assets/dictionary/` 懒加载，不依赖手环固件是否提供系统输入法。
- 歌词本完全离线，不提供在线搜索（避免第三方接口依赖）。
- 跑马灯的「横屏」是**内容旋转 90°**（与歌词本横屏同一套做法），不是系统级方向切换：
  Vela 快应用没有页面级 `orientation` 配置，系统方向无法由快应用改写。
- 「从手机传输」需要手机端安装 AstroBox 插件「BandBox歌词同步」，且手环需停留在接收页；
  没装插件或插件未加载时，手环页会显示「未连接手机」并给出诊断提示。
- 性能分为相对参考值，受温度、后台任务和模拟器影响。
- 模拟器里的快应用绘制区域为 212×466（底部 54px 为系统手势栏）；真机照片显示可继续绘制到约 500，但底部是药丸屏收窄区，仅适合居中窄内容。
- 模拟器冷启动约 10 秒，是 Vela 运行时调试器发现超时导致；真机通常更快。
- 模拟器的鼠标/触摸坐标与画面存在约 40 px 偏移，自动化截图时需自行校准；真机触摸正常。
- Vela 模拟器镜像的文本渲染不稳：重装应用后偶发整页中文变豆腐块或错位，
  重启模拟器（清字体缓存）后恢复。这是模拟器侧的问题，手表真机不受影响。

## 致谢

感谢小米 Vela 平台、AIoT-IDE 、AstroBox平台、米坛社区，以及各开源社区提供的文档与示例。

## 赞助
本项目开源免费，若你愿意小小的赞助作者一杯咖啡，那就更好了，感激不尽！