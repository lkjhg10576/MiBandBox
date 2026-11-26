# BandBox 仓库约定

面向所有在本仓库干活的助手（AI 或人）。这里只写**必须照做**的约定，不写项目介绍。

## 打包与发行（2026-11-08 起，2026-11-15 改打包模式，不要自行改动）

本项目有两条构建通道，版本号策略与产物目录不同，**打包模式也不同**：

| 通道 | 什么时候打 | 打包模式 | 版本号 `versionName` | `versionCode` | 产物目录 |
|---|---|---|---|---|---|
| **Beta** | 用户**没有特殊要求**时的默认动作 | development（`aiot build`） | **默认不变**（仅用户明确要求时升） | **+1** | `beta/BandBox-<版本>-<versionCode>/` |
| **发行版** | 用户**明确要求**「打包一个新发行版」 | production（`aiot release`） | **升** | **严格递增取号** | `release/BandBox-<版本>/` |

- **Beta 的定位是「下个版本的测试」（2026-11-16 用户定，照此执行）**：Beta 打的不是已发布版本的复刻，而是**下一个版本号的测试包** —— 所以 Beta 的 `versionName` **可以比当前发行版更高**（例如发行版是 0.1.1、Beta 可以是 0.1.2），这是正常的，不是版本错乱。
- **但版本号不是每次 Beta 都升**：默认只升 `versionCode`（+1），`versionName` **保持不变**；**只有用户明确要求升版本号时**才动 `versionName`（如「打个 0.1.3 的 Beta」）。判断口径：**没明确说，就只升 versionCode**。
- **升版本号时 `versionCode` 照旧 +1**（Beta 通道）—— 版本号与 versionCode 是两件事，别混着改。

- 两条通道的产物内容一致：**每个设备 profile 一个 rpk**（jsc 字节码）+ `BandBox辅助.abp`（插件源码现编，全 profile 共用一份）+ `SHA256SUMS.txt`（覆盖全部 rpk）+ `说明.md`（注明各 rpk 适用机型）。
- **打包模式差异（2026-11-15 起）**：发行版走 production 模式 —— JS 压缩混淆、剔除 `.map`、用发行证书签名；Beta 走 development 模式，不压缩不混淆。
- **rpk 文件名里的 `.debug.` / `.release.` 段只表示打包模式，不是包名**。包名始终是 `com.lkjhg.bandbox`，`manifest.json` 的 `config.debug` 为 `false`；工具链按编译模式拼文件名（`ZipUtil.js`：`mode === DEVELOPMENT ? 'debug' : 'release'`）。别再把它当成「debug 包」。
- **发行证书（2026-11-15 换源后）**：`production` 模式按 `sign/release/{certificate.pem,private.pem}` → `sign/{certificate.pem,private.pem}` 的顺序找证书（`sign/` 已被 `.gitignore` 忽略，私钥绝不入库）。**发行版必须用自签发行证书，且证书 CN 必须等于包名** —— 工具链自带的默认证书（`CN=localhost`）是 debug 证书，缺证书时**绝不允许**再兜底复制它。生成：`bash tools/gen-release-cert.sh`（CN 自动取 `src/manifest.json` 的包名，同时镜像到 `sign/debug/` 供 development 模式用同一张证书）。历史包用的 `CN=localhost` 证书已退役（挪到 `sign/legacy-cn-localhost/`，不在查找路径上）。
- **证书 subject 必须带齐 7 项（2026-11-15 补齐，勿删字段）**：官网「生成证书」要求签名文件含 **国家名称 `C` / 省份 `ST` / 城市 `L` / 组织名称 `O` / 组织单位名称 `OU` / 名称与姓氏 `CN` / 邮箱地址 `emailAddress`**，缺一项就不构成合格的签名文件。当前值：`C=CN`、`ST=Tianjin`、`L=Tianjin`、`O=BandBox`、`OU=lkjhg10576`、`emailAddress=17726063360@163.com`、`CN=com.lkjhg.bandbox`（CN 必须等于包名）。省份/城市用拼音（平台侧按 ASCII 解析最稳）。改这些值用 `CERT_ST=… CERT_L=… CERT_OU=… CERT_EMAIL=… bash tools/gen-release-cert.sh --force`。
- **换证书优先「只重签 subject、不换私钥」**：`--force` 默认**沿用现有私钥**重签（公钥不变 → 签名身份不变 → 老用户可覆盖升级、平台侧指纹不冲突）；只有明确要换签名身份时才加 `--new-key`（老用户须卸载重装、本地数据会丢）。门禁 **R12** 与 `tools/verify-rpk.mjs` 都会核对 7 项齐全，缺项直接拦下。
- **不再产出 zip 压缩包**。`release/*.zip` 是 0.4.x 时代的历史遗留，不要再生成新的。

### 换源：包名 + 签名证书（2026-11-15 起，勿回退）

分发平台把 0.1.1 发行版打回，理由两条 —— **「用了 AIoT 的 debug 证书签名，不是 release 包」**与**「包名不符合反向域名（Java 包命名）规范」**。处理如下：

- **包名**：`com.miband.bandbox` → **`com.lkjhg.bandbox`**。旧名反写域名是 `bandbox.miband.com`，`miband` 是小米自家品牌域名，三方应用占用该命名空间会被判包名不正确。新名满足反向域名规范（小写、点分段、每段字母开头、≥3 段）。包名真源只有一处：`src/manifest.json` 的 `package` 字段。
- **包名必须三处同步**：`src/manifest.json` 的 `package`、`src/utils/{otpProtocol,qrProtocol}.js` 的 `TARGET_PKG`、`plugin/bandbox-helper/src/{protocol,otpProtocol,qrProtocol}.js` 的 `TARGET_PKG`。手机插件靠包名寻址手环应用（`sendQaicMessage(addr, TARGET_PKG, …)`），不同步就收不到消息。改包名时六处一起改，并跑 `node tools/test-otp-cross.mjs`（双端常量一致性）。
- **证书**：自签发行证书，CN = 包名，subject 带齐 7 项（`bash tools/gen-release-cert.sh`，`--force` 只重签不改私钥）。门禁 **R12** 会核对：证书存在、CN 不是 `localhost`、CN == 包名、subject 7 项齐全；打包脚本也会再核一遍，缺证书/CN 不符/字段缺失直接中止构建。
- **老包怎么办**：`0.1.0`（`com.miband.bandbox`）已下架。换包名 = 平台上是**另一个应用**（控制台的包名不可改，需按新包名重新创建应用条目）；手环上新旧包可共存，互不覆盖，老包的数据要自己从旧应用里看。
- **版本号**：本版沿用 `0.1.1` / `versionCode 256`（换源的是身份，不是版本）。


### versionCode 必须严格递增（2026-11-15 起）

发行版的 `versionCode` **不再沿用当前号**，而是取「所有已构建产物用过的最大号 + 1」：

- **为什么**：分发平台按「包名 + versionCode」判新旧，同号会被当成旧包拒收；手环覆盖安装同理（同号不一定能覆盖，会被系统拦下）。0.1.1 发行版原本沿用 255，而 255 已被 Beta 0.1.0-255 用过 —— 上传分发平台时被直接拒收。
- **怎么取**：脚本扫 `beta/*/说明.md` 与 `release/*/说明.md` 里出现过的所有 `versionCode`，取最大号 +1；发行版重建时排除它自己的目录，所以同一个发行版反复重建拿到的号不变（重打的包还是同一个号），但一定大于其它任何产物的号。
- **`--code <n>`** 可以显式指定 versionCode，覆盖默认取号策略。
- 改了发行版通道的取号规则后，**AGENTS.md / README 的通道表要同步改**（发行版一栏的 versionCode 列写「严格递增取号」）。
- **换源例外（0.1.1）**：换包名后平台上是新应用，`0.1.1` 用 `--code 256` 显式沿用旧号（旧包 0.1.0 已下架、256 从未成功上架，不与任何在架版本撞号）。从 0.1.2 起恢复「最大号 + 1」取号。

### 上架分发平台（2026-11-15 起）

分发平台只认**包内 `manifest.json` 的 `versionName`/`versionCode`**，控制台不改已签名包的版本（改任一字节都会让手环验签失败、装不上）。所以：

