# BandBox 仓库约定

面向所有在本仓库干活的助手（AI 或人）。这里只写**必须照做**的规则、约束与操作口径，
不写项目介绍，也不展开历史决策与事故经过——那些统一存 PowerContext（见「记忆存储」节）。

## 打包与发行

| 通道 | 什么时候打 | 打包模式 | 版本号 `versionName` | `versionCode` | 产物目录 |
|---|---|---|---|---|---|
| **Beta** | 用户**没有特殊要求**时的默认动作 | development（`aiot build`） | **默认不变**（仅用户明确要求时升） | **+1** | `beta/BandBox-<版本>-<versionCode>/` |
| **发行版** | 用户**明确要求**「打包一个新发行版」 | production（`aiot release`） | **升** | **严格递增取号** | `release/BandBox-<版本>/` |

- **Beta = 下个版本的测试包**：`versionName` 可以比当前发行版更高（正常，不是版本错乱）。**没明确说升版本号就只升 versionCode**（+1）；升版本号时 versionCode 照旧 +1，两件事别混着改。
- 产物内容两通道一致：**每设备 profile 一个 rpk**（jsc 字节码）+ `BandBox辅助.abp`（插件源码现编，全 profile 共用一份）+ `SHA256SUMS.txt`（覆盖全部 rpk）+ `说明.md`（注明各 rpk 适用机型）。
- 打包模式差异：发行版 production = JS 压缩混淆、剔 `.map`、发行证书签名；Beta development = 不压缩不混淆。
- **rpk 文件名里的 `.debug.` / `.release.` 段只表示打包模式，不是包名**。包名恒 `com.lkjhg.bandbox`，`manifest.json` 的 `config.debug` 为 `false`。
- **发行证书**：production 按 `sign/release/{certificate.pem,private.pem}` → `sign/{certificate.pem,private.pem}` 顺序找证书（`sign/` 被 .gitignore 忽略，私钥绝不入库）。**发行版必须自签发行证书，且 CN 必须等于包名**；工具链自带默认证书（CN=localhost）是 debug 证书，缺证书**绝不允许兜底复制它**。生成：`bash tools/gen-release-cert.sh`（CN 自动取 `src/manifest.json` 包名，镜像到 `sign/debug/` 供 development 共用）。
- **证书 subject 必须带齐 7 项**（C/ST/L/O/OU/CN/emailAddress，缺一项不构成合格签名文件）：`C=CN`、`ST=Tianjin`、`L=Tianjin`、`O=BandBox`、`OU=lkjhg10576`、`emailAddress=17726063360@163.com`、`CN=com.lkjhg.bandbox`（CN == 包名）。省/市用拼音（平台按 ASCII 解析最稳）。改值：`CERT_ST=… CERT_L=… CERT_OU=… CERT_EMAIL=… bash tools/gen-release-cert.sh --force`。**`--force` 默认沿用现有私钥只重签 subject**（签名身份不变，老用户可覆盖升级）；明确要换签名身份才加 `--new-key`（老用户须卸载重装、本地数据丢）。门禁 R12 与 `tools/verify-rpk.mjs` 都核对 7 项齐全。
- **不再产出 zip 压缩包**。

### 包名与 versionCode 规则

- 包名真源只有 `src/manifest.json` 的 `package` 字段；**包名必须六处同步**（见「其它硬约束」）。换包名 = 平台上是**另一个应用**（控制台包名一旦确认不可更改，须按新包名重建应用条目）；手环上新旧包可共存互不覆盖，老包数据留在旧应用里。
- 发行版 `versionCode` 取「所有已构建产物用过的最大号 + 1」（脚本扫 `beta/*/说明.md` 与 `release/*/说明.md`；发行版重建时排除自己目录，重打同号）。**同号会被平台与手环覆盖安装判旧包拒收**。`--code <n>` 显式指定。改取号规则时 AGENTS.md / README 的通道表同步改。

### 上架分发平台

- 平台只认**包内 `manifest.json` 的 `versionName`/`versionCode`**，控制台不改已签名包的版本（改任一字节验签失败装不上）。上架前确认**控制台版本 == 包内版本**（`node tools/verify-rpk.mjs <rpk>`）；平台已登记版本号必须小于新包 versionCode，被拒先查撞号。
- **`downloads/` 包体必须本地先入库**：控制台「更新仓库 manifest 与资产」只写 `manifest_v2.json` 与 `media/`，**不上传 `downloads/*.rpk`**，只在清单写 `downloads.<机型>.file_name`；审核按 `resource.csv` 钉住的 `repo_commit_hash` 去提交里找文件，缺文件直接打回。**顺序**：出包 → 包按原文件名复制进 `downloads/`（`.gitignore` 已 `!downloads/*.rpk` 放行入库）→ 提交推送 → 控制台编辑提交 → `node tools/astrobox-sync.mjs` 拉回清单（`--check` 校验引用完整性）+ 门禁 R13 复查。详见 `notes/astrobox-submit.md`。

### 打包命令

  ```bash
  # Beta（默认，development 模式；版本号不动，只升 versionCode）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta
  # Beta（多包：band10 + band9 + pro336 + rw432 一次出齐，同一产物目录）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta --all-profiles
  # Beta（用户明确要求升版本号时：--ver 升版本号，versionCode 照旧 +1）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta --ver 0.1.3 --all-profiles
  # 发行版（production 模式，产物文件名带 .release. 段）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --release <版本> --notes notes/<版本>.md --all-profiles
  # 发行版临时退回 development 打包（排查用，默认不启用）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --release <版本> --dev-build
  ```

  本机必须带 `copyfile-shim.cjs` 垫片，否则 `build:jsc` 被沙箱 `copy_file_range` 拦成 `EPERM`。
