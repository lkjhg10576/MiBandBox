# 开发计划（Hyper Box 等价版，去付费）

目标：**行为大体一致、无任何收费/授权/引流**的小米 Vela 手表快应用。

---

## 1. 开发原则

- 行为与交互以 `REPORT.md` 中的记录为参考。
- 不包含激活、授权、付费或引流功能。
- 数据本地化，零联网必需。
- 应用名称 BandBox，包名 `com.miband.box`。

---

## 2. 技术选型

- **JS 快应用**（与原件一致，生态/API 最匹配）
- `deviceTypeList: ["watch"]`，`config.designWidth: 212`，`display.backgroundColor: "#000000"`
- 纯 JS，无构建依赖；数据本地化，**零联网必需**（联网功能作为可选）
- 目标机型：当前以小米手环 10 / 11（212×520 跑道屏）为准；系统输入法依赖真机固件，其他机型需单独验证

---

## 3. 目录结构

```
src/
├── manifest.json
├── app.ux                     # 全局：主题、返回手势、GC、启动计时
├── common/
│   ├── icon.png               # 应用图标（自绘）
│   └── images/                # 自绘资源（shadow/more/enter/plus/check/... + icons/）
├── components/
│   ├── BackBtn.ux             # 统一返回按钮
│   ├── Ring.ux                # 圆环进度（存储/水平仪/性能共用）
│   └── PageHead.ux            # 时间 + 标题 + 顶部遮罩
├── utils/
│   ├── kv.js                  # KV 存储（savedFile JSON 读写，防抖落盘）
│   ├── fs.js                  # 文件读写/列目录/删除封装
│   ├── time.js                # 时钟源、格式化、天数差、闰年
│   ├── haptic.js              # 振动封装（短/长/节奏）
│   ├── textInput.js           # 原生 input/textarea 取值、换行、长度规则
│   └── router.js              # 路由封装（push/back/param 传递）
├── data/                      # 全部自建数据集
│   ├── quotes.js  food.js  history.js  waste.js  answers.js
│   └── morse.js  perf-baseline.js
├── services/
│   └── lyrics.js              # 可选联网歌词源（可配置端点；失败降级为本地）
└── pages/…                    # 同 §4
```

---

## 4. 页面矩阵与里程碑

### M0 骨架（1 天）
`index`（欢迎动效）、`home`（网格 26 图标 + 目标日卡片）、`set`、`hset`、`about`
− 组件：PageShell / ListRow / CardStack / Toast
− utils：kv / fs / time / haptic
**验收**：能构建、能进首页、图标可点、布局与设计规范一致。

### M1 免输入工具（14 页，2~3 天）
`calculator` `cpsTest` `display` `flashlight` `fluorescence` `random` `scoreboard`
`storage` `system` `performance` `PFinfo` `time` `vibrate` `level`
**验收**：全部可交互，无输入依赖，振动/亮度/传感器 API 正常。

### M2 输入类（5 页，2 天）
`marquee` → `marqueeSet` → `textShow`；`num`；`qrcode` → `show`；`morseCode`；`diet`；`answer` → `a1`；`sentence`；`history`；`wasteSorting`
（依赖系统输入法与原生 `input`/`textarea`；`qrcode` 依赖自研二维码编码器）

### M3 内容管理（4 组页面，3 天）
- 笔记本：`notebook/{list,show,edit,rename,more}`
- 目标日：`daysmatter/{list,edit,inputdate}`
- 密码本：`password`、`passwordDetail`
- 歌词本：`lylist`、`lyrics/{lyrics,show,more,showmode,edit,add2,choose}`（搜索可选、`push` 页保留本地导出）

### M4 打磨（1~2 天）
动效（卡片扇形、页面进入、等待/成功态）、圆屏安全区、性能（列表复用、定时器收敛）、
真机/模拟器像素比对、终版打包。

### 删除清单（相对原件）

| 删除 | 原因 |
|---|---|
| `pages/activation/*`（6 页） | 授权/激活 |
| `set` 页「激活状态」卡片、首页激活拦截、`bannedDevices` 机型限制 | 授权 |
| `fish/ab`「下载完整版」诱导页 | 付费诱导 |
| `fish` 中的 Pro 标识 | 付费标识 |
| `lyrics/choose` 的 AstroBox 扫码引流 | 第三方引流 |
| `push` 的厂商互传协议 | 依赖闭源伴侣 App；改为本地导出（写文件/生码） |
| 内置 Xiaomi 圆体字体 | 授权不明 |
| 全部原始 png / 图标 / 数据集 | 版权（改为自绘/自建） |

---

## 5. 关键实现要点

### 5.1 设计系统代码化
`utils/theme.js` 导出令牌（颜色/字号/圆角/间距），页面 CSS 只用变量值，不硬编码；
`PageShell` 统一时间刷新（`setInterval` 每 10s 对齐分钟）+ 顶部 `shadow.png` 遮罩 + 标题。
卡片统一 `206×≥72 / radius 27 / #262626 / padding 12.5px 16.5px / margin-bottom 8px`。