- 上架前必须确认**控制台填的版本 == 包内版本**，用 `node tools/verify-rpk.mjs <rpk>` 查（会打印包内版本号、包名、证书 subject 与验签结果）。
- `make-release.sh` 出包后会自动逐个跑 `tools/verify-rpk.mjs`（校验签名完整性 + 包内版本 + 包内包名 + 证书 CN + 证书 subject 7 项齐全），不过即中断构建。
- 平台已登记的版本号要小于新包的 versionCode；被拒时先查是不是撞号。
- **换源后要在平台按新包名重新创建应用条目**：控制台的包名一旦确认不可更改（换包名 = 新应用），旧条目（`com.miband.bandbox`，0.1.0）已下架。
- **`downloads/` 里的包体必须本地先入库，控制台不会替你写（2026-11-21 打回后补）**：控制台的「更新仓库 manifest 与资产」只写 `manifest_v2.json` 与 `media/` 里的图标/头图/预览图，**不上传 `downloads/*.rpk`**；它只在清单里写 `downloads.<机型>.file_name`（仓库内相对路径），审核按 `resource.csv` 钉住的 `repo_commit_hash` 去那个提交里找文件，找不到就打回「manifest downloads 文件存在性 · 缺失文件」。**上架新版本的顺序**：出包 → 把要上架的包**按原文件名复制进 `downloads/`**（`.gitignore` 已用 `!downloads/*.rpk` 放行入库）→ 提交并推送 → 控制台再编辑/提交 → `node tools/astrobox-sync.mjs` 把控制台写的清单拉回本地（`--check` 校验引用完整性）+ 门禁 **R13** 复查。详见 `notes/astrobox-submit.md`。

- 打包命令：

  ```bash
  # Beta（默认，development 模式；版本号不动，只升 versionCode）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta
  # Beta（三包：band10 + band9 + pro336 一次出齐，同一产物目录）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta --all-profiles
  # Beta（用户明确要求升版本号时：--ver 升版本号，versionCode 照旧 +1）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta --ver 0.1.3 --all-profiles
  # 发行版（production 模式，产物文件名带 .release. 段）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --release <版本> --notes notes/<版本>.md --all-profiles
  # 发行版临时退回 development 打包（排查用，默认不启用）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --release <版本> --dev-build
  ```

  本机必须带 `copyfile-shim.cjs` 垫片，否则 `build:jsc` 会被沙箱的 `copy_file_range` 拦成 `EPERM`。
- **`--ver <版本>`**：只在用户**明确要求**升版本号时才传。传了就同步升 `versionName`（快应用 5 处 + 手机插件 4 处，见「双端版本号对齐」）；不传就只升 `versionCode`。
- 发行版的版本提要写 `notes/<版本>.md`，脚本会自动插进产物目录的 `说明.md`。
- `--prune` 只清 `release/` 下的旧发行版**目录**，不动历史 zip，也不影响 `beta/`。

## 插件上架 AstroBox 官方插件源（2026-11-21 起）

手机端插件（`plugin/bandbox-helper/`）走的是**另一套**上架流程，与上面快应用的
「资源仓库 + 控制台」完全不同，细节见 `notes/astrobox-plugin.md`：

- **官方插件源仓**是 `AstralSightStudios/AstroBox-NG-Plugin-Repo`，它的 `index.txt` 每行是一个
  **作者仓库的 raw 基地址**；Action 每 4 小时抓各作者仓的 `manifest.json` 汇总成 `index.json`，
  客户端读它 = 插件市场。**上架动作 = 往那个 `index.txt` 末尾追加一行**（末尾斜杠必须留），
  提 PR 即可，不用控制台。
- **真源在 AtomGit**：插件仓 `atomgit.com/gcw_MchqrexB/bandbox_helper`，用平台的仓库镜像功能
  单向 push 到 `github.com/lkjhg10576/bandbox_helper`（市场只认 GitHub raw；国内连 GitHub 慢，
  所以推代码走 AtomGit）。**GitHub 镜像仓必须公开、分支名必须是 `main`** —— 分支叫 `master`
  会 404，插件在市场里静默消失。
- **发布目录三件套必须同目录**：`manifest.json` + `entry`(wasm) + `icon`，缺一个客户端下载就失败。
  `scripts/build.mjs` 现在会把 manifest 与 icon 一并拷进 `dist/`，使 `dist/` 本身即发布目录。
- **发布命令**：`cd plugin/bandbox-helper && node scripts/publish.mjs`（构建 → 同步 → 推 AtomGit →
  轮询校验镜像）。改插件后重跑同一条；`manifest.json` 的 `version` 要升，市场才认新版本。
- 国内 `gh` 走 git 协议克隆极慢，**用 `gh api` 的 `/contents` 与 `/pulls` 提交**（细节见 notes）。

### 产物不许手改：签名后改包 = 手环拒装（2026-11-17 起）

**事故**：0.1.1 发行版的**标准版包**（`com.lkjhg.bandbox.release.0.1.1.rpk`，手环 10 / 10 NFC）正常构建并签名后，又被二次改写 —— 包根被塞进 `BandBox辅助.abp` 与 Pro 版 rpk 两个多余文件，**rpk 签名块（`RPK Sig Block 42`）被挤没了**。结果：手环直接拒装，渠道也判「不是 release 包」。Pro 版包与插件自始至终没被动过。

- **别被表象骗了**：这个包**是** jsc 字节码版（`app.jsc`、`pages/*/*.jsc` 都是真字节码），装不上是因为**签名没了**，不是没走 jsc。排查先跑 `node tools/verify-rpk.mjs <rpk>`。
- **只污染了一份副本**：`release/BandBox-0.1.1/` 里的是坏的那份；`downloads/`（平台下载入口 `xmb10` / `xmb10nfc` 指向的文件）保存着未被改写的原包。已用 `downloads/` 的原包（`26a144cb…`）**还原**发行目录里的标准版包 —— 发行目录与平台下载入口现在是同一份字节。
- **签名后的 rpk 一律不许手工改**（不 unzip 重打包、不往里塞文件、不改任何字节）。rpk 的签名块夹在文件区与中央目录之间，任何二次写入都会让它失效。要改内容就**重新出包**。
- **三道防线**（都已落地）：
  1. `tools/verify-rpk.mjs` 新增判据 —— 包内出现 `.rpk`/`.abp`、包根出现非 `app.jsc`/`manifest*.json` 的文件，直接判失败；
  2. `make-release.sh` 在**产物落盘后**再跑一遍验签 + `sha256sum -c`，退出前把落盘状态核死；
  3. `tools/release-gate.mjs` **R14**：每次构建前扫描 `release/`、`beta/` 下所有产物，签名块缺失 / 包内混装 / `SHA256SUMS.txt` 与磁盘对不上，一律拦下构建。
- **校验和就是防篡改的凭据**：`SHA256SUMS.txt` 与产物必须成对生成、成对使用。产物被动过 → 摘要对不上 → 上架前就能发现。改完产物一定要重新生成 `SHA256SUMS.txt` 与 `说明.md`（`node tools/make-notes.mjs <目录> …`）。
- **手机插件 `.abp` 是独立产物**，只放在产物目录里给用户单独安装，**绝不塞进 rpk 内部**。

## 首页工具分类模式（2026-11-18 起，勿破坏）

工具已增到 40 个，首页双栏网格要滚 20 行。「设置」页有独立一张**「工具分类」开关卡**：打开后首页改为单栏显示 9 个工具类别，点进类别再单栏显示该类工具（两次点击直达），关闭则回到上次记住的网格/列表样式。