- **`--ver <版本>`** 只在用户**明确要求**升版本号时传（同步升 versionName：快应用 5 处 + 插件 4 处）。发行版提要写 `notes/<版本>.md`，脚本自动插进产物 `说明.md`。`--prune` 只清 `release/` 旧发行版目录，不动历史 zip，也不影响 `beta/`。

## 插件上架 AstroBox 官方插件源

手机端插件（`plugin/bandbox-helper/`）走另一套流程（细节 `notes/astrobox-plugin.md`）：

- 上架 = 往官方插件源仓 `AstralSightStudios/AstroBox-NG-Plugin-Repo` 的 `index.txt` **末尾追加一行**作者仓 raw 基地址（末尾斜杠必须留），提 PR 即可，不用控制台。
- 真源在 AtomGit `atomgit.com/gcw_MchqrexB/bandbox_helper`，用平台仓库镜像单向 push 到 `github.com/lkjhg10576/bandbox_helper`（市场只认 GitHub raw）。**镜像仓必须公开、分支必须 `main`**（否则 404，插件在市场静默消失）。
- 发布目录三件套必须同目录：`manifest.json` + entry(wasm) + icon（`scripts/build.mjs` 已把 manifest 与 icon 拷进 `dist/`，dist 即发布目录），缺一个客户端下载就失败。
- 发布命令：`cd plugin/bandbox-helper && node scripts/publish.mjs`（构建 → 同步 → 推 AtomGit → 轮询校验镜像）。改插件后重跑同一条；`manifest.json` 的 `version` 要升，市场才认新版本。
- 国内 `gh` 走 git 协议克隆极慢，**用 `gh api` 的 `/contents` 与 `/pulls` 提交**。

## 产物不许手改

- **签名后的 rpk 一律不许手工改**（不 unzip 重打包、不塞文件、不改任何字节）——rpk 签名块夹在文件区与中央目录之间，任何二次写入即失效 = 手环拒装。要改内容**重新出包**；包装不上先跑 `node tools/verify-rpk.mjs`（签名没了 ≠ 没走 jsc，别误判）。
- 三道防线：① `tools/verify-rpk.mjs` 判包内混装（出现 `.rpk`/`.abp`、包根非 `app.jsc`/`manifest*.json` 文件即失败）；② `make-release.sh` 产物落盘后再跑一遍验签 + `sha256sum -c`；③ 门禁 R14 构建前扫 `release/`、`beta/` 全部产物（签名块缺失 / 包内混装 / `SHA256SUMS.txt` 与磁盘不符，拦下构建）。
- **校验和就是防篡改凭据**：`SHA256SUMS.txt` 与产物成对生成、成对使用；动过产物必须重新生成摘要与 `说明.md`（`node tools/make-notes.mjs <目录> …`）。
- 手机插件 `.abp` 是独立产物，只放产物目录里，**绝不塞进 rpk 内部**。

## 首页工具分类模式

「设置」页「工具分类」开关卡：开 = 首页单栏显示 9 个工具类别，点进类别再单栏显示该类工具（两次点击直达）；关 = 回到上次记住的网格/列表样式。

- **分类成员关系唯一真源 `src/data/cats.js`**（9 类/44 工具）；`src/data/apps.js` **一律不加 `cat` 字段**（数组顺序是模拟器脚本 `shoot-routes.py`/`motion-sim.py`/`cube-sim.py` 与 `perf-audit.mjs` 的 index 依据）。分类详情页路由 `pages/toolcat`，用 `protected: { cat }` 收类别 id。
- **布局状态机四态** `'grid' | 'grid2' | 'list' | 'cat'`：`app.ux` normalizeLayout / `layoutFlag.js` read+write / `home.ux` applyLayout；复用既有状态机（KV `'home'` 键 + `layout.txt` 启动快标志 + watcher），**不另建一套**。KV 键 `'homeStyle'` 记上次非分类样式（关分类还原用，grid2 也参与）。
- **三写范式**：任何布局变更 `app.setHomeLayout(mode)` → `layoutFlag.write(mode)` → `g.kv.set('home', mode)` + `g.kv.flush()` 三处同写。`set.ux` 的「恢复默认设置」必须补 `layoutFlag.write('grid')`。
- 设置页开关卡**不能换 `<switch>`**（内联 style 三元 + 文字「开/关」，照 `calculator.ux` 的 `.swRow`）。设置页六张卡内容超两机型 body，`.body` 是 `<scroll>` + `.inner`（照 `about.ux` 结构）且 `.inner` 必须显式高度 —— **别改回普通 `<div>`**。
- `set.ux` 的 `'双栏网格'` 字面量带单引号（pro336 替换对靠它命中），只许出现在 `layoutName()` 与 data 默认值两处；**全文件严禁 `'三栏网格'`**（注释也算，test-profile 按整文件子串匹配）。
- **工具数唯一口径 = `apps.js` 条目数**（当前 44）：头图、README / README_EN、发布说明写「N 个工具」都以它为准。「进制转换」是「单位换算」第 13 类（radix 卡），不进首页网格不占名额；「体感手枪/空气投篮」是同一工具「体感游戏」。
- **门禁 R16**：构建前核对 cats 成员并集 == apps 全部工具 id，无重复/未知 id/图标文件存在。新增工具漏挂分类会在分类模式静默消失（分类模式默认关，运行期无症状），构建期硬约束。

## 滚动内容高约定

Vela 的 `<scroll>` **必须显式给内容高**（子容器给 height），不给就按视口高裁内容。

