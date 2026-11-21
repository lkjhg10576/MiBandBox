# AstroBox 官方插件源上架（BandBox辅助）

> 2026-11-21 首次上架。PR：`AstralSightStudios/AstroBox-NG-Plugin-Repo#56`。
> 与快应用的资源仓库（`notes/astrobox-submit.md`）是**两套完全不同的流程**，别混。

## 官方插件源是怎么运作的

官方插件源仓 `AstralSightStudios/AstroBox-NG-Plugin-Repo` 根目录只有 `index.txt`，
每行是**一个作者仓库的 raw 基地址**。仓里的 GitHub Action（每 4 小时 + 上游 push 时）
跑 `scripts/generate-index.mjs`：

1. 拉 `<基址>/index.txt` —— 里面每行是「装着 manifest.json 的文件夹」的**仓库内相对路径**；
2. 逐个拉 `<基址>/<文件夹>/manifest.json`；
3. 汇总成 `index.json`（`{repo, folder, manifest}` 三元组列表），客户端读它 = 插件市场。

客户端下载时按 `基址 + 文件夹 + 文件名` 拼 raw 地址，所以 **`manifest.json` / `entry`
(wasm) / `icon` 必须在同一个目录里**，缺一个就装不上（聚合脚本只校验 `name` 非空，
其余靠客户端下载时才暴露问题）。

在架 60 个插件里 **24 个是 api_level 4 / wasi_version 3**，与本插件同级 ——
官方文档页写「本页讲的是 V2 插件」是过时措辞，同一套流水线吃 V4。

## 仓库布局：AtomGit 为真源，GitHub 供市场读

| 仓 | 地址 | 角色 |
|---|---|---|
| 插件仓（真源） | `atomgit.com/gcw_MchqrexB/bandbox_helper` | 提交到这里；平台镜像功能单向 push 到 GitHub |
| 镜像仓（市场读） | `github.com/lkjhg10576/bandbox_helper` | 官方 index.txt 里登记的基址 |

**为什么要绕 AtomGit**：国内连 GitHub 慢（`raw.githubusercontent.com` 在国内 TLS 层被掐断，
DNS 解析成 `::`）。推代码走 AtomGit，镜像自动同步到 GitHub，市场照旧读 GitHub raw。

镜像仓里长这样：

```
index.txt          ← 一行：release
release/
  manifest.json    ← 清单（与 plugin/bandbox-helper/manifest.json 同源）
  plugin.wasm      ← entry
  icon.png         ← manifest.icon
  BandBox辅助.abp   ← 可选，手动安装用（国内用户旁路）
```

## 发布流程

```bash
cd plugin/bandbox-helper
node scripts/publish.mjs            # 构建 → 同步 → 提交 → 推 AtomGit → 轮询校验 GitHub 镜像
```

`scripts/publish.mjs` 做四件事：

1. 调 `build.mjs --package` 产出 `dist/`（`dist/` 本身就是发布目录：manifest + wasm + icon + abp）；
2. 把 `dist/` 的四个文件同步到插件仓的 `release/`，写 `index.txt`（内容 `release`）与 `README.md`；
3. commit + push 到 **AtomGit**（GitHub 由镜像同步，脚本不碰）；
4. 轮询 `https://raw.githubusercontent.com/lkjhg10576/bandbox_helper/refs/heads/main/release/manifest.json`
   确认镜像落地（国内网络下这一步会超时，属正常，脚本会提示手动自查命令）。

改动插件后重跑同一条命令即可；`manifest.json` 的 `version` 要升，市场才认新版本。

## 首次上架（已做，只需重放 PR 部分）

1. Fork `AstralSightStudios/AstroBox-NG-Plugin-Repo`；
2. 在自己 fork 的 `index.txt` **末尾追加**一行（末尾斜杠必须留）：

   ```
   https://raw.githubusercontent.com/lkjhg10576/bandbox_helper/refs/heads/main/
   ```

3. 向上游 `main` 提 PR。描述要写：插件名 + 一句话简介 + API Level / WASI Version +
   权限清单（与 manifest 一致）+ 已知情况 + 测试情况。审核无响应时到创作者社群
   （QQ 群 1102457938）ping 一下；
4. 合并后等 Action（≤4 小时）重建 `index.json`，客户端下拉刷新市场即见。

**国内网络下 `gh` 走 git 协议克隆极慢，改用 API 提交**（2026-11-21 实测）：

```bash
gh api repos/<owner>/<repo>/contents/index.txt --jq '.sha'      # 取当前 sha
gh api --method PUT repos/<owner>/<repo>/contents/index.txt \
  -f message='Add BandBox辅助' -F body=@payload.json            # payload: {content: base64, sha}
gh api --method POST repos/AstralSightStudios/AstroBox-NG-Plugin-Repo/pulls \
  -f title='Add BandBox辅助' -F body=@pr-body.md -f head='<fork-owner>:main' -f base=main
```

（`gh pr create --head owner:repo` 与 `--head owner` 都会报 "Head sha can't be blank"，
`gh` 的 GraphQL 路径解析不了这个 fork；REST 的 `/pulls` 一次成功。）

## 四个必须钉死的坑

1. **分支名必须 `main`**。官方 index.txt 的基址是 `.../refs/heads/main/`；镜像推过去
   若是 `master`，raw 直接 404，聚合脚本报一行 warning，插件在市场里**静默消失**。
2. **GitHub 镜像仓必须公开**。市场客户端匿名拉 raw，私有仓 404。
3. **发布目录必须进 Git**。本仓 `.gitignore` 排除了 `dist/` 与 `plugin/*/dist/`，
   插件仓要另起 `.gitignore`，放行 `release/`。
4. **`website` 字段别写死链**。原值 `github.com/gcw_MchqrexB/MiBandBox` 那个仓**不存在**
   （404），已改成 `https://atomgit.com/gcw_MchqrexB/bandbox_helper`。

## 国内用户的下载问题（已知，未解）

市场下载走 `raw.githubusercontent.com`，国内被掐断 —— **镜像只解决了「我们推代码」的链路，
没解决「用户装插件」的链路**。三条旁路：

- 插件仓 `release/BandBox辅助.abp` 可手动装（AstroBox「从本地导入插件」）；
- 插件仓的 AtomGit raw 走 `api.gitcode.com/api/v5/repos/<owner>/<repo>/raw/<path>`（实测可吐
  3.3MB wasm，秒回）—— 但官方 index.txt 60 条全是 GitHub raw，偏离约定有审核风险，
  2026-11-21 决定**不赌**，走标准 GitHub raw；
- 快应用本体（rpk）也是同样的下载路径，属既有状况。

## 版本号

插件与快应用**共用同一条版本线**（见 AGENTS.md「双端版本号对齐」）。当前两者都是 `0.1.2`。
历史遗留：换源前的插件是 `0.3.x` 线（最高 0.3.3），所以从市场看版本号会「变小」——
那批旧插件目标包名还是 `com.miband.bandbox`，本来就该先卸载再装。