- **分类成员关系的唯一真源是 `src/data/cats.js`**（9 类 / 40 工具）。`src/data/apps.js` **一律不加 `cat` 字段** —— 它的数组顺序是模拟器脚本（`tools/shoot-routes.py` / `motion-sim.py` / `cube-sim.py`）的 index 导航依据，也是 `tools/perf-audit.mjs` 的节点计数依据；两处各写一份成员必然漂移。类别详情页 `src/pages/toolcat/toolcat.ux` 的路由是 `pages/toolcat`，用 `protected: { cat }` 收类别 id。
- **布局状态机是四态**：`app.ux` 的 `normalizeLayout` / `src/utils/layoutFlag.js` 的 read+write / `home.ux` 的 `applyLayout` 都认 `'grid' | 'grid2' | 'list' | 'cat'`（`grid2` = Pro 专属双栏网格，见下一节）。分类模式复用既有的布局状态机（模块闭包 `layoutState` + KV `'home'` 键 + `layout.txt` 启动快标志 + watcher），**不另建一套**。另加一个 KV 键 **`'homeStyle'`** 记住上次的非分类样式（开关关闭时还原用，grid2 也参与）。
- **三写范式**：任何布局变更都要 `app.setHomeLayout(mode)` → `layoutFlag.write(mode)` → `g.kv.set('home', mode)` + `g.kv.flush()` 三处同写。`set.ux` 的「恢复默认设置」**必须补 `layoutFlag.write('grid')`**，否则恢复默认后重启会先按旧标志闪一帧旧布局再被 KV 纠正。
- **设置页的开关卡不能换成 `<switch>`**，沿用项目既有开关语言（内联 style 三元 + 文字「开/关」，见 `calculator.ux` 的 `.swRow`）。设置页现在六张卡（首页样式 / 工具分类 / 隐藏功能 / 目标日不常驻 / 关于 / 恢复默认），内容高 `6×(76+8)+48=552` 超出两机型的 body（band10 418 / Pro 358），所以 `.body` 是 `<scroll>` + `.inner`（照 `about.ux` 的结构）—— **别再改回普通 `<div>`**，否则 Pro 上后两张卡会被裁掉。**`.inner` 必须显式给高度**（`style="height: {{ innerH }}px;"`），见下一节。
- **`src/pages/set/set.ux` 里的 `'双栏网格'` 字面量带单引号**（pro336 的替换对 `["'双栏网格'","'三栏网格'"]` 靠它命中）；**全文件严禁出现 `'三栏网格'`**（否则 test-profile「replace 不得在基线出现」直接 fail）。字面量只允许出现在 `layoutName()` 与 `data` 默认值两处。grid2 的显示名必须写 `'双栏' + '网格'` 拼接（见下一节），**注释里同样不许出现替换串原文（find 或 replace 都不行）**——test-profile 按整文件子串匹配，注释也会命中，本次构建期被拦过一次。
- **工具数只有一个口径 = `src/data/apps.js` 的条目数**（当前 **40**）：头图、README / README_EN、发布说明里写「N 个工具」都以它为准，改工具时这几处同步改。两个容易数错的：**「进制转换」不是独立工具** —— 它是「单位换算」里的第 13 类（`src/pages/unitconvert/unitconvert.ux` 里的 `radix` 卡），不进首页网格、不占名额；**「体感手枪 / 空气投篮」是同一个工具**「体感游戏」。版本线口径：0.1.0 正式版 32 → 0.1.0 Beta 线 37 → **0.1.1 = 37**（换源 + Pro 适配，未加工具）→ 0.1.2 = **40**（魔方计时 / 桌面伴侣 / 快捷色卡）。
- **门禁 R16**（工具分类表完备性）：`tools/release-gate.mjs` 每次构建前核对 `cats.js` 的成员并集 == `apps.js` 的全部工具 id，且无重复 / 无未知 id / 图标文件真实存在。新增工具**漏挂分类**在该工具从分类模式里彻底消失，而分类模式默认是关的 —— 运行期毫无症状，只有用户打开分类模式才发现。所以这是构建期硬约束，不是可选检查。（更详细的诊断脚本是本地工具 `tools/test-cats.mjs`；`tools/` 整目录不入库，所以门禁里的实现必须自包含。）

## 滚动内容高约定（2026-11-22 起，勿破坏）

Vela 的 `<scroll>` **必须显式给内容高**（子容器给 `height`）。不给就按视口高裁内容：
卡片被 flex 压扁（标题与副标题挤成一团）、整页滚不动；长文本（输入框预览、摩斯电码、
歌词、笔记正文）超出视口的部分更是既滚不到也看不见。
2026-11-22 用户在设置页报的就是这个（设置项增多后整页挤在一起、看不到后面的设置项）。

- **卡片列表页（设置页 / 功能设置页）**：`src/pages/set/set.ux` 与
  `src/pages/toolact/toolact.ux` 的 `INNER_H = 信息卡 + CARD_COUNT ×(CARD_H+CARD_GAP) + PAD_H`，
  绑到 `<div class="inner" style="height: {{ innerH }}px;">`。常量与 CSS 的对应关系：
  `CARD_H` = `.card` 高、`CARD_GAP` = `.card` 下外边距、`PAD_H` = `.pad` 高、
  `CARD_COUNT` = **模板里 `.card` 的个数**。
  **新增设置项要改 `CARD_COUNT`**，否则最后几张卡滚不到；`.card` / `.pad` 一律 `flex-shrink:0`
  （常量与 CSS 对不上时宁可裁掉尾巴，也不压扁文字）。
- **`PAD_H = 48` 不是随手取的**：设置页 `.body` 的视口底（band10 82+418=500）超出画布底 466，
  末尾留白保证滚到底时最后一张卡完整落在可绘制区内。
- **长文本页按字数估算**：`src/utils/textMetrics.js` 估算文本折行后的高度（字宽分档 + 1.08 安全系数
  + 多给一行，**宁可高估留空白，不要低估把文字底部裁掉**），页面把它绑到内容容器的 `height`。
  文本框宽度随 profile 变，宽度令牌在 `profiles/*.json` 的 `layout.text`（由
  `tools/apply-profile.mjs` 生成进 `src/common/layout.js` 的 `TEXT`）：
  `inputW` / `inputMultiW`（输入页预览框）/ `morseW`（摩斯电码框）。
- **门禁 R17**（滚动内容高自洽）：`tools/release-gate.mjs` 每次构建前核对
  ① 所有纵向 `<scroll>` 的直接子容器都有显式高度（CSS 类给 `height` 或 `style` 里给）；
  ② 卡片列表页的常量与 CSS 一致、`CARD_COUNT` == 模板里 `.card` 个数、`.inner` 有显式高度、
  `INNER_H` 算式用上了 `CARD_COUNT` / `PAD_H`、`.card` 带 `flex-shrink:0`；
  ③ profile 的 `layout.text` 宽度令牌与 CSS 里的文本框宽度一致 —— 任一条不符直接拦下构建。
  **已知未修的页面记在 R17 的 `R17_EXEMPT` 表里**（同一类缺陷，逐页收口；修好一页删一行）：
  歌词正文 ×3 / 笔记正文 ×2 / 口令设置卡片 / 收藏列表与详情 / WiFi 表单。
  （另：`parseUxTemplate` 解析前会先去掉 HTML 注释 —— 注释里出现 `<text>` 这类字面量会把标签配对打乱。）

## 首页双栏网格模式 grid2（2026-11-21 起，Pro 专属，勿破坏）

「首页样式」页（`src/pages/hset/hset.ux`）在**网格不是两列**的机型上多出一个「双栏」选项（模式值 `'grid2'`）：Pro（三栏）可选三栏 / 双栏 / 单栏；band10 / band9 的网格本就是两列，选项自动隐藏，页面与改前逐像素一致。