- **卡片列表页**（`set.ux` / `toolact.ux`）：`INNER_H = 信息卡 + CARD_COUNT ×(CARD_H+CARD_GAP) + PAD_H`，绑到 `<div class="inner" style="height: {{ innerH }}px;">`。常量对应：`CARD_H`=.card 高、`CARD_GAP`=.card 下外边距、`PAD_H`=.pad 高、`CARD_COUNT`=模板 `.card` 个数。**新增设置项要改 `CARD_COUNT`**；`.card`/`.pad` 一律 `flex-shrink:0`（宁裁尾巴不压文字）。`PAD_H=48` 保证滚到底最后一张卡完整落在可绘制区。
- **长文本页**：`src/utils/textMetrics.js` 估算折行高（字宽分档 + 1.08 安全系数 + 多给一行，**宁可高估留空白，不要低估裁字**），绑到内容容器 height。文本框宽度令牌在 `profiles/*.json` 的 `layout.text`（apply-profile 生成进 `src/common/layout.js` 的 `TEXT`）：`inputW`/`inputMultiW`/`morseW`。
- **门禁 R17**：① 纵向 scroll 直接子容器显式高度；② 卡片页常量与 CSS 一致、`CARD_COUNT`==模板 .card 个数、`.inner` 显式高、`INNER_H` 算式用上常量、`.card` flex-shrink:0；③ text 令牌与 CSS 宽一致。已知未修页记 R17 的 `R17_EXEMPT` 表（修好一页删一行）。`parseUxTemplate` 解析前剥 HTML 注释——注释里别出现 `<text>` 字面量（打乱标签配对）。

## 长列表分页

长列表页统一**每页固定 5 项 + 上下翻页条**，只渲染当前页（收藏列表 / 选城列表先例）。

- **页码口径唯一真源 `src/utils/pager.js`**（`SIZE=5`/`count`/`clamp`/`start`）；页面不得写死 5 或另写算式，新增长列表页沿用同一套。
- **翻页条**：正文上下各一条 `.pager`（左 `‹` / 中 `x/y` / 右 `›`，按钮 44×36 圆钮；**按钮 44 宽**是为了模拟器 x<40 触摸假象下自动化点 `x = pagerL + 40` 仍落在钮里），位置类 `.pagerTop`（y88）/ `.pagerBot`。到头一侧文字色 `rgba(255,255,255,0.3)`、可翻侧 `#4E87FF`；成功翻页 `g.haptic.short()`。`.pgNum` 固定宽 90、space-between 居中。
- **几何随 profile**：`.pagerBot` top band10/band9 `422`、pro336 `400`、rw432 `456`；收藏正文高 290/290/268/324、选城列表高 246/246/224/280。改高度同步 profile 替换对（test-profile 校验漂移）。
- 收藏页 `.inner` 高度只按**当前页 5 条**估算，`all` 只存文本、`items` 才是当页卡片；条目超长仍可页内滚。选城页搜索行 128..168、列表 172 起、行高 42+间距 2。**不要再加「显示更多」或整批渲染**（等于把一次性物化带回来）。
- E2E：`.venv-emu/bin/python tools/test-pager-sim.py --profile <id> --rpk <包>`（种子 12 条收藏、像素判据）。band9 布局验收用 `Vela_Band9V5`（192×490 1:1）；`Vela_Band9V4` 是 466 画布、`designWidth=device-width` 会放大 2.4×，只用于引擎/API 验证。

## 首页双栏网格 grid2（Pro 专属）

「首页样式」页在**网格非两列**的机型多出「双栏」选项（`'grid2'`）：Pro 可选三栏/双栏/单栏；band10/band9 网格本就两列，选项自动隐藏，页面与改前逐像素一致。

- **显隐判据只有一处**：`hset.ux` 的 `hasDual: HOME.cols !== 2`；选项行 `.optC` 带 `if="{{ hasDual }}"`；预览格用独立 `.miniCell2`（避开 Pro 的 16→10 替换对）。
- Pro 上样式页三行 top 92/216/340：`.optC` 基线 top 与 `.optB` 同写 216（band10 不渲染互不影响），Pro 靠替换对 `[".optB { top: 216px; }", ".optB { top: 340px; }"]`（整行精确对）移位；`.hint` Pro 上 `if="{{ !hasDual }}"` 隐藏。改任一行 top 时三行间距（卡高 116+8）一起对齐。
- 渲染与 grid 分支同构（`if` 门控 + scroll + flex-wrap，**不用 show**）；卡片 `.cell2` 基线宽 96 是占位，Pro 替换对 `["width: 96px", "width: 159px"]`（=(336−18)/2）；高度沿用 `.cell` 的 70→76 对；内容高走 `dualGridHeight()` = 固定两列 × `HOME.rowH` + `HOME.padBottom`。home.ux **禁出现 `function gridHeight` 前缀的本地定义**（test-profile 硬约束）。
- **文案防误伤**：pro336 对 hset.ux 有**不带引号**的全量替换对（双栏→三栏叫法），grid2 选项标题必须写 `g2Name: '双栏' + '网格'` 拼接；`set.ux` layoutName 的 grid2 分支同理（带引号替换对）。
- grid2 **全链路参与状态机**：四处归一化、`'homeStyle'` 记忆与还原、`layout.txt` 快标志都认 grid2。band10/band9 上该值永远不会被写入（选项隐藏），但状态机放行（渲染与 grid 一致），不按机型分流。

## 首页目标日不常驻模式

KV 键 `'todayAuto'`（默认关 = 常驻）。

