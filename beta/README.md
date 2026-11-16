# BandBox Beta 通道

`beta/` 放的是**测试用**构建，不是对外发行版。

## 规则

- 触发条件：用户**没有特殊要求**时的默认动作就是打 Beta。
- **Beta 是「下个版本的测试」**：Beta 打的不是已发布版本的复刻，而是**下一个版本号的测试包** —— 所以 Beta 的 `versionName` **可以比当前发行版更高**（发行版 0.1.1、Beta 0.1.2 之类），这是正常的，不是版本错乱。
- **但版本号不是每次 Beta 都升**：默认 `versionName` **不变**、只把 `versionCode` **+1**；**只有用户明确要求升版本号时**才动 `versionName`（`--ver <版本>`），此时 `versionCode` 照旧 +1。
- 产物目录名带 `versionCode`，每次 Beta 单独成目录，历史版本不会被覆盖：

  ```
  beta/
  ├── README.md
  └── BandBox-0.1.2-261/          # 版本号 0.1.2 + versionCode 261
      ├── com.lkjhg.bandbox.debug.0.1.2.rpk
      ├── com.lkjhg.bandbox.pro.debug.0.1.2.rpk
      ├── BandBox辅助.abp
      ├── SHA256SUMS.txt
      └── 说明.md
  ```

- 每个目录的内容与发行版完全一样（jsc 字节码 rpk + 插件源码现编 abp + 校验和 + 说明），
  **同样不产出 zip 压缩包**。
- 打包命令：

  ```bash
  # 默认：版本号不动，只升 versionCode
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta
  # 用户明确要求升版本号时：--ver 升版本号，versionCode 照旧 +1
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta --ver 0.1.3
  ```

  脚本会把 `src/manifest.json` 的 `versionCode` 加一并同步其余版本号位置（快应用 5 处；传了 `--ver` 时连手机插件 4 处一起同步）。

## 和发行版的关系

| | 版本号 | `versionCode` | 目录 |
|---|---|---|---|
| Beta | 默认不变（明确要求时升） | +1 | `beta/BandBox-<版本>-<versionCode>/` |
| 发行版 | 升 | 严格递增取号（最大已用号 +1） | `release/BandBox-<版本>/` |

发行版只有在你明确要求「打包一个新发行版」时才打，版本号升、versionCode 取「所有已构建产物用过的最大号 + 1」；
正常流程是：Beta（versionCode +1）→ 测试通过 → 发行版（版本号升 + 严格取号）→ 继续开发时下一个 Beta 再 +1。

完整约定见仓库根目录 `AGENTS.md` 与 `README.md` 的「打包与发行」章节。
