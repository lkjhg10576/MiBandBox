# BandBox

BandBox 是一个为小米手环 10 / 11（212×520 跑道屏）设计的本地小工具箱，包含 26 个应用、48 个页面。

- 包名：`com.miband.box`
- 版本：1.0.0
- 技术栈：Vela JS 快应用（`.ux`）
- 画布：212 × 520，纯黑背景
- 体积：约 778 KB（含中文字体子集）
- 无联网必需、无收费、无授权、无第三方 App 依赖

## 功能

首页支持双栏网格 / 单栏列表切换（入口在应用列表最后），顶部显示最近的目标日：

| 工具 | 说明 |
|---|---|
| 计算器 | 四则运算、括号、百分号、开方、幂 |
| 笔记本 | 新建 / 编辑 / 重命名 / 二维码分享 / 删除 |
| 荧光棒 | 彩色条纹循环，可暂停 |
| 目标日 | 倒数 / 纪念日，日期选择器，本地保存 |
| 每日一言 | 100 条自撰短句，可收藏 |
| 密码生成 | 长度 8–32，字符集可勾选，收藏夹 |
| 答案之书 | 随机答案，淡入展示 |
| 振动器 | 短振 / 长振 / 节奏，间隔可调 |
| 剩余时间 | 今日与今年倒计时 + 进度条 |
| 存储空间 | 已用 / 可用 / 总量环图 |
| 木鱼 | 功德计数，本地保存 |
| 显示测试 | 12 种纯色，检查坏点与色偏 |
| 红光手电 | 红光 / 暖橙 / 白光 / 冷光，亮度拉满 |
| 手速测试 | 3 秒倒计时 + CPS |
| 今日饮食 | 吃什么 / 喝什么随机 |
| 随机数 | 区间调整 + 滚动抽取 |
| 系统信息 | 型号、系统、屏幕、设备标识、存储 |
| 性能测试 | 对象 / 数组 / 数学 / 排序四项参考分 |
| 参考分数 | 机型参考分列表 |
| 史载今日 | 按日期查看科技文化事件，缺省给科技小知识 |
| 记分牌 | 红蓝计分 + 计时器 |
| 摩斯密码 | 文本转电码、自动播放、手动点划 |
| 垃圾分类 | 200+ 物品词表，五分类 |
| 快捷生码 | 文本 / 网址 / WiFi 二维码 |
| 跑马灯 | 文字、字号、速度、颜色，全屏滚动 |
| 歌词本 | 本地歌词、自动滚动、横竖屏 |
| 水平仪 | 加速度计倾角 + 分段圆环 |

## 构建

```bash
npm install
npm run build          # 开发包：dist/*.debug.*.rpk
npm run build:jsc      # 生成 jsc 字节码，更接近发布包
```

`aiot-toolkit` 已写入 `devDependencies`。如果使用 AIoT-IDE 的内置工具链，也可在 IDE 中直接构建。

发布包需要自己的签名证书（`aiot release`），开发/模拟器验证用 `npm run build` 即可。

## 安装到模拟器

模拟器需先启动（AIoT-IDE 的 Vela 模拟器，212×520，skin `xiaomi_band_10`）。

```bash
# 自动构建 + 安装 + 启动
./tools/deploy.sh

# 或手动
adb push dist/*.rpk /data/app/com.miband.box.rpk
adb shell mkdir /data/app/com.miband.box
adb shell unzip -o /data/app/com.miband.box.rpk -d /data/app/com.miband.box
adb shell am start com.miband.box
```

截图 / 触摸 / 日志：

```bash
.venv-emu/bin/python tools/emu.py shot out.png
.venv-emu/bin/python tools/emu.py tap 106 260
.venv-emu/bin/python tools/emu.py swipe 106 450 106 120 --ms 600
```

## 目录

```
src/
├── manifest.json          48 条路由、权限、features
├── app.ux                 全局字体与 KV 初始化
├── common/                自绘图标、公共图、字体子集
├── components/
│   ├── BackBtn.ux         统一返回按钮
│   └── Ring.ux            弧形进度环（原生 progress arc）
├── data/                  自建数据集（apps/quotes/answers/food/history/waste/morse/colors/perf）
├── utils/                 kv / fs / docs / time / haptic / router / calc / inputResult
└── pages/                 48 个页面（含 input 文本输入页）
```

## 许可

- 中文字体为 Noto Sans CJK / 思源黑体的 **OFL 1.1** 子集，仅包含源码实际用到的字。

## 已验证

在 212×520 Vela 模拟器（`xiaomi_band_10` skin）上实测：

- 构建、安装、启动、返回、首页双列/单列切换
- 笔记本：新建 → 标题/正文输入 → 保存 → 列表 → 阅读
- 目标日：新建 → 保存 → 列表倒计时 → 首页最近事件
- 存储空间环图、系统信息 12 项、水平仪传感器读数
- 记分牌计时器与红蓝计分、手速测试倒计时与 CPS
- 显示测试色卡、红光手电亮度切换、木鱼计数
- 跑马灯设置与全屏滚动、歌词本空态、答案之书、每日一言
- 数字滚动（从随机数页进入）、计算器/密码/摩斯/垃圾分类/二维码页面与入口
- 最终 rpk：约 778 KB，48 条路由，无构建警告

内容管理中的重命名、收藏夹、歌词保存等子流程已做代码审查与编译验证，建议在真机上再逐项点测。

## 已知限制

- 自带输入页支持英文、数字与符号；中文内容通过内置数据集呈现，不提供拼音输入。
- 歌词本完全离线，不提供在线搜索（避免第三方接口依赖）。
- 性能分为相对参考值，受温度、后台任务和模拟器影响。
- 模拟器冷启动约 10 秒，是 Vela 运行时调试器发现超时导致；真机通常更快。
- 模拟器的鼠标/触摸坐标与画面存在约 40 px 偏移，自动化截图时需自行校准；真机触摸正常。

## 致谢

感谢小米 Vela 平台、AIoT-IDE 与开源社区提供的文档与示例。字体来自 Noto Sans CJK（SIL Open Font License 1.1）。