- **关（常驻）**：首页顶部始终显示目标日卡；无目标日显示「记录一个目标日」占位。**开（不常驻）**：只有设定了目标日才显示卡；无目标日卡不渲染，空出的空间全给下方工具列表（三种布局顶到 y92 并加高）。
- 读写统一走 `src/utils/homeToday.js`（`read(cb)`/`toggle(cb)`）：首页 onShow 读、设置页开关写，**页面里别另写 `'todayAuto'` 字面量**；「恢复默认设置」要一起复位（`applyTodayMode(false)`）。
- 「没有目标日」= `homeEvents.load` 返回 `best` 为空（空列表、日期全非法都算）。
- 卡片隐藏用 `if="{{ showToday }}"`（容器型 show 动态翻转不可靠）；列表换 `.appsUp` 类：band10 `top 92 / height 394`，Pro 由 profile 替换对 394→348。394 = 常驻态 304 + 卡 88 + 2 间距；两态底部对齐（band10 486 / Pro 440）。改目标日卡高度同步这两个数。

## 首页长按工具管理（置顶/收藏/隐藏）

长按任意工具条目弹出操作页 `pages/toolact`（参数 `{ id }`）：置顶（≤4）/ 收藏（无上限）/ 隐藏。

- **KV 三键单一真源**：`pinApps`/`favApps`/`hideApps`，读写统一 `src/utils/homeTools.js`（read/togglePin/toggleFav/toggleHide），页面不各写 key 字面量。**隐藏自动移出置顶与收藏**（toggleHide 数据层收口，防残留）。
- 置顶/收藏是开关卡（整卡可点，开 = 卡底 `rgba(13,110,255,0.24)` + 右侧蓝「开」，关 = `#262626` + 灰「关」；状态字 `.swState` 宽 40/字号 16，不用 `<switch>`）。副标题由 `syncSubText()` 一处生成，别在回调各写一份。隐藏卡保持橙/红文字与「已隐藏/未隐藏」，不改开关。
- **显示规则**：`grid`/`grid2`/`list` 下置顶移首页最上方（按置顶先后），原位不再显示、后序补位；有收藏时「收藏功能」入口格（`__favtools__`）在置顶区后第一格 → `pages/toolfav`。`cat` 模式置顶以单栏条目在首页顶部显示，同时分类详情页照常显示（**双显示口径**，cats.js 零改动）；全隐藏分类保留显示「0 个工具」。收藏工具原位置照常显示（收藏只加快捷入口）。隐藏工具首页与分类页都不显示，管理入口 = 设置 → 隐藏功能（`pages/toolhide`）。
- **长按守卫**：主页/分类页/收藏页三处支持长按；分类行与 `__` 前缀占位行不响应。模块级 `lastLongAt` 守卫（800ms）：长按记录 `Date.now()`，`open(item)` 首行校验互斥，防长按抬手后系统补发 click 误进工具页。
- 三个页面（toolact/toolfav/toolhide）规范：不用 `data`（只用 protected+private）；可点元素 y≥92（R15）；并在 `src/manifest.json` 与 `profiles/pro336.json`、`profiles/band9.json` 完整登记。

## 设备 profile

源码基线 **band10**（212×520 跑道屏）；`pro336`（小米手环 9/10 Pro，336×480）、`band9`（小米手环 9，192×490，Vela 4）、`rw432`（REDMI Watch 5 / 5 eSIM / 6，432×514）是构建期物化的三个包体，同包名，rpk 文件名分别带 `.pro.` / `.band9.` / `.rw.` 段。

- `profiles/band10.json`（恒等基线）+ `pro336/band9/rw432.json`（逐文件替换表）是唯一真源；布局改动先改基线，再加非基线替换对，`tools/test-profile.mjs` 校验漂移。
- **令牌**：band9 `layout.companion.drawableH=436`（桌面伴侣画布高，非快应用画布）、`assets.shadow=[192,84]`；rw432 `home.cols=3`（rowH 86、padBottom 20）、`ime.kbW=432`（全宽非滚动 10 列键盘）、`assets.shadow=[432,84]`。键盘顶恒 y101 四机型一致，**禁往页面模板加 kbBar**。
- **rw432 真机可绘制高 = 全屏 514，底部几何按设计底 500**（模拟器底部 48px「系统底栏」是 `vela-watch-5.0` 镜像运行时自画的 UI，真机固件没有；band10 同款先例）：首页 `.apps` 182..500 / `.appsUp` 92..500、卡片/列表页滚动视口一律 `top + 418`、`.actRow` top 436（otp/edit 与 otp/detail 页面级底部行 380/448）。给 rw432 新增页面按 500 设计，**别回抄 band10 的 460/466 口径**；横屏旋转容器（466 宽）与键盘锚定（y101）暂未放宽。
- **仓库提交的源码永远 band10 基线态**：物化只在构建瞬间发生（make-release.sh 退出 trap 自动还原）；手动物化后 `node tools/apply-profile.mjs band10` 还原，提交前 `node tools/apply-profile.mjs --check band10`。
- 门禁 **R8**（树物化态 == `BANDBOX_PROFILE`）、**R9**（shadow.png 尺寸匹配 profile）、**R10**（计算器几何常量与 CSS 自洽；**页面内容高不在 profile 按机型估**——覆盖对会随排版陈旧，排版一致就共用一套常量）。`src/common/layout.js` 是生成文件勿手改（JS 侧布局常量由 apply-profile 生成）。
- 模拟器：Pro `Vela_BandPro`；band9 `Vela_Band9V4`（配方 `docs/band9-vela4-spike.md`，docs/ 不入库）；REDMI Watch `Vela_RedmiWatch`（432×514 `redmi_watch` 皮肤）。**V4 AVD 两个假象**：① 触摸 x<40 不注册（自动化点 x≥40）；② 布局视口高 466（y≥466 不绘制）。