### 5.2 输入法（系统输入法）
- 使用 Vela 原生 `<input type="text">` / `<textarea>`，获得焦点时由系统输入法接管，支持中英文
- 短字段（标题、名称、跑马灯、二维码、摩斯、垃圾分类）在页面内直接输入；长文本（笔记/歌词正文）走 `pages/input` 原生 textarea
- `utils/textInput.js` 统一取值（`value`/`text`）、换行归一、长度裁剪、摩斯字符过滤
- 不再内置英文键盘和字体子集；字体使用系统字体，避免用户输入出现豆腐块

### 5.3 二维码（纯 JS，自研）
`utils/qr.js`：字节模式、版本 1~10 自动选择、纠错等级 M、掩码择优（8 种惩罚评分）。
接口 `qr.encode(text) -> modules[len][len]`，渲染用 1dp 方块 div 拼图（Vela 无 canvas）。
体积估算 ~450 行；不需联网、不需图片资源。

### 5.4 计算器
自写「四则运算 + 括号 + 百分号 + 开方 + 一元负号」的递归下降解析器（约 120 行），
双键盘页（基础/扩展）横滑切换；错误统一 Toast「输入无效」+ 短振动。

### 5.5 摩斯电码
`data/morse.js` 提供 `char→code` 表（A-Z/0-9/常用符号）；
播放：短点 200ms 振动 + 视觉闪烁，长划 = 3×，字符间隔 3×，词间隔 7×；
用户可用按键手动敲击（点按=点，长按=划），自动播放仅做「播放」按钮。

### 5.6 水平仪
`@system.sensor.subscribeAccelerometer({interval:'ui'})` →
`atan2(x, sqrt(y²+z²))` 得倾角，平滑（EMA α=0.2）后驱动 `Ring`，显示 `-45°~+45°`，
离屏 `unsubscribeAccelerometer`。

### 5.7 目标日
`events.json`（自有 schema：`{id, title, date:'YYYY-MM-DD', createdAt}`），
列表计算「已经 N 天 / 就是今天 / 还有 N 天」，卡片扇形装饰显示最近一条。
编辑页：名称（键盘）+ 日期（三列 picker）+ 保存/删除（二次确认）。

### 5.8 笔记本 / 歌词本
统一「文档仓库」抽象 `utils/docs.js`（目录 + 列表 + 读 + 写 + 重命名 + 删除），
两处复用；列表按 `lastModifiedTime` 倒序；空态用插图 + 「暂无内容」。

### 5.9 密码本
字符集可勾选（大写/小写/数字/符号）、长度 8~32、`crypto.getRandomValues` 优先，
退化为 `Math.random` + 时间戳混合；收藏写 KV 数组；详情页支持隐藏/二维码/删除。

### 5.10 数据生成（自建，脚本在 `tools/gen-data/`）
- `quotes.js`：100 条自撰短句（原创，避免歌词）
- `answers.js`：100 条自撰占卜短句（避免出版物原文）
- `history.js`：按 366 天生成的「科技+文化」事件，来源为公共领域事实，措辞自写，每条 >20 字
- `waste.js`：约 400 条常见物品 → 四分类 + 大件（依据公开分类标准，措辞自写）
- `food.js`：30 条饮食/饮品名（通用名词）
- `perf-baseline.js`：机型 → 参考分（自测或估算，标注为参考值）

### 5.11 图标与图片资源
`tools/gen-assets/`（Python + PIL）生成：
- 28 个 44×44 线描图标（统一 2px 描边、圆角、蓝色 #4E87FF，但造型自绘）
- `shadow.png`（顶部渐变）、`more.png`（•••）、`plus.png`、`check.png`、`enter.png`、`empty.png`
- 应用图标 216×216（工具箱变形，白底蓝图形）
保证「风格一致、内容自创」。

---

## 6. 验收清单

**功能**：26 个应用全部可进入、可返回、可持久化；无死路页面；无激活/付费入口。
**手势**：页面无横向溢出（`.page` 全局 `overflow: hidden` 兜底 + 逐页消除超宽行），右滑返回不被横向拖动抢占；`list` 页面列表项不留横向 margin（原生 list 会把子项 margin 计入可横向滚动范围，歌词本 3px 边距即可拖动抢占返回，内缩改由 list 自身 padding 提供）；计算器表达式框、跑马灯、密码滑块、歌词横屏等「设计内横向滚动」除外。
**视觉**：212×520 基准下与设计规范一致；圆屏（466）四角不裁切关键内容；
标题/时间/遮罩位置统一；卡片 27px 圆角。
**稳定性**：页面销毁清定时器与订阅（`onDestroy`）；连续切换 30 次无泄漏；
文件读写失败有 Toast + 默认值降级。
**体积**：rpk < 1.5 MB（系统字体，无内置字库）；冷启动 < 800ms。
**合规**：无联网必需、无第三方 App 依赖、无原始素材、无原商标。

---

## 7. 交付节奏

1. 本计划 + `REPORT.md`（已完成）
2. M0 骨架 + 资源生成脚本 → 可构建的首个 rpk
3. M1/M2 页面批量实现（每批一提交，附页面清单）
4. M3 内容类 + M4 打磨
5. 真机验证清单逐项打勾 → 发布包
