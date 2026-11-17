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

- 打包命令：

  ```bash
  # Beta（默认，development 模式；版本号不动，只升 versionCode）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta
  # Beta（双包：band10 + pro336 一次出齐，同一产物目录）
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

## 设备 profile（2026-11-12 起，勿破坏）

源码基线是 **band10（212×520 跑道屏）**；`pro336`（小米手环 9 Pro/10 Pro，336×480）是构建期物化的第二包体，**同包名 `com.lkjhg.bandbox`、rpk 文件名带 `.pro.` 段**：

- `profiles/band10.json`（恒等基线）与 `profiles/pro336.json`（逐文件替换表）是唯一真源；布局改动先改基线，再在 pro336.json 里加对应替换对，`tools/test-profile.mjs` 会校验漂移。
- **仓库里提交的源码永远必须是 band10 基线态**：物化只在构建瞬间发生，`make-release.sh` 退出时自动还原（trap）。手动物化后记得 `node tools/apply-profile.mjs band10` 还原，提交前用 `node tools/apply-profile.mjs --check band10` 确认。
- 门禁 **R8**（源码树物化状态 == `BANDBOX_PROFILE`）与 **R9**（shadow.png 尺寸匹配 profile）随 R1–R7 一起跑；`npm run build:jsc` 的 prebuild 也会跑门禁，构建非 band10 包时必须带 `BANDBOX_PROFILE=<id>` 环境变量。
- 门禁 **R10**（计算器几何常量与 CSS 自洽）：`src/pages/calculator/calculator.ux` 的滚动内容高度由 `EXPR_H`/`KEY_ROW_H`/`KEYS_PER_ROW` 等常量累加得出，改了 CSS 盒子（高度/宽度/每行键数）却没改常量，构建直接失败。**页面内容高度不要在 `profiles/*.json` 里按机型分别估**——那种覆盖对会随排版变化变陈旧（Pro 曾把 `ADV_H` 估成 408、实际 500，第三个开关被裁在视口外）。两机型排版一致就共用一套常量。
- `src/common/layout.js` 是生成文件（勿手改）：JS 侧布局常量（首页网格列数/行高、跑马灯视口、IME）由 `apply-profile.mjs` 按 profile 生成。
- 模拟器：Pro 用 `Vela_BandPro` AVD（配方见 `docs/pro-spike.md`；docs/ 不入库，仅本地）。

## 页头与底部动作键（2026-11-17 起，勿破坏）

页头（`src/components/PageHead.ux`）整条是**返回命中区**（`.phHit`，y0..74，点了就 `router.back()`），所以**页头里不许放任何别的可点元素**：

- **动作键（保存 / 完成 / 参考）一律放页面底部**。通用样式用 theme.css 的 `.actRow`（与卡片同宽：band10 206px / Pro 330px，band10 top 400 / Pro top 360，Pro 的 top 由 `profiles/pro336.json` 里 theme.css 那条替换对改）。页面底部已有别的键时，**主操作在上、次要/危险操作在最底**（目标日设定的「保存」在「删除这个目标日」上面；动态口令的「保存」在「删除账户」上面；性能测试的「开始测试」在「参考」上面）。
- **页头右上角的「完成」是多余的**：输入法正上方本来就有 theme 的 `kbBar`（band10 y155..187 / Pro y115..147），上面就是「完成」。节拍器 / 随机数页头那个「完成」调的也是同一个 `doneEdit`，已删除。
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

## 记忆存储

本项目所有需要「记住」的约定、决策、约束与进度，统一写入 **PowerContext**
（`powercontext-project-context` 技能的 `remember_memory`，scope 用 `resolve_scope_binding` 解析出的绑定），
保证跨会话、跨助手共享；不要只写在本地文件或聊天里就当作已记住。

## 其它硬约束（勿破坏）

- 发行包内**不带性能埋点**：`src/utils/perf.js` 的 `ENABLED` 必须为 `false`，`src/app.ux` 不得 import 埋点模块。
- 页面对象**不得同时出现 `data` 与 `private`**（Vela 运行时直接抛错、页面黑屏）。
- **不要**用 `tools/png8.mjs` 转换带抗锯齿边缘的 UI 小图（0.4.0 的图标发毛事故）。
- `src/utils/{otp,otpAccounts}.js` 与 `plugin/bandbox-helper/src/` 下的同名文件必须逐字一致（cross 测试按 SHA-256 校验）。
- **包名六处同步**：`src/manifest.json` 的 `package` + `src/utils/{otpProtocol,qrProtocol}.js` + `plugin/bandbox-helper/src/{protocol,otpProtocol,qrProtocol}.js` 的 `TARGET_PKG`。插件靠包名寻址手环应用，漏改一处手机侧就收不到消息。
- 提交/打包前源码树必须处于 band10 基线态（`node tools/apply-profile.mjs --check band10` 通过），不得把 pro336 物化态提交进仓库。
- 合规红线：无激活/付费/引流、无第三方闭源依赖、无内置字库、数据全部自建或公共领域改写。