## 桌面伴侣「精美样式」

设置页「精美样式」开关（KV `companionCfg.fancy`）：时钟页换表盘风版式——左侧自绘数字时间（固定 HH:MM，秒钟开关不作用），右侧信息列（周几+几号 / 目标日倒计时 / 分隔线 / 电量徽标），三机型同一套公式。

- **字形 = 反相遮罩位图 + 彩色底容器（唯一方案，禁 div 拼字形）**。每位数字 3 节点：`position:absolute` 的 `.fDigit` 容器（**恒黑底 #000000**）+ 内层彩色底 `.fInk`（运行时取色）+ `<img class="fMask" src="/common/images/fdm_N.png">`（正好铺满容器）。冒号是两个圆点 div。遮罩 PNG **RGB 恒纯黑、alpha = 255 − 墨迹 alpha**（合成 = 彩底 × 字形 alpha，任意 #RRGGBB 取色生效且保平滑边缘）。
- **页面底色必须保持纯黑 #000000**（遮罩黑底靠无缝）；将来改底色必须同步遮罩底色或换方案，否则露黑矩形。
- **上色时序**：4 张遮罩 `oncomplete` 全到（或 400ms 兜底定时器）才把 `digBg` 切成取色，否则闪彩色方块。
- **字形真源 `tools/gen-assets/gen.py`**（tools/ 不入库）：`--fancy-masks` 出 `fdm_0..9.png`（**图必须正好等于墨迹盒，禁黑边/留白**），实测宽抄进 `companionGeo.js` 的 `FD_SRC_W`；`--fancy-preview` 出三档预览对照图。
- `FD_CAP=190` **只缩不放**；`layoutFancy.maxH = min(floor(stripH×0.78), FD_CAP)`；显示宽 = **ceil**(FD_SRC_W×显示字高/FD_CAP)（盒子小于缩放宽会在左缘露 1px 缝）。
- **彩色底内缩 FD_INSET=1px（勿回退）**：`.fInk` 比容器左/右/下各内缩 1px（宽 fw−2、高 digitH−1），遮罩图正好铺满容器（fw×digitH）——兜住真机远边半纹素采样污染（右/下 L 形彩线，模拟器复现不出）与 band9 149px 缩放左缘半透细线。`tools/test-companion-geo.mjs` 已锁几何契约。
- **禁遮罩加黑边 / 图放大到容器外（负偏移）**——真机触发旋转容器里绝对定位子图的裁剪，数字被削块。
- **数字按各自墨迹宽紧排**（fw1..4 + l1..4），禁固定格宽（「1」两侧出空洞）。比例参数（归一化到字高，来自参考图实测）：墨迹宽 0.322 / 笔画粗 0.106 / 字距 0.0625 / 冒号点径 0.098 / 心距 0.32 / 白字墨迹高 0.144；`FD_R=26` 由 IoU 比对定（0.89~0.97），改形状先复核。
- 右栏宽 `infoW` = 三组最大宽，分隔线铺满、列内左对齐；`dateRatio=0.17` 按「中文字形墨迹只有字号 ~0.85」反推。时间行/右栏**绝对定位**（`.fTime`/`.fInfo` 用 left/top + timeTop/infoTop），非 flex space-between。`onInit()` 直接算好首帧（颜色/时间/日期），别只靠 onShow。
- 10 张遮罩约 19KB；**禁转调色板 PNG**（PNG8 发毛红线）。

## 键盘态「完成」栏在 InputMethod 组件内

Vela 4 渲染坑（V5 无）：① 同一父容器动态插入/show 翻转的节点**沉到静态兄弟之下**（组件边界是合成边界，组件子树整体盖在页面内容之上）；② `justify-content: flex-end` 分支自适应宽 `<text>` 测宽 0 不渲染。

- 「完成」栏 `.kbdone` 在 `InputMethod.ux` **组件内部**（根内容 = bar 32 + 拼音行 28 + 键盘 305 = **365px**，bar 顶 = 快应用画布高 466 − 365 = **y101**）；文本显式宽度 + `text-align: right`；点击经 **`close` 事件**交回页面（`@close="closeKb"` / `doneEdit` 接线）。
- **键盘顶恒 y101（三机型一致）**：键盘贴**快应用画布底 466**，不是「屏高 − 365」（屏高含底部系统栏 54/14/24px，键盘不吃那截）。
- **键盘态页面内容只能放 y76..100**（页头命中区 0..74 与键盘顶 101 之间 25px 的缝）；弹键盘后 y101 以下全被键盘盖住（z-index 不可靠），「弹键盘时要看的值」挪进缝里。
- **页面模板禁再加 kbBar**（theme.css `.kbBar` 保留但无使用者）；键盘态草稿卡翻转显示稳妥写 `if`。

## 统一数字小键盘 pages/numinput

全 App 共用的**整页**自绘数字键盘（随机数上下限/单位换算/密码长度等），取代页内挂 `<input-method>`（页内输入法贴画布底、键盘顶 y101，弹出就盖住正文只剩 y76..100 缝）。

