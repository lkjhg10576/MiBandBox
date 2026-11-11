# BandBox Beta 通道

`beta/` 放的是**测试用**构建，不是对外发行版。

## 规则

- 触发条件：用户**没有特殊要求**时的默认动作就是打 Beta。
- 版本号（`versionName`）**不变**，`versionCode` **+1**。
- 产物目录名带 `versionCode`，每次 Beta 单独成目录，历史版本不会被覆盖：

  ```
  beta/
  ├── README.md
  └── BandBox-0.1.0-222/          # 版本号 0.1.0 + versionCode 222
      ├── com.miband.box.debug.0.1.0.rpk
      ├── BandBox辅助.abp
      ├── SHA256SUMS.txt
      └── 说明.md
  ```

- 每个目录的内容与发行版完全一样（jsc 字节码 rpk + 插件源码现编 abp + 校验和 + 说明），
  **同样不产出 zip 压缩包**。
- 打包命令：

  ```bash
  NODE_OPTIONS="--require $PWD/tools/copyfile-shim.cjs" bash tools/make-release.sh --beta
  ```

  脚本会把 `src/manifest.json` 的 `versionCode` 加一并同步其余三处版本号位置。

## 和发行版的关系

| | 版本号 | `versionCode` | 目录 |
|---|---|---|---|
| Beta | 不变 | +1 | `beta/BandBox-<版本>-<versionCode>/` |
| 发行版 | 升 | 不变 | `release/BandBox-<版本>/` |

发行版只有在你明确要求「打包一个新发行版」时才打，用的是当时 manifest 里的 `versionCode`，
所以正常流程是：Beta（+1）→ 测试通过 → 发行版（沿用当前 `versionCode`）→ 继续开发时下一个 Beta 再 +1。

完整约定见仓库根目录 `AGENTS.md` 与 `README.md` 的「打包与发行」章节。
