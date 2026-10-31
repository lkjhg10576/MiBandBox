# Hyper Box 3.0.2 逆向分析报告

样本：`66_3.0.2.rpk`（2,332,732 B，293 个文件，zip）
包名 `com.charlie.hyperbox` · 名称 **Hyper Box** · 版本 3.0.2 (3020) · 设备 `watch`
编译器：AIoT 工具链 1.1.4 / node v24.13.1 / component 构建

> 本报告只记录**可观察行为与规格**，不含原始源码或原始资源副本，供净室重写使用。

---

## 1. 包结构

```
manifest.json            # 完整路由表（63 路由）+ features 声明
manifest-watch.json      # 同上的 watch 变体
app.jsc                  # 全局：设备白/黑名单、授权检查、互传通道、菜单数据
pages/<page>/<page>.jsc  # 63 个页面，编译产物（无 .ux 源码）
components/InputMethod/  # 自带自定义输入法（4 套键盘布局图 + 拼音词典）
common/                  # 63 个图片/字体资源 + icons/ 28 个应用图标
i18n/{defaults,en,zh-CN}.json
META-INF/{CERT,build.txt}
```

`features` 声明（即实际使用的系统能力）：
`system.router, prompt, vibrator, device, app, storage, fetch, brightness, sensor, interconnect, file, audio`

---

## 2. `.jsc` 容器格式（已完全解出）

```
[0x01][varint: 字符串数量][字符串表][字节码段]

字符串项: varint(L) + 数据
    L & 1        → 宽字符标志
    L >> 1       → 字符数 ch
    L & 1 == 0   → ch 字节 ASCII（latin-1）
    L & 1 == 1   → ch*2 字节 UTF-16LE
```

验证：64 个 `.jsc` 全部按此规则解析成功，字符串表结束偏移严格小于文件长度，
之后是常量池/指令流（未做指令级反汇编，行为已可由字符串+JS 语义充分还原）。

解析器见 `_re/jsc.py`（约 30 行），可复现全部字符串。

**为什么不需要 Ghidra**：产物是 Vela 自研字节码，不是 ARM/ELF 机器码；
需要的是容器解析器而非反汇编器，已由 `_re/jsc.py` 完成。

字符串表泄露的规格量非常大：模板结构、CSS 数值、类名、事件名、变量名、
存储键、文件路径、路由参数、内置数据集、错误文案 —— 足以做等效重写。

---

## 3. 应用架构

### 3.1 路由（63 个）

入口 `pages/index` → 欢迎页（`/common/WELCOME.png`，1s 淡出动画）→ 按
`device.versionName` 选择 `pages/home`（双列）或 `pages/home2`（单列）。

菜单应用（`app.jsc` 中的 26 项，顺序即首页顺序）：

| # | 名称 | 路由 | 资源图标 |
|---|---|---|---|
| 1 | 计算器 | calculator | icons/calculator.png |
| 2 | 笔记本 | notebook | icons/notebook.png |
| 3 | 荧光棒 | fluorescence | icons/fluorescence.png |
| 4 | 目标日 | daysmatter | icons/daysmatter.png |
| 5 | 每日一言 | sentence | icons/sentence.png |
| 6 | 密码生成 | password | icons/password.png |
| 7 | 答案之书 | answer | icons/answer.png |
| 8 | 振动器 | vibrate | icons/vibrate.png |
| 9 | 剩余时间 | time | icons/time.png |
| 10 | 存储空间 | storage | icons/storage.png |
| 11 | 木鱼Pro | fish | icons/fish.png |
| 12 | 显示测试 | display | icons/display.png |
| 13 | 红光手电 | flashlight | icons/flashlight.png |
| 14 | 手速测试 | cpsTest | icons/cpsTest.png |
| 15 | 今日饮食 | diet | icons/diet.png |
| 16 | 随机数 | random | icons/random.png |
| 17 | 系统信息 | system | icons/system.png |
| 18 | 性能测试 | performance | icons/performance.png |
| 19 | 史载今日 | history | icons/history.png |
| 20 | 记分牌 | scoreboard | icons/scoreboard.png |
| 21 | 摩斯密码 | morseCode | icons/morseCode.png |
| 22 | 垃圾分类 | wasteSorting | icons/wasteSorting.png |
| 23 | 快捷生码 | qrcode | icons/qrcodeGen.png |
| 24 | 跑马灯 | marquee | icons/marquee.png |
| 25 | 歌词本 | lylist | icons/lylist.png |
| 26 | 水平仪 | level | icons/level.png |