- **调用**：`g.router.push('/pages/numinput', { field, title, value, type, allowNegative, allowDecimal, min, max, maxLen, hint })`。`type` 取 `'int'`/`'decimal'`；`allowNegative`/`allowDecimal` 传 `'0'` 关键（键面变灰）；`min`/`max`/`maxLen` 键盘页内校验（越界 toast），`maxLen` 是字符数上限。
- **回传双通道都要走**：键盘页点「确定」先写 `numInputSession`（globalThis 会话态快通道）**和** `inputResult`（一次性文件异步兜底），写成功才 `router.back()`；调用方 onShow 先 `numInputSession.take(field)`（同步；命中后 `inputResult.clear()`），没命中再 `inputResult.take(cb)`（异步读文件）。只靠内存会跨 bundle 丢结果，只靠文件有可见延迟。
- **定长字段传 `value: ''`**（预填当前值会在 maxLen 处把用户卡死），当前值放 `hint` 提示行；不限长字段随意。

## if/show 包装 div 必须带完整几何 CSS 类

带 `if` 的 div 必须有 CSS 规则（`position` + `left/top` + `width/height`），否则里面的绝对定位子元素不会被布局。band10/Pro/band9 引擎与 SDK 模拟器**宽容**，**小米手环 11 固件严格执行**（手环 11 输入框只出完成栏、按键区全空的根因）。

- 凡带 `if`/`show` 的包装 div 一律给带完整几何的 CSS 类（内联 style 不算数），不留「无 class 无 style」裸 div。
- 给包装层加 `position` 必须保持布局原点不变：Vela 绝对定位子节点挂**直接父节点布局原点**。InputMethod 的 `kbBody` 定位 `top:60px`（= 完成栏 32 + 拼音行 28）；**改成 top:0 会把整棵按键子树上移 60px**。
- 键盘组件根容器高写死 **365px**（不用 `auto`），overflow 恒 hidden。
- 新增包装层后跑三机型键盘态**像素对比**（band10/band9/pro336 各 7 张截图，`tools/cmp-shots.py`）。

## 页头与底部动作键

页头（`PageHead.ux`）整条是**返回命中区**（`.phHit` y0..74，点了 `router.back()`），**页头里不许放任何别的可点元素**：

- **动作键一律放页面底部**，通用样式 theme.css `.actRow`（band10 top 400 / Pro top 360，Pro 由 profile 替换对改）。底部多键时**主操作在上、次要/危险在最底**。
- 页头右上角「完成」多余：键盘态完成在输入法组件 `.kbdone`（y101..133 三机型一致）。
- **不能靠 z-index 摆平**（Vela 渲染器丢弃 zIndex，层序按文档顺序）；唯一稳的办法是**命中区与可点元素不重叠**。
- 门禁 **R15**（`scanHeaderOverlaps()` 扫全部页面 @click 绝对盒与 `.phHit` 求交，重叠拦下构建）；改页头命中区或动作键后跑 `node tools/release-gate.mjs --only-r15`。
- 键盘态（kbShow）输入法占屏幕底部 305px，底部动作键被盖：**带输入法的页面动作键要 `show="{{ !kbShow }}"`**（照 notebook/rename 既有做法）。

## 版本号同步

快应用版本号 **5 处一致**（脚本自动改，手改也要改齐）：`src/manifest.json` / `package.json` / `src/pages/about/about.ux`（`v<版本>`）/ `src/pages/set/set.ux`（`版本 <版本>`）/ `README.md` 顶部「版本：」行。R6 校验前三者与 README。

插件版本号（`plugin/bandbox-helper/{manifest.json,package.json,package-lock.json}`）只在**插件源码真改**时升。自 0.1.1 起插件与快应用**共用同一条版本线**：改快应用版本号时插件 4 处一起改（manifest / package / package-lock / `src/plugin.js` 的 `PLUGIN_VERSION`，build.mjs 构建期校验一致）。插件文档/注释**禁用版本阈值表述行为**（编号归一后 `0.1.1` 会被误读成旧包，改写成不依赖版本号的表述）。

## 冷启动减负：协议栈不进启动路径

- **`app.ux` 不得 import** `otpBridge`/`qrBridge`/`otpProtocol`/`otp`/`otpAccounts`/`otpStore`/`qrProtocol`/`qrFavStore`；启动路径只留 `src/utils/pushInbox.js` 薄缓冲层。
- **推送链路**：app onCreate 调 `pushInbox.init()` 订阅 interconnect，消息按 `app` 字段分 `otp`/`qr` 桶（歌词协议 `bandbox-lyrics` 不进缓冲，歌词页自订阅）。用户进页时桥接层 `init()` 调 `pushInbox.claim('otp'|'qr', handle)` 认领并原样回放，落库与回执照旧，数据不丢。**认领触发点（onShow）**：`otp/sync`、`otp/list`、`qrcode/fav`、`qrcode/import`；**新增 OTP/二维码相关页要在 onShow 补对应 init**。
- **状态挂 global**：页面独立 bundle、模块级变量不跨 bundle——`__bbPushInbox`/`__bbOtpBridge`/`__bbQrBridge`；otp 分片 `session` 必须全 app 只一份（挂法照 `global.js`/`perf.js` 先例）。
- 已知可接受行为变化：插件侧「手环在线 · N 个账户」显示推迟到首次进 OTP/二维码页。
- **别把 `announceReady` 节流单位改回毫秒**：`lastAnnounceAt` 统一用 `otp.epochSeconds()`（秒）；毫秒/秒混用会让自己的节流把就绪广播挡掉，插件侧永远等不到 ready。
- 模拟器无 logcat 服务：测冷启动走「埋点写 `internal://files/bandbox/perf.txt` → `adb shell cat /data/files/<pkg>/bandbox/perf.txt`」。

## 记忆存储