- **显隐判据只有一处**：`hset.ux` data 的 `hasDual: HOME.cols !== 2`（`layout.js` 按 profile 生成，Pro cols=3）。选项行 `.optC` 带 `if="{{ hasDual }}"`；预览格用独立的 `.miniCell2`（与 `.miniCell` 分离是为了避开 Pro 的 16→10 替换对，Pro 上保持 2×2 大格预览）。
- **Pro 上样式页三行 top 92/216/340**：`.optC` 基线 top 与 `.optB` 同写 216（band10 不渲染、互不影响），Pro 靠替换对 `[".optB { top: 216px; }", ".optB { top: 340px; }"]`（整行精确对）把「单栏列表」行移到 340；底部提示行 `.hint` 在 Pro 上 `if="{{ !hasDual }}"` 隐藏（第三行卡底 y456 已贴快应用画布底 466）。改任何一行的 top 时，三行间距（卡高 116 + 8）要一起对齐。
- **渲染**：`home.ux` 的 grid2 分支与 grid 分支同构（`if` 门控 + scroll + flex-wrap，不用 show），卡片用 `.cell2` —— 基线宽 96 是占位（band10 不渲染），Pro 替换对 `["width: 96px", "width: 159px"]`（=(336−18)/2，每行恰好两格），高度沿用 `.cell` 的 70→76 替换对；内容高走 `dualGridHeight()` = 固定两列 × `HOME.rowH` + `HOME.padBottom`（Pro 21×82+48=1770）。home.ux 里**不许出现 `function gridHeight` 前缀的本地定义**（test-profile 硬约束），所以双栏的内容高函数叫 `dualGridHeight`。
- **文案防误伤（两处拼接，勿改回直写）**：pro336 对 `hset.ux` 有**不带引号**的全量替换对（双栏叫法→三栏叫法），hset.ux 里 grid2 选项标题必须写 `g2Name: '双栏' + '网格'`；`set.ux` 的 `layoutName()` grid2 分支同理（那边是带引号替换对）。
- **grid2 全链路参与状态机**：四处归一化（`app.ux` / `layoutFlag.js` read+write / `home.ux` applyLayout / `set.ux` applyMode + `hset.ux` applyCurrent）、`'homeStyle'` 记忆与还原（`toggleCat` 的两个三元）、`layout.txt` 快标志都认 `'grid2'`。band10/band9 上该值永远不会被写入（选项隐藏），但状态机放行（渲染与 grid 一致），不按机型分流。

## 首页目标日不常驻模式（2026-11-18 起）

「设置」页的**「目标日不常驻」开关卡**存在 KV 键 **`'todayAuto'`**（默认关 = 现状）：

- **关（常驻）**：首页顶部始终显示目标日卡；没有目标日时显示「记录一个目标日」占位文案（同历史行为）。
- **开（不常驻）**：只有设定了目标日才显示卡片；没有目标日时卡片不渲染，空出的空间全部给下方工具列表（网格 / 列表 / 分类三种布局都顶到 y92 并加高）。
- 读写统一走 `src/utils/homeToday.js`（`read(cb)` / `toggle(cb)`），首页 `onShow` 读、设置页开关写，**别在页面里另写 `'todayAuto'` 字面量**。「恢复默认设置」要把它一起复位（`applyTodayMode(false)`）。
- **没有目标日**的口径 = `homeEvents.load` 返回的 `best` 为空（空列表、日期全部非法都算）。
- 卡片隐藏用 `if="{{ showToday }}"`（容器型 `show` 动态翻转不可靠，见首页网格的既有坑）；列表换 `.appsUp` 类：band10 `top 92 / height 394`，Pro 由 `profiles/pro336.json` 的 `["height: 394px","height: 348px"]` 换成 348。394 = 常驻态 304 + 卡片 88 + 2px 间距；两态**底部对齐**（band10 486 / Pro 440）。改目标日卡高度时同步改这两个数。

## 首页长按工具管理（置顶 / 收藏 / 隐藏）（2026-11-22 起，勿破坏）

无论使用何种首页布局，长按任意工具条目弹出操作页（`src/pages/toolact/toolact.ux`，路由 `pages/toolact`，参数 `{ id }`），支持**功能置顶**（上限 4 个）、**功能收藏**（无上限）与**隐藏功能**：

- **KV 三键单一真源**：`pinApps`（置顶 id 数组，≤4）、`favApps`（收藏 id 数组）、`hideApps`（隐藏 id 数组），全部读写统一走 `src/utils/homeTools.js`（`read(cb)` / `togglePin(id, cb)` / `toggleFav(id, cb)` / `toggleHide(id, cb)`），页面中不各写 key 字面量。
- **隐藏自动移出置顶与收藏**：隐藏一个已置顶或已收藏的工具时，`homeTools.toggleHide` 数据层统一收口，把该工具同步移出 `pinApps` 与 `favApps`，避免隐藏工具残留在置顶区或收藏页。
- **置顶 / 收藏是开关卡（2026-11-22 起）**：两张卡沿用设置页「工具分类」的开关形式 —— 整卡可点，开 = 卡底 `rgba(13,110,255,0.24)` + 右侧蓝色「开」，关 = `#262626` + 灰色「关」；状态字用 `.swState`（宽 40 / 字号 16），不用 `<switch>`。副标题由 `syncSubText()` 一处按状态生成，别在回调里各写一份。隐藏卡是危险操作，保持文字色区分（橙/红）与「已隐藏/未隐藏」，不要改成开关。
- **四种布局显示规则**：
  - `grid` / `grid2` / `list`：置顶工具移到首页最上方（按置顶操作先后顺序），原位置不再显示、后序工具上移补位；有收藏项时，首页「收藏功能」入口格（`__favtools__`）出现在**置顶区之后**的第一格，点击进收藏页（`pages/toolfav`）；
  - `cat`（分类单栏）：置顶工具以单栏条目在首页顶部显示，同时在其所属分类详情页（`pages/toolcat`）照常显示（**双显示口径**，工具分类归属不变，`cats.js` 零改动）；全隐藏的分类在分类列表中**保留**，显示「0 个工具」；
  - 收藏工具在原列表位置照常显示（收藏只在首页新增快捷入口，不移动原位置）；
  - 隐藏工具在首页与分类详情页都不显示，管理入口在 **设置 → 隐藏功能**（`pages/toolhide`）。
- **`@longpress` 原生事件与防误触守卫**：
  - 主页（`home.ux`）、分类详情页（`toolcat.ux`）、收藏页（`toolfav.ux`）三处均支持长按工具条目；分类行（`item.cat`）与内部占位行（`__` 前缀，如 `__settings__`、`__favtools__`）不响应长按；
  - 模块级 `lastLongAt` 守卫（800ms）：长按触发时记录 `Date.now()`，`open(item)` 首行校验互斥，彻底防止长按抬手后系统补发 click 误进工具页面。
- **三个新页面规范**：`toolact` / `toolfav` / `toolhide` 均严格遵守门禁规范——不使用 `data`（只用 `protected` + `private`，避开 Vela 黑屏坑）；可点元素必须 y≥92（严格遵守门禁 **R15**，不与页头返回命中区重叠）；并在 `src/manifest.json` 与 `profiles/pro336.json`、`profiles/band9.json` 中完整登记。

## 设备 profile（2026-11-12 起；2026-11-20 增 band9，勿破坏）

源码基线是 **band10（212×520 跑道屏）**；`pro336`（小米手环 9 Pro/10 Pro，336×480）与 `band9`（小米手环 9，192×490 胶囊屏，Vela 4）是构建期物化的另外两个包体，**同包名 `com.lkjhg.bandbox`、rpk 文件名分别带 `.pro.` / `.band9.` 段**：

- `profiles/band10.json`（恒等基线）、`profiles/pro336.json` 与 `profiles/band9.json`（逐文件替换表）是唯一真源；布局改动先改基线，再在两个非基线 profile 里各加对应替换对，`tools/test-profile.mjs` 会校验漂移（band9 适配后为 4730 项）。
- **band9 特有令牌**：`layout.companion.drawableH=436`（band10/Pro 为 466，这是**桌面伴侣**的画布高，与快应用画布不是一回事）、`assets.shadow=[192,84]`；键盘态「完成」栏在 InputMethod 组件内部（见下），**三机型几何一致**（键盘顶恒 y101），**不要再往页面模板里加 kbBar**。
- **仓库里提交的源码永远必须是 band10 基线态**：物化只在构建瞬间发生，`make-release.sh` 退出时自动还原（trap）。手动物化后记得 `node tools/apply-profile.mjs band10` 还原，提交前用 `node tools/apply-profile.mjs --check band10` 确认。
- 门禁 **R8**（源码树物化状态 == `BANDBOX_PROFILE`）与 **R9**（shadow.png 尺寸匹配 profile）随 R1–R7 一起跑；`npm run build:jsc` 的 prebuild 也会跑门禁，构建非 band10 包时必须带 `BANDBOX_PROFILE=<id>` 环境变量。
- 门禁 **R10**（计算器几何常量与 CSS 自洽）：`src/pages/calculator/calculator.ux` 的滚动内容高度由 `EXPR_H`/`KEY_ROW_H`/`KEYS_PER_ROW` 等常量累加得出，改了 CSS 盒子（高度/宽度/每行键数）却没改常量，构建直接失败。**页面内容高度不要在 `profiles/*.json` 里按机型分别估**——那种覆盖对会随排版变化变陈旧（Pro 曾把 `ADV_H` 估成 408、实际 500，第三个开关被裁在视口外）。两机型排版一致就共用一套常量。
- `src/common/layout.js` 是生成文件（勿手改）：JS 侧布局常量（首页网格列数/行高、跑马灯视口、IME、COMPANION.drawableH）由 `apply-profile.mjs` 按 profile 生成。
- 模拟器：Pro 用 `Vela_BandPro` AVD，band9 用 `Vela_Band9V4`（Vela 4 引擎 + 192×490 皮肤；配方与实测坑见 `docs/band9-vela4-spike.md` 与 notes/0.1.2-band9.md；docs/ 不入库，仅本地）。**V4 AVD 两个已知假象**：① 触摸输入 x<40 一律不注册（README「触摸坐标 ≈40px 偏移」的具体化），自动化点按 x 必须 ≥40；② 布局视口高 466（y≥466 不绘制）。