子页面：`notebook/{list,show,edit,rename,more}`、`daysmatter/{list,edit,inputdate}`、
`lyrics/{lyrics,lylist,Flyrics,Fsearch,showmode,show,more,edit,add2,search,choose}`、
`passwordDetail`、`qrcode/show`、`marqueeSet`、`textShow`、`num`、`PFinfo`、
`set`、`hset`、`about`、`push`、`fish/ab`、`activation/{activation,choose,codeshow,scanqr,type,mb10tips}`。

### 3.2 页面通用骨架（63 页中 55 页一致）

```
绝对定位 212×520，背景 #000000
├─ 顶部时间文字：top 16~25px，font 18px/32px，bold，rgba(255,255,255,0.6)
├─ 顶部标题：    top 35~42px，font 26~32px，bold，#FFFFFF
├─ 顶部渐变遮罩：/common/shadow.png（206×~60px，top 60~86px）
├─ 滚动区：      scroll/list，padding-top 86px，左右 3px（卡片宽 206px）
├─ 卡片：        #262626，radius 25~27px，padding 12.5px 16.5px，间距 8px
│   ├─ 主文本 23px bold #FFFFFF
│   └─ 副文本 20px bold rgba(255,255,255,0.6)
├─ 底部圆钮 /common/More_B.png（•••，72×72，left 55~67px，bottom ≈443px）
└─ 装饰：4 张旋转卡片扇形（-21°/-9°/9°/21°，left 60.9/79/93.5/108px）
```

### 3.3 关键公共能力

- **KV 存储**：所有页面通过 `system.file` 读写单一 JSON：
  `internal://files/hb/stroage-api/savedFile`，`readText→parse→assign` / `stringify→writeText`
  （等价 localStorage 的模拟层）。
- **自定义输入法**：`components/InputMethod`，4 套布局（full / t9 / horizontal / arc），
  事件 `complete / delete / visibilityChange`，属性 `hide / keyboardtype / vibratemode / screentype`；
  内置拼音词典（`py2hz`、`getSingleHanzi`、`getResultByWord`、候选词分页）。
- **互传通道**（`app.jsc` 内实现）：`system.interconnect` 上的分块文件传输，
  `send/ack` 窗口、base64 分片、`internal://files/_icf_*` 临时片、`maxChunkSize`、进度回调。
  用途：歌词/笔记推送到手机端伴侣 App（"AstroBox"）。
- **时间源**：每页独立 `setInterval` 更新 `currentTime`（HH:mm）。

---

## 4. 设计令牌（从 CSS 字符串反推）

```
画布      212×520（config.designWidth = device-width，watch）
背景      #000000
卡片      #262626        卡片按下 rgba(255,255,255,0.06)
主文本    #FFFFFF / rgb(255,255,255)
副文本    rgba(255,255,255,0.6)
弱文本    rgba(255,255,255,0.4) / #9E9E9E
强调蓝    #0d84ff / #156CEF / #4E87FF（图标线色）
警示      #ff0000 / #ad0000
字体      系统字体 + 内置 GoogleSansFlex-rounded（数字/设备码用）
圆角      卡片 25~27px · 小图 14px · 进度条 4px
字号      标题 26~32 · 主 23 · 副 20 · 小 18 · 极小 14
```

芯片式卡片 206px 宽 / 72~107px 高 / 圆角 27px / `margin-bottom 8px`。

---

## 5. 各页面行为规格

### 5.1 工具类（无输入）

