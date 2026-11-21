# AstroBox 上架（资源仓库 / PR 流程）

> 分发平台是 **AstroBox Creator Console**（审核意见编号 `ABCC_NEEDFIX_*`）。
> 提交流程是 PR：控制台往资源仓库写资源 → 生成 `manifest_v2.json` → 更新
> `AstroBox-Repo` fork 上的 PR（`tmp/<owner>/<repo>/resource.csv` 索引行）。
> 2026-11-16 的 PR 是 [#2050](https://github.com/AstralSightStudios/AstroBox-Repo/pull/2050)。

## 资源仓库 = 本项目的 GitHub 镜像

资源仓库是 `lkjhg10576/MiBandBox`，它同时是本项目从 AtomGit 同步过来的 GitHub 镜像。
仓库里有两类文件：

| 路径 | 谁写的 | 内容 |
|---|---|---|
| `media/`、`downloads/`、`manifest_v2.json` | **控制台**（每次编辑会话直写 GitHub） | 商店图标、头图、预览图、rpk 包体、资源清单 |
| `src/`、`tools/`、`release/`… | **本地项目**（AtomGit 同步覆盖过来） | 应用源码 |

**两个写入方互不知情，这是所有上架事故的根源。**

## 铁律：清单里引用的文件，必须在仓库里有实体文件

`manifest_v2.json` 里 `item.icon` / `item.cover` / `item.preview[]` /
`downloads.*.file_name` 写的是**仓库内的相对路径**。审核会去 PR 的
`resource.csv` 里 `repo_commit_hash` 钉住的那个提交按路径找文件 —— 找不到就报
**「icon指向文件不存在」**并打回。

2026-11-16 的事故链（本机 Creator Console 日志 `~/.local/share/moe.astralsight.astroboxcc/logs/resource/`）：

1. 11-08 22:43–23:03 用 `promo/assets/icon.png`（864×864）导入图标，控制台三次拒收：
   「图标规格不符，已拒绝 · 图标尺寸过大（边长需小于等于 500px）」；
2. 11-08 23:08 改用 500×500 的 `icon_astrobox.png` → 导入成功，上传为 `media/icon_astrobox.png`；
3. **11-09 23:06 在控制台里「移除图标」** → 实体文件从仓库消失，而
   `manifest_v2.json` 的 `item.icon` 仍写着 `media/icon_astrobox.png`；
4. 11-16 00:52 那次编辑会话只补了头图和 5 张预览图，**没碰图标**，提交的 12 个文件里没有它；
5. 审核按 `resource.csv` 钉住的提交去找图标 → 文件不存在 → 打回。

## 本地是真源：每次控制台改完，跑一次同步

AtomGit 每次提交都会**覆盖**镜像仓库代码。也就是说控制台写进 GitHub 的
`media/`、`downloads/`、`manifest_v2.json`，在下一次 `git push` 后就会被本地版本覆盖；
反过来本地没有的文件，控制台写进去后也留不住。

所以约定：

1. 控制台每次编辑会话后，本地跑 `node tools/astrobox-sync.mjs` —— 把控制台写的
   资源文件拉回本地，并校验清单里每条引用都能在本地找到实体文件；
2. 本地提交并推送 → 镜像仓库始终是完整的；
3. 打包前 `node tools/release-gate.mjs` 的 **R13** 会再查一遍同一件事，不过即拦下构建。

> 首次做这一套时，`media/`、`downloads/`、`manifest_v2.json` 已随一次提交入库，
> 从此控制台与镜像不再互相覆盖丢失。

## 铁律：`downloads/` 里的 rpk 必须本地先入库，控制台不会替你写（2026-11-21 打回）

**0.1.2 的打回理由**：`manifest downloads 文件存在性 · 缺失文件：
downloads/com.lkjhg.bandbox.release.0.1.2.rpk、
downloads/com.lkjhg.bandbox.pro.release.0.1.2.rpk、
downloads/com.lkjhg.bandbox.band9.release.0.1.2.rpk`。

**根因**：控制台的「更新仓库 manifest 与资产」只写 **2 类**文件 —— 清单
`manifest_v2.json` 与 `media/` 里的图标/头图/预览图（见控制台日志
`~/.local/share/moe.astralsight.astroboxcc/logs/resource/edit_*.log` 里
「批量上传 2 个文件（Git Data API）」那一段）。**包体本体（`downloads/*.rpk`）
控制台不上传到 GitHub**：控制台只在清单里写好 `downloads.<机型>.file_name`
（仓库内相对路径），然后由审核按 `resource.csv` 钉住的 `repo_commit_hash` 去
那个提交里找文件。文件不在 → 打回。

> 2026-11-21 19:22 那次控制台会话的提交 `2f0f1a6` 只含
> `manifest_v2.json` + `media/BandBox 头图 1200x800.png` 两个文件；
> 而 `downloads/` 在那个提交里仍只有两个 0.1.1 的包 —— 三个 0.1.2 包
> 只存在于本地 `release/BandBox-0.1.2/`，从未进过 `downloads/`。

**所以上架新版本的完整顺序**（别跳步）：

1. 出包（`release/BandBox-<版本>/` 三包）；
2. **把每个要上架的包按原文件名复制进 `downloads/`**（`downloads/*.rpk` 已用
   `.gitignore` 的 `!downloads/*.rpk` 例外规则放行入库）；
3. 本地提交并推送 → 镜像仓库（GitHub）里才有这些文件；
4. 控制台再编辑/提交 → 它写清单（含新 file_name）→ 审核钉的提交里文件已存在；
5. `node tools/astrobox-sync.mjs` 把控制台写的清单拉回本地，`astrobox-sync --check`
   与门禁 **R13** 复查引用完整性。

> 反过来也成立：控制台**会**写 `downloads/` 吗？—— 不会（0.1.1 时那两份 0.1.1 包
> 是本地放进去后随提交入库的，控制台只更新清单指向它们）。

## 机型 ↔ 包体对照

平台设备代号取自 AstroBox 官方 `devices_v2.json`；真机分辨率取自米坛知识库
（wiki.bandbbs.cn/ProductWiki/devices/Xiaomi/device.html）。

| 设备 | 平台代号 | 真机分辨率 | 用哪个包 |
|---|---|---|---|
| 小米手环 9 | `xmb9` | 192 × 490 | `com.lkjhg.bandbox.band9.release.*.rpk`（**0.1.2 起支持并上架**，见下方 band9 profile） |
| 小米手环 9 Pro | `xmb9p` | 336 × 480 | `com.lkjhg.bandbox.pro.release.*.rpk` |
| 小米手环 10 | `xmb10` | 212 × 520 | `com.lkjhg.bandbox.release.*.rpk` |
| 小米手环 10 NFC | `xmb10nfc` | 212 × 520 | `com.lkjhg.bandbox.release.*.rpk` |
| 小米手环 10 Pro | `xmb10p` | 336 × 480 | `com.lkjhg.bandbox.pro.release.*.rpk` |
| 小米手环 11 / 11 NFC | `xmb11` / `xmb11nfc` | 212 × 520 | `com.lkjhg.bandbox.release.*.rpk`（与手环 10 同几何，沿用标准包） |

平台设备表里**没有手环 9 的 NFC 代号**（只有 `xmb10nfc`），所以「含 NFC 版」在
索引里就落在 `xmb10nfc` 一项。

> ✅ **手环 11 的上架前提已满足**：手环 11 与手环 10 同为 212×520，沿用标准包即可，
> 前提是内置输入法的真机修复进发行版（`0.1.2-271` 的 Beta 已修，根因见
> `notes/0.1.2-band11.md`）：手环 11 固件严格执行「带 `if` 的 div 必须有 CSS 规则，
> 否则其绝对定位子元素不被布局」这条 Vela 规则，输入法组件的按键区整棵不布局，
> 只剩「完成」栏。**0.1.2 发行版（versionCode 279）已含此修复** ——
> `xmb11` / `xmb11nfc` 自 0.1.2 起上架。

> ✅ **手环 9（192×490）已支持**：0.1.2 起新增 `band9` profile（Vela 4 胶囊屏
> 192×490），布局常量、影子图尺寸、固定像素宽度逐个收窄后不再裁切；
> 平台索引里 `xmb9` 指向 `com.lkjhg.bandbox.band9.release.*.rpk`。
> （历史背景：0.1.1 时窄长包按 212×520 设计、右侧裁 14~20px，故当年不上架。）

## 商店图标（`media/icon_astrobox.png`）

- **和包内图标是两个文件、两种形状，不要合并**：
  - `src/common/icon.png`（216×216）= 手环桌面上的应用图标，**圆角方块**（Vela 运行时自己加容器）；
  - `media/icon_astrobox.png`（500×500）= 商店图标，**满幅内切圆 + 四角透明**（平台自己套圆形容器）。
    实测在架 10 个官方源图标有 9 个是满幅圆（不透明面积占画布 79.5~80.1%，圆面积 π/4 ≈ 78.5%）。
    两者线稿与配色同源（IKB 蓝 + 白卡片），观感是同一个品牌。
- **硬性规格：边长 ≤ 500px**（控制台实测硬拒，864×864 直接被拒）。官方文档另称
  「推荐 192x192（对图标无硬性要求）」。
- 生成：`python3 promo/tools/gen_astrobox_icon.py`（本地脚本，输出到 `media/`，
  与清单的 `item.icon` 路径对齐；同名旧副本仍在仓库根）。
- **文件名不要改**：控制台按原文件名落到 `media/<文件名>`，清单按原名引用。

## 提交 PR 前要核对的三件事

1. `resource.csv` 索引行的 `repo_commit_hash` 指向的提交里，`item.icon` 等引用文件**确实存在**；
2. `manifest_v2.json` 的 `downloads` 设备列表与项目实际支持的机型一致；
3. 版本号：平台按「包名 + versionCode」判新旧，撞号会被当成旧包拒收。

**再加一条（同属第 1 条的延伸）**：清单里 `downloads.*.file_name` 指向的 **rpk 包体**
也必须在那个被钉住的提交里存在 —— 控制台不写包体，本地没先放进 `downloads/` 并推送，
审核就会报「manifest downloads 文件存在性 · 缺失文件」。

自查（本地真源侧）：

```bash
node tools/astrobox-sync.mjs --check   # 清单每条引用在本地都能找到实体文件
node tools/release-gate.mjs --only-r13  # 同一件事的构建期硬约束
node tools/verify-rpk.mjs downloads/com.lkjhg.bandbox.release.0.1.2.rpk   # 签名 + 包内版本
```