本项目所有需要「记住」的约定、决策、约束与进度统一写入 **PowerContext**（`powercontext-project-context` 技能的 `remember_memory`，scope 用 `resolve_scope_binding` 解析出的绑定），保证跨会话、跨助手共享；不要只写在本地文件或聊天里就当作已记住。本文件只写规则、约束与操作口径；历史决策、事故经过、失败试验记录不在这里展开。

## 加速度计订阅必须走 accelHub

`@system.sensor` 实测语义：**全局单订阅槽**（被占时后续 subscribe 被静默忽略，不 fail 不抛错）；`unsubscribeAccelerometer()` 是**全局退订且异步落定**（紧跟的新订阅会被一起杀）；已注册回调**持续收帧、与页面可见性无关**。

- **任何页面不得直接调 subscribe/unsubscribe**；跨页面共享传感器一律 `src/utils/accelHub.js`：订阅只做一次、由栈底传感器页持有（封面 `ensureSubscribed()`），帧经消费者槽转发。页面 onShow `setConsumer` 挂处理器（引用存模块级变量）、onHide `clearConsumer` 摘（引用比较防误摘），onHide/onDestroy **不退订**（只有持有页 onDestroy 才 unsubscribe）。
- 独立叶子页（邻居页不订阅）可维持 onShow 订阅/onHide 退订；一旦与其它传感器页共存于同一路由栈必须迁 accelHub。
- 摇一摇内核 `src/utils/motionShake.js`（迟滞边沿 + 双甩配对 + 冷却 + 静默窗 + 上膛窗）；单测 `node tools/test-motion-shake.mjs`；E2E `tools/shake-sim.py`（gRPC 注入 z 轴甩动，不转屏）。

## 字号与图标清晰度

对标 Hyper Box（图标简洁、文字又大又清晰）；手环 1.6" 屏 1 CSS px = 1 物理像素，**R18/R19 会拦回退**。

### 字号

- **硬底线 14px（R18）**：`src/**/*.ux` 的 `font-size` 字面量 <14px 直接 fail；唯一白名单 `input.ux` 的 `.nlT`（30×24 按钮里的换行符字形）。
- **目标线 15px**：提示/说明/副标题优先 15px；放不下**先删字**，仍放不下才落 14px。
- **高频面**（已抬过别压回）：首页网格标签 18px/行高 24、图标 32×32；列表/分类/收藏/隐藏行名称 19px、副题 15px；页头标题 18px、时钟 16px；设置页与工具管理卡标题 18px、副题 15px；theme.css clock 16 / title 18 / cardTitle 18 / btnText 15 / hint 15 / actRowT 16。
- **文字色三档**：主 `#FFFFFF`、次 `rgba(255,255,255,0.72)`、提示 `rgba(255,255,255,0.55)`；正文/提示**不得低于 0.55**；0.45 只给占位符，0.3 左右只给禁用态/纯装饰（R19 对独立 `color:` 白透明度 <0.4 提醒不阻断）。
- **行高**：单行 `line-height ≥ font-size+4`；盒子高 ≥ 行高；字号/几何一律整数。
- 改字前先看盒子：20px 行能放 14px；16px 紧凑行放 14px 要目检裁字；改盒子高度同步 `INNER_H`/`CARD_COUNT`（R17 会拦）。

### 图标规格

- **44×44 RGBA8、4× 超采样 + LANCZOS；禁 PNG8 / 调色板**。
- 线宽：主描边 6px、内部细节 5px、**最小 4px**；圆点半径 ≥2.2；**禁 2~3px DIM 辅助线**（首页按 32px 显示，只剩半像素噪点）。
- 配色：近白 `#E8EEFF` 主色 + 蓝 `#4E87FF` 点缀；单个图形最多一处蓝。
- 显示尺寸：首页网格 **32×32**（`home.ux` 的 `.icon`）；列表/分类/工具管理行 34×34；**只缩不放**（显示尺寸不得大于源图）。
- 答案之书封面用专用 `answerBig.png`（88×88 源图按 66 显示）；**禁把 44 源图拉到 66**（全项目唯一放大位，必糊）。
- 改图标后先跑 `python3 tools/gen-assets/gen.py --icon-preview`（44/32/34 三档铺 #1A1A1A），32px 档确认再打包。生成器 `gen.py`（34 个 icon_* + answerBig）/ `gen_cats.py`（9 分类）/ 8 个单图脚本共享 `MIN_W/DET_W/INK_W`，改线宽只改常量。

## 内存与重启缓解

Vela 部分系统接口隐性内存泄漏且无内存/fps 查询 API；必须压低系统接口调用频次、原生回调持有、常驻对象体积与每秒分配抖动：