## 桌面伴侣「精美样式」第三版式（2026-11-23 起，勿破坏）

设置页「精美样式」开关（KV `companionCfg.fancy`）打开后，时钟页换成**表盘风版式**：
左侧一整行**自绘数字**时间（固定 HH:MM，秒钟开关不作用），右侧信息列
（周几 + 几号 / 目标日倒计时 / 分隔线 / 电量徽标），三机型同一套公式。

### 字形：**反相遮罩位图 + 彩色底容器**（当前唯一方案）

- 每位数字 = **3 个节点**：一个 `position:absolute` 的 `.fDigit` 容器（**恒黑底 `#000000`**）、
  一个内层彩色底 `.fInk`（`background-color` = 运行时取色）与一张
  `<img class="fMask" src="/common/images/fdm_{{ hN }}.png">`（**正好铺满容器**，见下面的「彩色底内缩」）。
  冒号仍是**两个圆点 div**（`border-radius: 50%`，颜色同数字），不占图片资产。
- **遮罩语义**：PNG 的 **RGB 恒为纯黑**，**alpha = 255 − 字形墨迹 alpha**（字形内 alpha 0 = 全透，
  字形外 alpha 255 = 不透明黑，抗锯齿边缘为中间值）。
  合成结果 = `彩色底 .fInk 的色 × 字形 alpha` —— 与「彩色字形直接画在黑底」**逐像素等价**，
  所以**任意 `#RRGGBB` 取色都生效**，同时保住位图的平滑边缘。
- **硬约束：精美样式的页面底色必须保持纯黑 `#000000`**（`theme.css` 的 `.page`）。
  遮罩的不透明黑底靠它与背景无缝 —— **将来若改精美样式底色，必须同步改遮罩底色或换方案**，
  否则会露出一个黑色矩形。
- **遮罩没到位前不许上色**：容器底色先给 `#000000`（= 页面底色 = 看不见色块），
  4 张遮罩的 `oncomplete` 都到了（或 400ms 兜底定时器到）才把 `digBg` 切成取色 ——
  否则会先闪出一个彩色方块。实测 Vela 的 `<image>` **会**触发 `complete`（缓存命中时也发）。
- **禁止再用 div 拼字形**：2026-11-23 试过「div 矢量字形」（`for` 列表 + 圆角矩形/圆点链），
  真机上**首帧要重建 ~118 个绝对定位 div（最多 ~149 个节点）**，渲染线程被占住约 **3 秒**，
  期间电池/目标日的异步回调也画不出来 → 表现为「卡在薄荷绿 00:00、右栏全空」。
  顺带硬边明显（「1」斜旗被容器夹平、「3」中腰出 spur、「2」斜笔接缝有缺口），用户报「完全不像这个数字」。
  **位图遮罩方案每数字 2 个节点、整页约 30 个节点，与简洁样式同量级。**
- **字形真源是本地工具 `tools/gen-assets/gen.py`**（`tools/` 整个目录不入库）：
  - `_fd_glyph()` = 源几何（设计坐标空间 58×180，16× 超采样连续三次贝塞尔轮廓 + 内孔）；
    `_fd_mask()` = 反相遮罩（等比放大到 190 高、裁到墨迹盒、alpha 取反、RGB 置黑）。
    **不要给遮罩加黑边/留白** —— 图必须正好等于墨迹盒（见「彩色底内缩」）。
  - 出图：`python3 tools/gen-assets/gen.py --fancy-masks`（写 `src/common/images/fdm_0..9.png`，
    PNG 尺寸 = 墨迹宽 × 190，并打印 `FD_SRC_W measured = [...]`）；
    预览对照图：`python3 tools/gen-assets/gen.py --fancy-preview`
    （0-9 × 190/165/149 三档字高 × 薄荷绿/天空蓝/白三种颜色）。
  - **改字形必须两边同步**：把生成器打印的实测宽抄进 `src/utils/companionGeo.js` 的 `FD_SRC_W`。
- **`FD_CAP = 190`**（遮罩出图字高）= Pro 的最大显示字高；band10 165 / band9 149 都更小。
  **只缩不放**（放大源图会把 1× 抗锯齿边缘拉糊）：`layoutFancy` 的 `maxH = min(floor(stripH×0.78), FD_CAP)`。
  显示宽 = **`ceil`**(`FD_SRC_W[i] × 显示字高 / FD_CAP`)（`companionGeo.fancyWidths(cap)`），
  三机型实测：宽字 53/61/48、「1」31/35/28。
  **必须向上取整**：Vela 的 `<image>` 按高度等比缩放后画进盒子，盒子比缩放后的宽度窄时，
  图像左缘会留出 ~0.2px 缝 → 容器底色从缝里透出来，在数字左侧显出一条 **1px 淡色竖线**
  （「1」最明显，它与格子的宽高比差得最多；模拟器逐像素实测：22% 亮度的蓝线）。
  向上取整让盒子 ≥ 缩放后宽度，图像左缘正好压住盒左 → 缝消失。
- **彩色底内缩 1px（2026-11-24 两轮真机报障后定稿，勿回退）**：真机（不是模拟器）的渲染器在
  图像的**远边**（右/下）做半纹素采样时，会把遮罩边缘与图像外的透明区混合 → 容器底色从
  1px 边缘透出来，在每个数字的**右边缘和底边缘各显出一条 L 形彩色细线**（用户照片实拍；
  模拟器 1:1 渲染复现不出，旧版彩色位图没有彩色底容器所以看不出来）。正确修法：
  - `.fDigit` 容器**恒黑底 `#000000`**；彩色取色只给内层 `.fInk`；
  - `.fInk` 比容器**左/右/下各内缩 `FD_INSET=1px`**（`left: 1px; top: 0px;`，宽 = `fw−2`，
    高 = `geoF.inkH = digitH−1`，由页面 `fc1..fc4` 内联）；遮罩图 `.fMask` **正好铺满容器**
    （`fw × digitH`）。既兜住真机远边采样污染，也消除 `band9` 149px 缩放下左缘 1px 半透细线
    （2026-11-25 模拟器实测）并保持左右笔重对称。
  - 这样图像边缘采样污染落在黑底上（不是彩色），线看不见；代价只是字形左/右/下最外
    1px（抗锯齿边缘）没有底色，肉眼基本无感。
  - **失败教训（勿重试）**：曾把遮罩四周加 2px 不透明黑边、图放大到容器外（负 left/top），
    模拟器完美，但真机上触发 Vela 对**旋转容器里绝对定位子图**的裁剪 —— 数字上下各被削掉一块
    （2 的圆弧顶变平、3 的上角变方），用户当场报障。**旋转布局里不要把图放大/负偏移**。
  - `tools/test-companion-geo.mjs` 已锁：`.fDigit` 黑底、`.fInk` 绝对定位且宽高按 `FD_INSET` 内缩、
    `.fMask` 不带 `position:absolute`、尺寸 = `fw×digitH`、页面不得再出现 `ipad/iw*/imgH`。
- **数字按各自墨迹宽紧排**（「1」比「0」窄），不是定宽格；页面用 `fw1..fw4` + `l1..l4` 紧排，
  **不要**套回固定格宽 —— 固定格宽会让「1」两侧留出空洞。
