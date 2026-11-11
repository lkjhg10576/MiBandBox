# BandBox 仓库约定

面向所有在本仓库干活的助手（AI 或人）。这里只写**必须照做**的约定，不写项目介绍。

## 打包与发行（2026-11-08 起，不要自行改动）

本项目有两条构建通道，打包方式完全相同，区别只在版本号策略与产物目录：

| 通道 | 什么时候打 | 版本号 `versionName` | `versionCode` | 产物目录 |
|---|---|---|---|---|
| **Beta** | 用户**没有特殊要求**时的默认动作 | 不变 | **+1** | `beta/BandBox-<版本>-<versionCode>/` |
| **发行版** | 用户**明确要求**「打包一个新发行版」 | **升** | 不变 | `release/BandBox-<版本>/` |

- 两条通道的产物内容一致：`com.miband.bandbox.debug.<版本>.rpk`（jsc 字节码）+ `BandBox辅助.abp`（插件源码现编）+ `SHA256SUMS.txt` + `说明.md`。
- **不再产出 zip 压缩包**。`release/*.zip` 是 0.4.x 时代的历史遗留，不要再生成新的。
- 打包命令：

  ```bash
  # Beta（默认）
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta
  # 发行版
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --release <版本> --notes notes/<版本>.md
  ```

  本机必须带 `copyfile-shim.cjs` 垫片，否则 `build:jsc` 会被沙箱的 `copy_file_range` 拦成 `EPERM`。
- 发行版的版本提要写 `notes/<版本>.md`，脚本会自动插进产物目录的 `说明.md`。
- `--prune` 只清 `release/` 下的旧发行版**目录**，不动历史 zip，也不影响 `beta/`。

## 版本号同步

版本号必须四处一致，脚本会自动改，手改也要改齐：

1. `src/manifest.json` — `versionName` / `versionCode`
2. `package.json` — `version`
3. `src/pages/about/about.ux` — `v<版本>`
4. `src/pages/set/set.ux` — `版本 <版本>`
5. `README.md` — 顶部「版本：」行

`tools/release-gate.mjs` 的 R6 规则会校验前三者与 README，打包前必过这道门禁。

插件版本号（`plugin/bandbox-helper/{manifest.json,package.json,package-lock.json}`）只在**插件源码真的改了**时才升，没改不要动。

## 记忆存储

本项目所有需要「记住」的约定、决策、约束与进度，统一写入 **PowerContext**
（`powercontext-project-context` 技能的 `remember_memory`，scope 用 `resolve_scope_binding` 解析出的绑定），
保证跨会话、跨助手共享；不要只写在本地文件或聊天里就当作已记住。

## 其它硬约束（勿破坏）

- 发行包内**不带性能埋点**：`src/utils/perf.js` 的 `ENABLED` 必须为 `false`，`src/app.ux` 不得 import 埋点模块。
- 页面对象**不得同时出现 `data` 与 `private`**（Vela 运行时直接抛错、页面黑屏）。
- **不要**用 `tools/png8.mjs` 转换带抗锯齿边缘的 UI 小图（0.4.0 的图标发毛事故）。
- `src/utils/{otp,otpAccounts}.js` 与 `plugin/bandbox-helper/src/` 下的同名文件必须逐字一致（cross 测试按 SHA-256 校验）。
- 合规红线：无激活/付费/引流、无第三方闭源依赖、无内置字库、数据全部自建或公共领域改写。