| 页面 | 行为 |
|---|---|
| calculator | 内嵌 webpack 计算器核心；表达式求值（+ - × ÷ % √ ( ) .），`C` 清空、退格图 `/common/del.png`、`more1/more2` 切换复合键盘页、横滑 `scrollX` 显示溢出、错误提示「输入无效」+ 短振动；点击有短振动反馈 |
| cpsTest | 手速测试：3 秒倒计时（「还剩 N 秒后单击」）→ 计单击次数 → CPS 结果 → 「再试一次」 |
| display | 屏幕测试：单击切换颜色（含纯色全屏），「结束测试」退出，伴随短振 |
| flashlight | 红光手电：进入即亮度拉满 + 全屏红，单击在若干颜色间切换 |
| fluorescence | 荧光棒：按 `intervalId` 循环切换颜色（彩色渐变循环） |
| random | 随机数：最小值/最大值 +/- 调整、大号按钮抽号、Toast 校验（min>max 等） |
| scoreboard | 记分牌：红/蓝两队 +1/-1，计时器（`play.png`/`stop.png`），HH:MM:SS |
| storage | 环状进度：已用空间 / 总空间（`file.getUsage` + 总容量），百分比文字 |
| system | 设备信息列表：类型/型号/系统名/系统版本/平台版本/地区/屏宽/屏密度/设备唯一标识/总空间（`device.getInfo` + `getDeviceId` + `getSerial`） |
| performance | 基准测试：对象访问、数组操作、复杂数学、复杂数组四项耗时 → 分数；结果对照 `PFinfo`（设备参考分数） |
| time | 「今日还剩」「今年还剩」倒计时（时/分/秒/天），含闰年处理 |
| vibrate | 振动器：模式切换（短/长/自定义）+ 强度（100/200/500/1000/1200）+ 播放/停止，节奏间隔循环 |
| diet | 今日饮食：点击随机抽「吃什么」（面条/拉面/泡面/西北风…）与「喝什么」（可口可乐/核废水…），带滚动动画 |
| answer | 答案之书：封面 `book1.png` → 点击进入 `a1`，随机 141 条答案之一 + 淡入动画 + 书架装饰 |
| sentence | 每日一言：内置约 110 条文案，卡片展示，`change.png` 换一条，开关「将军一言已启动/关闭」（watchface 语音/推送开关，写 localStorage） |
| history | 史载今日：按「月-日」查询内置大事记（595 条字符串，维基风格条目），列表 + 首条高亮 |
| fish | 木鱼 Pro：点击木鱼 `muyu1.png` 计「功德」数，上滑/切换功德榜，累计数持久化；「更多」跳 `fish/ab`（付费诱导页，见 §7） |
| level | 水平仪：`sensor.subscribeAccelerometer` → atan2 计算倾角 → 圆环 `progress` 显示 0°~±45°，显示「°」 |
| marqueeSet | 跑马灯设置：文本框（调输入法）、文本大小、滚动速率（px/s）、文本颜色/背景色选择 → 跳 `textShow` |
| textShow | 跑马灯播放：`marquee` 组件全屏滚动，点击返回 |
| num | 数字滚动器：定时器自动滚动数字，可设「毫秒/次」，点击输入框保存 |
| PFinfo | 设备参考分数表（机型 → 性能基准分） |

### 5.2 需要输入/内容管理

| 页面 | 行为与数据 |
|---|---|
| notebook/list | 列出 `internal://files/notebook/` 下文件，卡片显示标题 + 修改时间，`Plus_B.png` 新建，点击进 `show` |
| notebook/show | 阅读页：全文 `scroll`，点击切换 chrome 显隐，`More_B` → `more` |
| notebook/edit | 编辑页：InputMethod 全屏输入，标题 + 正文，保存写文件，`del.png` 删字符 |
| notebook/rename | 重命名：单个输入框 + Check 确认 → 「保存成功」 |
| notebook/more | 操作表：继续编辑 / 重新命名 / 以二维码分享（→qrcode/show）/ 推送至跑马灯（→marquee）/ 删除（二次确认，Toast「删除成功」） |
| daysmatter/list | 目标日列表：`internal://files/events.json`，卡片显示 `display_name` + 「已经 N 天 / 就在今天 / 还有 N 天」，`Plus_B` 新建，点击进编辑 |
| daysmatter/edit | 编辑：事件名称（InputMethod）、日期（→inputdate 选择器）、保存 Toast「事件保存成功！」、删除 |
| daysmatter/inputdate | 年月日三列 picker，确认回传 `date_callback` |
| password | 密码生成：长度 slider（8~32 左右）、生成随机密码（大写/小写/数字/符号）、星号展示、收藏写 JSON、上滑查看收藏夹（swiper 两页）、点击进 `passwordDetail`；Toast「你还没有生成密码哦~」「收藏成功，上滑查看收藏夹」 |
| passwordDetail | 密码详情：明文/隐藏切换、二维码、删除（`delete.png`） |
| qrcode | 快捷生码：输入文本（InputMethod，maxlength）→ `push pages/qrcode/show` 传参 `qr`，`show` 页渲染二维码 + 「扫码查看」 |
| morseCode | 输入文本 → 实时转摩斯电码显示，点按绿色/红色输出短/长音（vibrate + 视觉），含完整字母/数字/符号映射表 |
| wasteSorting | 垃圾分类：输入物品名 → 命中词典返回「可回收垃圾/干垃圾/湿垃圾/有害垃圾/大件垃圾」；内置约 800 条物品词条 |
| lylist | 我的歌词：`internal://files/lyrics/` 文件列表，`Plus_B` → `lyrics/choose`（从网易云搜索 / 扫码了解） |
| lyrics/search → Flyrics | 关键字搜索（InputMethod）→ `fetch` 搜索接口（json）→ 结果列表 `Flyrics`（歌曲名/歌手） |
| lyrics/add2 → edit | 抓取歌词文本 → 编辑页（InputMethod）→ 保存为 `internal://files/lyrics/<name>.txt`（Toast「保存成功」，失败带 code） |
| lyrics/show | 歌词播放：全屏滚动（`scrollBy` + 速度），长按 → `more`；点击切换 chrome；`brightness.setKeepScreenOn` 屏幕常亮（Toast 开启/关闭/失败），自动滚动开关 |
| lyrics/more | 操作表：编辑歌词信息 / 设置显示方式（→`showmode` 横屏/竖屏）/ 设置滚动频率 / 删除（二次确认） |
| lyrics/showmode | 显示方式：横屏 / 竖屏（写 `lyricsm` 键，重启生效） |
| push | 推送进度页：`interconnect` 连接 → 等待选择 → 下载中（%）→ 下载完成/中断（`connect/choose/download/succ/error.png`），`setKeepScreenOn` |
| hset | 首页样式：单列 / 双列（写 KV `home`，Toast「重启生效」） |
| set | 设置：激活状态（**付费系统，删除**）、首页样式、关于应用 |
| about | 关于：版本号、开发者、致谢（`aboutBg/aboutSD` 两张图） |