- **KV 一进程读一次盘（`utils/kv.js`）**：`init()` 只在 `!ready` 时读盘，就绪后走内存；`reload(cb)` 显式逃生口。读盘返回若 `dirty||writing||pending` 只把磁盘值合并进未写过的键（防启动早期页面先写被冲）。`set/remove/reset` 递增 `rev()` 供派生缓存失效。
- **docs 跨 bundle 缓存（`utils/docs.js`）**：全局 `__bbDocsRev` 在 save/remove/rename 成功后递增；`list(dir)` 缓存 `{dir,rev,docs}`（命中返回 slice）、`read` 缓存最后一份 `{uri,rev,text}`。`pages/lyrics/**`、`pages/notebook/**` **禁直接调 g.fs.writeText/remove/rename**，一律走 docs。
- **互联层单例（`interconnectCore.js` + `interconnect.js`）**：状态挂 `globalThis.__bbIC`；同一 connect 实例只绑一次 onmessage/subscribe/onopen/onclose/onerror（`boundConnect === connect` 守卫，1006 断连重建也只绑一次）。`otpBridge.disarm()` 在 otp/list、otp/sync 的 disarm()（onHide/onDestroy）中调用，防全局回调长期持有页面闭包。
- **页面栈上限 5 层 + 溢出状态胶囊（`router.js` + `navStore.js`）**：`MAX_STACK=5`；第 6 页入栈时 `pageLife.currentFrame()` 抓 route/params、页面可选 `snapshot()` 抓状态，`navStore.freezeCurrent()` 写 RAM 热环再 `replace()` 销毁父页；`back()` 发现父帧冻结用 `replace(parent.route, parent.params)` 重建并 `restore()`。正常栈深仍走原生 push/back。
- **页面小睡 Nap / preNap（`pageLife.js`）**：每页必须 `export default life({...})` 包装导出；模板根 `<div class="page">` **内部**必须有 `<div class="napWrap" if="{{ awake }}">`（theme.css 同尺寸几何；4 个不引 theme.css 的全屏叶子页豁免）。**`if="{{ awake }}"` 不能放页面根节点上**（Vela scene root 不能是 DomIfFragment，否则 `scene or root_ or app_ is null` 新页不显示）。Vela 不处理隐藏页的 awake 更新，所以 `router.push` 原生 push 前调 `preNap(len)` 卸当前页 UI 树；返回时 onShow 置 awake 重建（落在转场动画内）。**栈深 <3 不睡**（2026-11-28 真机修复：整树重建比返回转场慢，返回会先黑屏一瞬再亮起；首页与一级页 UI 树常驻、返回秒显），栈深 ≥3 才卸当前页，常驻 UI 上限 3 棵（深层栈越深睡得越多）；`memNap=0` 一键关闭 preNap。**小睡占位层**：napWrap 旁必须有反相门控的 `<div class="napWrap" if="{{ !awake }}"><text class="napLoadT">加载中…</text></div>`（同屏互斥，零新增替换对——`.napLoadT` 的 `width: 212px` 由 theme.css 裸字面量对自动物化成各机型宽），深路径返回重建期间显示「加载中…」而不是整屏空黑（2026-11-28 用户要求，防误以为重启）；R21 强制两者齐备。
- **自动续页已整体移除（2026-11-28）**：曾有「双槽会话日志 + 崩溃续页」（`home.resumeLast()` 冷启动恢复到最后页面），因手环正常退出（表冠/划掉）经常不触发 onHide 或进程先于异步落盘被杀，「已进后台」标记赢不了系统杀进程 → 正常退出被误判成崩溃、重开直接跳回最后页面，误报远多于真崩溃，用户判定明显不合理。**重开恒回首页**；navStore 是纯内存虚拟帧栈 + RAM 胶囊（无任何磁盘状态），R22 会拦续页接口复活。**页面不得直接 import navStore**（经 `globalThis.__bbNav` 访问）。
- **返回拦截**：`life()` 给每页加 `onBackPress`，非首页/栈深>1 返回 true 并延后一拍 `g.router.back()`（`$valid`/栈深检测防双弹）；`navBackPress=0` 可关闭。门禁 **R21**（根节点 napWrap/awake、小睡占位层 !awake、life 包装、禁 show 代替 if）与 **R22**（MAX_STACK=5、freeze/thaw、preNap/wakePrevious、navStore 只允许 app/router 引入）随 R1~R20 一起跑，支持 `--only-r21`/`--only-r22` 单独自查。
- **高频计算与长亮**：`otpStore.list()` 按 `g.kv.rev()` 缓存 normalized 列表；`otpState.resolve()` 缓存 TOTP 成功态（键含 id/secret 尾6位/摘要/counter/period/digits/algorithm，上限 64 超限清空）；otp/list 与 otp/detail 每秒只重算 remaining；`pushInbox.classify()` 先 `'"bandbox-otp"'`/`'"bandbox-qr"'` 字面量过滤再 JSON.parse；companion/clock 精美样式或关秒走整分 +20ms 对齐 minuteTimer；historyData 月份缓存 LRU ≤3；performance.ux 测试链用 runTimer+runSeq 并在 onHide/onDestroy `cancelRun()`。
- **门禁 R20**（支持 `--only-r20`）：① `@system.file` 只允许 utils/fs.js、utils/kv.js；② `@system.interconnect` 只允许 utils/interconnect.js；③ 含 `setInterval(` 的文件必须含 `clearInterval(`；④ lyrics/notebook 禁直接 g.fs 写删改。

## 其它硬约束（勿破坏）

- 发行包**不带性能埋点**：`src/utils/perf.js` 的 `ENABLED` 恒 false，`src/app.ux` 不得 import 埋点模块（R2 拦）。
- 页面对象**不得同时出现 `data` 与 `private`**（Vela 运行时抛错、页面黑屏）。
- **禁 `tools/png8.mjs` 转换带抗锯齿边缘的 UI 小图**。
- `src/utils/{otp,otpAccounts}.js` 与 `plugin/bandbox-helper/src/` 下同名文件必须逐字一致（cross 测试按 SHA-256 校验）。
- **包名六处同步**：`src/manifest.json` 的 `package` + `src/utils/{otpProtocol,qrProtocol}.js` + `plugin/bandbox-helper/src/{protocol,otpProtocol,qrProtocol}.js` 的 `TARGET_PKG`（插件靠包名寻址手环应用，漏一处手机侧收不到消息；改后跑 `node tools/test-otp-cross.mjs`）。
- 提交/打包前源码树必须 band10 基线态（`apply-profile.mjs --check band10` 通过），不得把物化态提交进仓库。
- 合规红线：无激活/付费/引流、无第三方闭源依赖、无内置字库、数据全部自建或公共领域改写。