- **比例来自参考图实测**（用户给的手环照片量取，归一化到字高）：墨迹宽 0.322、笔画粗 0.106、
  字距 0.0625、冒号点径 0.098、心距 0.32、白字墨迹高 0.144。圆角半径用 **IoU 比对**定
  （`FD_R=26` 最优，0.89~0.97），改形状前先跑一次 IoU 复核。
- **右栏宽度跟着内容走**（`infoW` = 日期组 / 倒计时 / 电量组三者的最大宽），分隔线铺满整列、
  列内文字左对齐；字号比例 `dateRatio=0.17` 是按「中文字形墨迹只有字号 ~0.85」反推的。
- **时间行与右栏都是绝对定位**（`.fTime` / `.fInfo` 用 `left/top` + `layoutFancy` 的
  `timeTop/infoTop` 纵向居中），**不是** flex 的 `justify-content: space-between` ——
  窄字形（「1」）只让时间行右端往回收，右栏永远贴右不动，两者互不影响。
- **首帧就要是对的**：`onInit()` 里直接算好颜色、当前时间与日期（`applyTime` / `applyDate`），
  不要只靠 `onShow` 的 `refresh()` —— 否则首帧停在 private 占位值（薄荷绿 00:00 + 空日期）。
- 包体代价：10 张遮罩在 rpk 里占 **19,214 B**（比旧彩色 `fd_*.png` 的 31,015 B 还省 38%）。
  **不要**转调色板 PNG —— 贴 0.4.0 PNG8 图标发毛红线。

## 键盘态「完成」栏在 InputMethod 组件内（2026-11-20 起，勿破坏）

Vela 4 有两个渲染层坑（V5 无此问题）：① 同一父容器里动态插入/`show` 翻转显示的节点会**沉到静态兄弟之下**（组件边界是合成边界，组件子树整体盖在页面内容之上）；② `justify-content: flex-end` 分支里自适应宽度的 `<text>` 测宽为 0、不渲染。因此：

- 键盘态「完成」栏在 `InputMethod.ux` **组件内部**（`.kbdone`，根内容 = bar 32 + 拼音行 28 + 键盘 305 = 365，**bar 顶 = 快应用画布高 466 − 365 = 101**），文本用显式宽度 + `text-align: right`；点击经 **`close` 事件**交回页面，各页面用 `@close="closeKb"`（或 `doneEdit`）接线。
- **键盘顶边恒为 y101（2026-11-20 三机型实测修正）**：键盘贴的是**快应用画布底 466px**（band10 212×520 / Pro 336×480 / band9 192×490 三个机型都一样），**不是「屏高 − 365」** —— 屏高含底部系统栏（54 / 14 / 24px），键盘不吃那截。旧文档记的「band10 155 / Pro 115 / band9 125」比实际低 54/14/24px，据此排的键盘态布局会整块被键盘盖住。
- **键盘态页面内容只能放进 y76..100**：页头命中区占 y0..74（可点元素不许进，见 R15），键盘顶边在 y101，两边之间只有这 25px 的缝。**弹键盘后 y101 以下全被键盘盖住**（组件整体合成在页面内容之上，z-index 不可靠），所以「弹键盘时还要给用户看的值」必须挪进这条缝（如取色板页把草稿卡 `.editCardKb` 放到 y76），留在正文里用户就只能盲输。
- **页面模板里禁止再加 kbBar**（theme.css 的 `.kbBar` 样式保留但已无使用者）；键盘态草稿卡（`editCardKb` 等）若用 `show="{{ kbShow }}"` 翻转显示，只要不被静态内容压住就可以，稳妥写法是 `if`。

## 统一数字小键盘页 pages/numinput（2026-11-21 起，勿破坏）

`src/pages/numinput/numinput.ux` 是**全屏自绘数字键盘页**，全 App 共用一份（随机数上下限、单位换算数值、密码长度都走它）。它取代「页面内挂 `<input-method>`」：内置输入法贴快应用画布底 466 摆放、键盘顶边恒在 y101，弹出来就把正文整块盖住，只剩 y76..100 一条缝；统一键盘页是**整页**，调用方的正文完全不受影响。

- **调用**：`g.router.push('/pages/numinput', { field, title, value, type, allowNegative, allowDecimal, min, max, maxLen, hint })`。`type` 取 `'int'` / `'decimal'`；`allowNegative` / `allowDecimal` 传 `'0'` 关掉对应键（键面变灰）。`min` / `max` / `maxLen` 都在键盘页内校验（越界 toast「不得小于/大于 X」），`maxLen` 是字符数上限。
- **回传**：键盘页点「确定」先把结果写进 `src/utils/numInputSession`（`globalThis` 会话态，零延迟快通道）**和** `src/utils/inputResult`（一次性文件，异步兜底），写成功才 `router.back()`；调用方在 `onShow` 里取 —— 先 `numInputSession.take(field)`（同步；命中后要 `inputResult.clear()`），没命中再 `inputResult.take(cb)`（异步读文件）。**两条通道都要走**：只靠内存会话在跨 bundle 缓存不可见时会丢结果，只靠文件则有一次可见延迟。
- **`value` 传空串还是当前值**：键盘页里草稿长度到 `maxLen` 后，再按数字只会弹「已达最大长度限制」——**预填当前值会把用户卡死**（想从 16 改成 20 得先退格两次）。所以**定长字段传 `value: ''`**，当前值放进 `hint` 提示行；不限长的字段（随机数上下限）随意。
- **密码页长度输入（2026-11-21 改造）**：`src/pages/password/password.ux` 已撤掉页内 `<input-method>` 与整套 `kbShow` / `lenDraft` 状态；长度行（页级 y230）点一下跳 `pages/numinput`（`field: 'pwdLen'`，8~99 位整数），返回后 `applyLen` 写回长度并按新长度重新生成。页内正文不再随键盘态隐藏或上移。

## if/show 包装 div 必须带完整几何 CSS 类（2026-11-20 起，勿破坏）

Vela 有条渲染规则：**带 `if` 的 div 必须有 CSS 规则（`position` + `left/top` + `width/height`），否则里面的绝对定位子元素不会被布局**（`docs/emulator-fix.md` 记着）。band10 / Pro / band9 的引擎与 SDK 模拟器对这条规则**宽容**，**小米手环 11 固件严格执行** —— 这就是「手环 11 点输入框只出「完成」栏、按键区全空」的根因（详见 `notes/0.1.2-band11.md`）。

- **凡是带 `if` / `show` 的包装 div，一律给它一个带完整几何的 CSS 类**（内联 style 不算数），别留「无 class 无 style」的裸 div。`InputMethod.ux` 现有四个：`kbOuter` / `kbInner` / `kbBody` / `kbDown`。
- **给包装层加 `position` 时必须保持布局原点不变**：Vela 的绝对定位子节点挂在**直接父节点的布局原点**上，不是根容器。键盘体 `kbBody` 因此定位在 `top:60px`（= 完成栏 32 + 拼音行 28），把原点钉在根顶 +60（= 161），与改造前流内排布完全一致。**改成 `top:0` 会把整棵按键子树上移 60px、控制栏盖住完成栏**。
- 键盘组件根容器高度写死 **365px**（32 + 28 + 305，三机型不变量），**不用 `auto`**；`overflow` 恒 `hidden`。
- 新增这类包装层后，改完跑三机型键盘态**像素对比**（band10 / band9 / pro336 各 7 张截图，`tools/cmp-shots.py`），确保与改前逐像素一致。

## 页头与底部动作键（2026-11-17 起，勿破坏）

页头（`src/components/PageHead.ux`）整条是**返回命中区**（`.phHit`，y0..74，点了就 `router.back()`），所以**页头里不许放任何别的可点元素**：