---

## 6. 数据模型

| 数据 | 位置 | 结构 |
|---|---|---|
| KV 存储 | `internal://files/hb/stroage-api/savedFile` | 单个 JSON 对象，键含 `home`(布局)、`lyricsm`(显示方式)、`vfcharlieq`(激活码)、`acstatus`/`ac2`(激活态) |
| 目标日 | `internal://files/events.json` | `[{event_id, date, display_name, on_index, extend}]`；派生 `timeStatus/days/already` |
| 笔记 | `internal://files/notebook/<name>` | 纯文本，`file.list` 取目录，`lastModifiedTime` 排序 |
| 歌词 | `internal://files/lyrics/<name>.txt` | 纯文本歌词 |
| 密码本 | KV 存储内数组 | `[{item: 密码串, 时间}]` |
| 互传分片 | `internal://files/_icf_*.bin` | 分块传输临时文件 |
| 内置数据集 | 各页 .jsc 常量 | 每日一言 110 条、答案之书 141 条、垃圾分类 ~800 词条、史载今日 ~300 条、饮食池 ~15+15、性能参考分、摩斯表、拼音词典 |

---

## 7. 收费/授权系统（本次要删除的部分）

拆解结果（仅作说明，净室版全部移除）：

- `app.jsc` 启动时 `onCreate` → `getDeviceId` → 比对 `bannedDevices` 与机型白名单
  （Xiaomi Smart Band 8 Pro / 9 / 9 Pro / 10 Pro / 11 Pro，Redmi Watch 4/5/6/7/8）
- 首页与设置页读 KV `vfcharlieq`，未激活则强制跳 `pages/activation/choose`
- `activation/type`：输入 6 位激活码，内部用 `deviceId` + sha256 变体（`sha256/rotr/encodeMessage/toBytes`）
  派生校验值比对（常量 `ccodecharlieq`、`c4h2h1DBaGO`），成功写 `vfcharlieq`
- `activation/codeshow`：显示「您的设备码」（`getDeviceId` 派生 + 字体渲染，含 `blue.png` 装饰）
- `activation/scanqr`：扫码付款图 + 「手动激活」入口
- `activation/mb10tips`：手环机型的提示页
- `fish/ab`：木鱼页的「下载完整版 / 扫码下载」诱导页（自定义文字/图片、Pro 模式）
- `lyrics/choose`：「AstroBox 扫码了解」第三方引流

---

## 8. 外部依赖与风险

| 项 | 说明 |
|---|---|
| 歌词搜索 | 走第三方（网易云）代理接口，非官方 API，随时可能失效；净室版改为可配置端点 + 可选关闭 |
| 互传/推送 | 依赖手机端伴侣 App 的 `interconnect` 协议；无伴侣 App 时 `push` 页只显示等待连接 |
| 字体 | 内置 Xiaomi 圆体 `GoogleSansFlex-rounded-forhb.ttf`，授权不明 → 不自带，用系统字体 |
| 数据集版权 | 每日一言（大量歌词）、史载今日（维基条目）、答案之书（源自出版物）、分类词条 → 全部重写/重生成 |
| 音效 | 无音频文件，仅有振动反馈 |

---

## 9. 尚未完全还原的部分

1. 字节码指令流（未反汇编）——不影响功能重写，若需精确到「同一算法」可再写反汇编器。
2. 激活码派生算法具体位运算常数（已确认结构为 sha256 变体 + 设备码表，无重写价值）。
3. `interconnect` 分块协议的具体帧格式（净室版不复用，改为自有简化协议或直接去掉）。
4. 各页精确像素（已还原到 1px 级的大部分布局参数，剩余动画时长/缓动曲线为近似）。