- **动作键（保存 / 完成 / 参考）一律放页面底部**。通用样式用 theme.css 的 `.actRow`（与卡片同宽：band10 206px / Pro 330px，band10 top 400 / Pro top 360，Pro 的 top 由 `profiles/pro336.json` 里 theme.css 那条替换对改）。页面底部已有别的键时，**主操作在上、次要/危险操作在最底**（目标日设定的「保存」在「删除这个目标日」上面；动态口令的「保存」在「删除账户」上面；性能测试的「开始测试」在「参考」上面）。
- **页头右上角的「完成」是多余的**：键盘态的「完成」在输入法组件顶部的 `.kbdone` 条上（**y101..133**，三机型一致），点它就是收键盘。节拍器 / 随机数页头那个「完成」调的也是同一个 `doneEdit`，已删除。
- **不能靠 z-index 摆平**：Vela 渲染器直接丢弃 `z-index`（band10 / Pro 模拟器日志都有 `Unknown style - zIndex`），层序只按文档顺序排，真机与模拟器的点按判定顺序未必一致 —— 唯一稳的办法是**命中区与可点元素不重叠**。
- 门禁 **R15**（页头命中区不得压住可点元素）：`tools/release-gate.mjs` 里的 `scanHeaderOverlaps()` 扫全部页面的模板 + 样式，算出每个 `@click` 元素的绝对盒，与 `PageHead.ux` 里 `.phHit` 的矩形求交；重叠即拦下构建。几何直接从 `PageHead.ux` 现读，基线态与 pro336 物化态都准。改页头命中区或新增页面动作键后，跑 `node tools/release-gate.mjs --only-r15` 自查（只跑这一条）。
- 键盘态（`kbShow`）时输入法占住屏幕底部 305px，底部动作键会被盖住 —— 所以**带输入法的页面要 `show="{{ !kbShow }}"`**，键盘态用 `kbBar` 的「完成」收键盘后再点底部动作键（与 `notebook/rename` 的既有做法一致）。

## 版本号同步

版本号必须四处一致，脚本会自动改，手改也要改齐：

1. `src/manifest.json` — `versionName` / `versionCode`
2. `package.json` — `version`
3. `src/pages/about/about.ux` — `v<版本>`
4. `src/pages/set/set.ux` — `版本 <版本>`
5. `README.md` — 顶部「版本：」行

`tools/release-gate.mjs` 的 R6 规则会校验前三者与 README，打包前必过这道门禁。

插件版本号（`plugin/bandbox-helper/{manifest.json,package.json,package-lock.json}`）只在**插件源码真的改了**时才升，没改不要动。

**双端版本号对齐（2026-11-15 起）**：自 `0.1.1` 起，插件版本号与快应用版本号**共用同一条线**（插件此前自成 `0.3.x` 线，最高 `0.3.3`）。因此：
- 改快应用版本号时，插件的 4 处版本号要一起改：`manifest.json`、`package.json`、`package-lock.json`、`src/plugin.js` 的 `PLUGIN_VERSION`（`plugin/bandbox-helper/scripts/build.mjs` 在构建期校验 `PLUGIN_VERSION` 与 manifest 的 `version` 一致，不一致直接失败）。
- 插件文档/注释里**不要**再用版本阈值表达行为（例如「≤0.3.1 用旧包名」）——编号归一后 `0.1.1` 会被误读成旧包；改写成不依赖版本号的表述。
- **例外（0.1.1 换源）**：本版插件源码确实改了（`TARGET_PKG` 换成新包名），但版本号**停在 `0.1.1`** 与快应用对齐 —— 平台侧 0.1.0 已下架、旧插件失去使用对象，不存在版本混淆；下次插件源码再改动时，恢复「插件源码改动即升号、且与快应用同号」的规矩。

## 冷启动减负：协议栈不进启动路径（2026-11-22 起，勿破坏）

手环 CPU 弱、工具多，冷启动是硬指标。实测 band10 模拟器：**app.jsc 从 51,520 B 降到 23,867 B（−53.7%）**，协议栈求值段 38ms → 29ms。

- **`app.ux` 不得 import `otpBridge` / `qrBridge` / `otpProtocol` / `otp` / `otpAccounts` / `otpStore` / `qrProtocol` / `qrFavStore`** —— 启动路径只留 `src/utils/pushInbox.js` 这一份薄缓冲层（约 4KB）。
- **手机推送的接收链路**：`app.ux onCreate` 调 `pushInbox.init()` 订阅 `interconnect`，收到的消息按 `app` 字段分流进 `otp` / `qr` 两个桶（歌词协议 `bandbox-lyrics` 不进缓冲，由歌词页自己订阅）。用户进入对应页面时，桥接层 `init()` 调 `pushInbox.claim('otp'|'qr', handle)` **认领并原样回放** → 落库与回执照旧，**数据不丢**。
- **认领触发点**（页面 `onShow` 里调）：`otp/sync/sync.ux`、`otp/list/list.ux`（`otpBridge.init()`）、`qrcode/fav/fav.ux`、`qrcode/import/import.ux`（`qrBridge.init()`）。到达这些页之前，插件推送都躺在缓冲里；进页即回放落库。**新增 OTP / 二维码相关页时要在它的 `onShow` 里补上对应 init**，否则该页看不到缓冲里的推送。
- **状态必须挂 global**：工具链把每个页面打成独立 bundle、模块级变量不跨 bundle 共享 —— `pushInbox` / `otpBridge` / `qrBridge` 的状态都挂在 `global.__bbPushInbox` / `global.__bbOtpBridge` / `global.__bbQrBridge` 上。**分片会话（otp 的 `session`）必须全 app 只有一份**，否则同一笔分片事务的各片分落在不同页面被认领时会重组失败。挂法照 `global.js` / `perf.js` 的先例。
- **行为变化（已知且可接受）**：插件侧「手环在线 · N 个账户」的显示**推迟到用户首次进入 OTP / 二维码页**（此前是进入应用即显示）。歌词推送链路不受影响（歌词页自带就绪广播）。
- **别把 `announceReady` 的节流单位改回毫秒**：`lastAnnounceAt` 统一用 `otp.epochSeconds()`（秒）。早前 `onStatus` 里用 `Date.now()`（毫秒）赋值、节流处又按秒比较，单位不一致会让自己的节流把就绪广播挡掉（`now - lastAnnounceAt` 为负 → 直接 return，插件侧永远等不到 ready）。
- **本地测冷启动**：该 Vela 模拟器镜像**没有 Android logcat 服务**（`adb logcat` 与 gRPC `streamLogcat` 都取不到快应用日志），测量要走「埋点写 `internal://files/bandbox/perf.txt` → `adb shell cat /data/files/<pkg>/bandbox/perf.txt`」。`src/utils/perf.js` 的 `ENABLED` **必须保持 false**，发行包不带埋点（门禁 R2 会拦）。

## 记忆存储

本项目所有需要「记住」的约定、决策、约束与进度，统一写入 **PowerContext**
（`powercontext-project-context` 技能的 `remember_memory`，scope 用 `resolve_scope_binding` 解析出的绑定），
保证跨会话、跨助手共享；不要只写在本地文件或聊天里就当作已记住。

## 加速度计订阅必须走 accelHub（2026-11-22 起，勿破坏）

Vela 的 `@system.sensor` 实测语义（band10 模拟器 E2E 判决，答案之书摇一摇落地时发现）：

- **全局只有一个订阅槽**：槽被占时后续 `subscribeAccelerometer` 被**静默忽略**（不回调 fail、不抛错），新页面从此收不到帧 —— 答案之书 E2E 连续复现「封面摇一摇灵、答案页必聋」；
- `unsubscribeAccelerometer()` 是**全局退订**且**异步落定**，紧跟着的新订阅会被一起杀掉；
- 已注册回调**持续收帧，与注册页可见性无关**（栈底页被覆盖时照常投递）。

因此：

- **任何页面不得直接调 `subscribeAccelerometer` / `unsubscribeAccelerometer`**，跨页面共享传感器的场景一律用 `src/utils/accelHub.js`：订阅只做一次、由栈底传感器页持有（封面 `ensureSubscribed()`），帧经消费者槽转发给当前可见页；页面 `onShow` 用 `setConsumer` 挂自己的处理器（引用存模块级变量）、`onHide` 用 `clearConsumer` 摘（引用比较防误摘），`onHide`/`onDestroy` 一律**不退订**（只有持有页 `onDestroy` 才 `unsubscribe`）。
- 独立叶子页（如体感枪 / 空气投篮，邻居页不订阅）可维持旧的「onShow 订阅 / onHide 退订」模式；一旦要与其它传感器页共存于同一条路由栈，必须迁到 accelHub。
- 摇一摇内核在 `src/utils/motionShake.js`（迟滞边沿 + 双甩配对 + 冷却 + 静默窗 + 上膛窗），本地单测 `node tools/test-motion-shake.mjs`，E2E `tools/shake-sim.py`（gRPC 注入 z 轴甩动，不转屏）。

## 字号与图标清晰度（2026-11-24 起，勿回退）

对手 Model 是 Hyper Box：图标简洁、文字又大又清晰。手环 1.6" 屏、1 CSS px = 1 物理像素，
「字小 + 灰」是最伤眼的问题。以下数值是硬约定，**R18/R19 会拦回退**。

### 字号

- **硬底线 14px（R18 构建期拦下）**：`src/**/*.ux` 的 `font-size` 字面量 <14px 直接 fail；
  唯一白名单 `src/pages/input/input.ux` 的 `.nlT`（30×24 按钮里的换行符字形，不是可读文本）。
- **目标线 15px**：提示 / 说明 / 副标题优先 15px；放不下时**先删字**，仍放不下才落 14px。
- **高频面**（2026-11-24 抬过，别再压回去）：首页网格标签 18px / 行高 24、图标 32×32；
  列表 / 分类 / 收藏 / 隐藏行名称 19px、副标题 15px；页头标题 18px、时钟 16px；
  设置页与工具管理卡标题 18px、副题 15px；`theme.css` 的 clock 16 / title 18 / cardTitle 18 /
  btnText 15 / hint 15 / actRowT 16。
- **文字色三档**：主 `#FFFFFF`、次 `rgba(255,255,255,0.72)`、提示 `rgba(255,255,255,0.55)`。
  正文/提示**不得低于 0.55**；0.45 只给占位符，0.3 左右只给禁用态/纯装饰。
  R19 对独立 `color:` 声明里白透明度 <0.4 出提醒（不阻断）。
- **行高**：单行 `line-height ≥ font-size + 4`；盒子高 ≥ 行高。字号/几何一律整数。
- **精简字号的页面改字前先看盒子**：20px 高的行能放 14px；16px 高的紧凑行放 14px 时要
  目检是否裁字（radix / wifi 的字段标签就是 16px 行装 14px 字）。改盒子高度时同步
  `set.ux` / `toolact.ux` 的 `INNER_H` / `CARD_COUNT`（R17 会拦）。

### 图标规格

- **44×44 RGBA8、4× 超采样 + LANCZOS**；**禁 PNG8 / 调色板**（0.4.0 发毛红线）。
- **线宽**：主描边 6px、内部细节 5px、**最小 4px**；圆点半径 ≥2.2；
  **删掉 2~3px 的 DIM 辅助线**（首页按 32px 显示，32/44≈0.73，2px 线只剩半像素噪点）。
- **配色**：近白 `#E8EEFF` 主色 + 蓝 `#4E87FF` 点缀；单个图形最多一处蓝。
- **显示尺寸**：首页网格 **32×32**（`home.ux` 的 `.icon`）；列表 / 分类 / 工具管理行 34×34；
  **只缩不放**——任何显示尺寸不得大于源图。
- **答案之书封面**用专用 `answerBig.png`（88×88 源图按 66 显示，0.75× 缩小）；
  **不许**再把 44 源图拉到 66（全项目唯一一处放大，必糊）。
- 改图标后先跑 `python3 tools/gen-assets/gen.py --icon-preview` 生成 `preview-icons.png`
  （44/32/34 三档铺在 #1A1A1A 上），在 32px 档确认线条完整、细节不糊，再打包。
- 图标生成器：`gen.py`（34 个 `icon_*` + `answerBig` + `--icon-preview`）、`gen_cats.py`（9 个分类）
  与 8 个单图脚本；它们共享 `MIN_W/DET_W/INK_W`，改线宽只改常量。

## 内存与重启缓解约定（2026-11-26 起，勿回退）

Vela 在部分系统接口上存在隐性内存泄漏且不提供内存/fps 查询 API；项目侧必须压低系统接口调用频次、原生回调持有、常驻对象体积与每秒分配抖动：

- **KV 一进程读一次盘（`src/utils/kv.js`）**：`init()` 只在 `!ready` 时读盘，就绪后直接走内存；`reload(cb)` 作为显式强制重读逃生口保留。读盘返回若 `dirty || writing || pending`，只把磁盘值合并进未写过的键，避免启动早期「页面先写、读盘后到」冲掉新值。`set/remove/reset` 递增 `rev()` 供派生缓存失效。
- **docs 列表/正文跨 bundle 缓存（`src/utils/docs.js`）**：全局 `__bbDocsRev` 在 `save/remove/rename` 成功后递增；`list(dir)` 缓存 `{dir, rev, docs}`（命中返回 `docs.slice()`），`read(dir, name)` 缓存最后一份 `{uri, rev, text}`。`pages/lyrics/**`、`pages/notebook/**` 禁止直接调 `g.fs.writeText/remove/rename`，所有写入必须走 `docs`（否则跨页列表缓存不失效）。
- **互联层单例化与单次绑定（`src/utils/interconnectCore.js` + `src/utils/interconnect.js`）**：状态统一挂 `globalThis.__bbIC`；同一 `connect` 实例只绑定一次 `onmessage/subscribe/onopen/onclose/onerror`（`boundConnect === connect` 守卫），1006 断连重建新实例时也只绑一次。`otpBridge.disarm()` 在 `otp/list`、`otp/sync` 的 `disarm()`（`onHide`/`onDestroy`）中调用，避免全局状态回调长期持有页面 bundle 闭包。
- **页面栈深度上限 6 层（`src/utils/router.js`）**：`MAX_STACK = 6`，`push()` 探测 `router.getLength() >= MAX_STACK` 时自动降级为 `replace()`（`back()` 逻辑不变），防止异常深链长期驻留多份页面实例。
- **高频计算与长亮优化**：`otpStore.list()` 按 `g.kv.rev()` 缓存 normalized 列表；`otpState.resolve()` 按 `id + secret 尾6位 + secret 摘要 + counter + period + digits + algorithm` 缓存 TOTP 成功态（上限 64 条，超限整体清空），`otp/list` 与 `otp/detail` 每秒只重算 `remaining`；`pushInbox.classify()` 先做 `'"bandbox-otp"'` / `'"bandbox-qr"'` 字面量过滤再 `JSON.parse`；`companion/clock` 在精美样式或关秒模式走整分 +20ms 对齐的 `minuteTimer`（60 次/小时，不再每秒重绘）；`historyData` 月份缓存设 LRU 上限 3；`performance.ux` 测试链使用 `runTimer` + `runSeq` 并在 `onHide`/`onDestroy` 调用 `cancelRun()`。
- **门禁 R20（内存卫生）**：`tools/release-gate.mjs`（支持 `--only-r20` 单独自查）强制检查：① `@system.file` 只允许在 `utils/fs.js`、`utils/kv.js`；② `@system.interconnect` 只允许在 `utils/interconnect.js`；③ 含 `setInterval(` 的文件必须含 `clearInterval(`；④ `pages/lyrics/**` 与 `pages/notebook/**` 禁止直接 `g.fs.writeText/remove/rename`。

## 其它硬约束（勿破坏）

- 发行包内**不带性能埋点**：`src/utils/perf.js` 的 `ENABLED` 必须为 `false`，`src/app.ux` 不得 import 埋点模块。
- 页面对象**不得同时出现 `data` 与 `private`**（Vela 运行时直接抛错、页面黑屏）。
- **不要**用 `tools/png8.mjs` 转换带抗锯齿边缘的 UI 小图（0.4.0 的图标发毛事故）。
- `src/utils/{otp,otpAccounts}.js` 与 `plugin/bandbox-helper/src/` 下的同名文件必须逐字一致（cross 测试按 SHA-256 校验）。
- **包名六处同步**：`src/manifest.json` 的 `package` + `src/utils/{otpProtocol,qrProtocol}.js` + `plugin/bandbox-helper/src/{protocol,otpProtocol,qrProtocol}.js` 的 `TARGET_PKG`。插件靠包名寻址手环应用，漏改一处手机侧就收不到消息。
- 提交/打包前源码树必须处于 band10 基线态（`node tools/apply-profile.mjs --check band10` 通过），不得把 pro336 物化态提交进仓库。
- 合规红线：无激活/付费/引流、无第三方闭源依赖、无内置字库、数据全部自建或公共领域改写。
