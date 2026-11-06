# BandBox 五项体验问题修复计划

> **状态：仅规划，未执行。** 本轮只落盘本文档；未修改任何 `.ux` / `.js` / `manifest.json` / 数据集，未新增脚本，未构建、未部署、未跑测试。
>
> 编写日期：2026-11-06
> 基线：当前工作区，`src/manifest.json` 为 `0.3.4` / `versionCode 214`；Vela JS 快应用（`.ux`），212×520 跑道屏，设计基线见 `src/common/styles/theme.css`。
> 目标：修复用户提出的 5 项问题，保持既有约束：零联网必需、无新增第三方依赖、rpk < 1.5 MB、页面销毁清理定时器与传感器订阅、右滑返回不被横向拖动抢占。

---

## 0. 总体安排

| 顺序 | 问题 | 影响面 | 主要文件 |
|---|---|---|---|
| 1 | 红光手电首帧黑屏 | 单页、纯 UI | `src/pages/flashlight/flashlight.ux` |
| 2 | 手速测试误触重开 | 单页、状态机 | `src/pages/cpsTest/cpsTest.ux` |
| 3 | 水平仪方向相反 | 单页、传感器 | `src/pages/level/level.ux` |
| 4 | 跑马灯横屏与滚动 | 4 页 + 跨页传值 | `src/pages/marquee/*`、`src/pages/textShow/textShow.ux` 等 |
| 5 | 史载今日内容太少 | 数据 + 页面 | `src/data/history.js`、`src/pages/history/history.ux` |

上表「顺序」是建议的执行顺序，下文各节编号与之一致；与用户提出问题编号的对应关系：用户 ①=第 1 节、②=第 5 节、③=第 2 节、④=第 4 节、⑤=第 3 节。

按风险从低到高推进；每项独立改动、独立验证、独立回滚点，互不耦合。前四项都不触碰公共组件/全局样式；第五项只新增一个纯逻辑单测脚本。

**证据标注约定**：下文「已确认」= 直接读代码/官方文档得到；「推断」= 由代码事实推出的最可能原因，需用模拟器或真机验证后再定稿，修复方案不依赖该推断成立。

**通用验证命令**（执行阶段使用，本轮不运行）：

```bash
npm run build                 # dist/*.debug.*.rpk
npm run build:jsc             # 接近发布包
node tools/test-*.mjs         # 现有纯逻辑单测，含新增 test-history.mjs
./tools/deploy.sh             # 构建 + 安装 + 启动模拟器
.venv-emu/bin/python tools/emu.py shot out.png
```

**通用回归**：进入/退出 10 次无黑帧与卡状态；亮度/常亮、振动、返回按钮与右滑返回正常；`onHide/onDestroy` 后无定时器与订阅泄漏；构建包体积仍 < 1.5 MB。

---

## 1. 红光手电：进入页面先黑屏，切一次颜色才恢复

### 已确认事实

- `src/pages/flashlight/flashlight.ux:2` 根容器背景**唯一**依赖动态内联插值：`style="background-color: {{ color }};"`。
- 同文件 `:15` 的 `.page` 没有 `background-color`，且该页**未 `@import '../../common/styles/theme.css'`**（`theme.css:13` 本来提供黑底兜底）。应用级底色是黑：`src/manifest.json:57-59` 的 `display.backgroundColor = #000000`。
- `:39-45` 中 `data.color` 初值其实是 `#FF0000`（不是黑），模式表 `:30-36` 有 5 档（红光/暖橙/白光/冷光/关闭）。
- `:46-49` `onShow()` 同步调 `screen.enter()` 后调 `apply(0)`；`:56-69` 的 `apply()` 把 `color` 重新赋成 `MODES[0].color`，即与 `data` 初值**逐字相同**；`:70-72` 的 `next()` 才让值发生变化。全页无 `onInit/onReady`、无定时器、无 storage 读取、无条件渲染节点。
- 对照实现：`src/pages/display/display.ux:2-3,20-21` 用「`.page` 静态底色 + 独立全屏 `.fill` 层」；`src/pages/fluorescence/play/play.ux:2,14,94-97` 在根节点也用动态背景，但每 120ms 持续改值。本页两者都没有。
- `src/utils/screen.js:17-67` 只改亮度/常亮，不改 DOM 背景色；`:23-25` 的 `enter()` 是单例同步调用。

### 根因（推断，待实测确认）

首帧动态内联 `style` 未被渲染器写到节点上，容器透明 → 露出应用级黑底；`onShow` 的 `apply(0)` 因赋值同值不触发视图 patch，没有第二次写入机会；用户点一次切换后 `color` 值变化触发重绘，内联样式落地 → 恢复。**客观成立的缺陷**是「首帧颜色完全依赖动态插值、没有任何静态兜底」，无论上述时序推断是否成立都必须修掉。

### 修复方案（首选）

改 `src/pages/flashlight/flashlight.ux` 单文件，让**首帧颜色不依赖数据绑定**：

1. `.page` 加静态 `background-color: #FF0000;`（保留 `overflow:hidden`），作为首帧兜底。
2. 模板里增加 5 个全屏静态色层，按 `index` 用 `if` 条件渲染（不用动态 class 三元绑定，`release/BandBox-0.3.4/说明.md:24` 记录本渲染器上 class 三元绑定不可靠）：
   `<div class="fill fill0" if="{{ index === 0 }}"></div>` … `fill4`，`.fill0`~`.fill4` 在 CSS 里写死 5 个 `background-color`，尺寸 212×520、`position:absolute; left:0; top:0`。`data.index = 0` 直接决定首帧红光。
3. `MODES` 保留 `name/fg/hint`，`color` 字段可保留作元数据但**不再绑定到任何 style**；`:63` 判断「关闭」由 `m.color === '#000000'` 改为 `this.index === 4`，避免字符串比较误判。
4. 文字色 `:5,6,9` 的动态 `fg` 保留，但给 `.name/.hint/.arrow` 补静态 `color:#FFFFFF` 兜底（首帧是红光，白字正确）；若实测白光/冷光模式下深色文字不生效，再按第 2 步同样方式改为条件渲染的静态前景类。
5. `onShow()` 里的 `screen.enter()` 必须留在同步路径上（`src/pages/fluorescence/play/play.ux:62-65` 明确记录过「塞进异步回调会被时序吞掉」），不要挪进回调。

**备选（不推荐，仅在团队要求最小 diff 时）**：保留动态 style，另加一个静态红色的全屏 `.fill` 层，并在 `onShow` 里先把 `color` 置空再置回 `#FF0000` 强制触发一次 diff。该做法依赖渲染器的 diff 时序，仍可能复现首帧黑。

### 验收

- 冷启动后**第一次**从首页进入红光手电，首帧即整屏 `#FF0000`（模拟器 `emu.py shot` 截图 + 真机目视），文字可见。
- 连续点击切换 5 档颜色正确，含「关闭」黑屏；退出后系统亮度/常亮恢复（`src/utils/screen.js:69-87`）。
- 连续进出 10 次、从其它高亮页（荧光棒/显示测试）切入，均无黑帧。
- `npm run build` 通过，页面返回按钮与右滑返回正常。

### 风险

5 个静态层增加少量节点，但都在同一页面且互斥渲染，性能可忽略；唯一需要实测的是静态层与 `.top/.zone` 的层叠顺序，必要时给文字层加 `z-index`。回滚只需还原这一个文件。

---

## 2. 手速测试：改用独立「开始」按钮，避免结束后误触重开

### 已确认事实

- `src/pages/cpsTest/cpsTest.ux:6,25`：`.tapZone` 是覆盖整个 212×520 的 div，绑 `@click="onTap"`，页头、数字、进度、结果、提示全在它内部；只有兄弟节点 `<backbtn>`（`src/components/BackBtn.ux`，z-index 99）不受它影响。
- `:74-85` `onTap()` 在 `running` 时计数，在 `idle` / `done` 时直接 `start()`（`:82-84`）——这是误触重开的直接来源。
- `:127-139` `finish()` 把 `state` 停在 `'done'` 且 `hint` 写成「点击任意位置再试一次」（`:137`）；`:15` 的结果文本用 `if="{{ state === 'done' }}"` 展示，因此不能简单把 `state` 改回 `idle`，否则结果立刻消失。
- 计时链：`:86-109` 800ms×3 倒计时 → `:110-126` 80ms 刷新 5 秒进度 → `:127-139` 结算；`:68-73` `clearTimers()` 只清计时器、不重置 `state`。
- 现有布局：`.result` top 300、`.hint` top 448，中间 300~448 有空位；项目已有同类按钮样式 `src/pages/level/level.ux:33`（116×42 / radius 21）与 `src/pages/marqueeSet/marqueeSet.ux:69-70`（160×36 / radius 18）。

### 修复方案

改 `src/pages/cpsTest/cpsTest.ux` 单文件，把「启动」和「计数」拆成两个互斥的可点层：

1. `.tapZone` 去掉 `@click`，只作布局容器。
2. 新增仅在运行期存在的全屏计数层：`<div class="hitLayer" if="{{ state === 'running' }}" @click="onTap"></div>`，`position:absolute; 212×520; z-index:10`，透明。
3. 新增独立开始按钮：`<div class="startBtn" if="{{ state === 'idle' || state === 'done' }}" @click="start">`，建议 `left:26px; top:360px; width:160px; height:44px; border-radius:22px; z-index:20`，沿用项目按钮色（`#0D6EFF` 实底 + 白色 17px 粗体）；文案用两个 `if` 条件 `<text>` 分别表示「开始测试」/「再测一次」，避免依赖模板三元。
4. 两个可点层状态互斥，且都不是彼此的父节点 → 不存在点击冒泡导致「点按钮顺带 `count++` 或重复 `start()`」；`countdown` 期间两层都不存在，点击无效；`backbtn` 保持 z-index 99。
5. 脚本：`onTap()` 删除 `:82-84` 的 `idle/done → start()` 分支，只保留 `running` 计数（可加 `if (this.state !== 'running') return` 守卫）；`start()` 首行加防重入 `if (this.state !== 'idle' && this.state !== 'done') return`，避免连点按钮生成多个倒计时；`finish()` 的 `:137` 文案改为「点下方按钮再试一次」，`state` 继续保持 `'done'` 以保留结果；同步改 `:46` 初始 `status`、`:49` 初始 `hint` 及 `:94/:116` 提示文案，全部指向按钮。
6. 可选（同一问题的边界 bug）：`clearTimers()` 里一并重置 `state='idle'`、`count=0`、`progress=0`、`cps='0.00'`，修复测试中切后台回来卡在 `countdown`/`running` 的问题；若做，需保证结果展示逻辑不被影响。

### 验收

- 结算页连续点击屏幕任意位置 5 次，不启动第二轮；只有点「再测一次」才进入倒计时。
- `idle` 页同样只有按钮能启动；`running` 期间点全屏任意位置都计数；点按钮不会额外 `+1`。
- 倒计时 → 5 秒计时 → 结果 CPS 数值、进度条、振动提示与原来一致；结果一直显示到主动重测或退出。
- 返回按钮、时钟刷新、`onHide/onDestroy` 定时器清理正常；连点按钮 5 次只产生一个计时器。

### 风险

Vela 对动态 `if` 层与绝对定位层的点击命中需要实测；若 `.hitLayer` 挡住返回按钮，调整 `z-index`（保持 < 99）。不改状态机时长与计分规则。回滚只需还原这一个文件。

---

## 3. 水平仪：小球方向与实际倾斜相反

### 已确认事实

- `src/pages/level/level.ux:97-105`：只订阅 `@system.sensor.subscribeAccelerometer`，`interval: 200`（数字），由 `atan2(x, z)` / `atan2(y, z)` 得到 `rollRaw` / `pitchRaw`，再减校准偏移。
- `:107-108` 双轴 EMA（0.8 旧 + 0.2 新）；`:126-139` 换算到像素：`dotLeft = 97 + (cr/45)*70`、`dotTop = 173 - (cp/45)*70`，`:135` 注释写明「roll 为正向右，pitch 为正向上」；`:12,30` 用 `left/top` 定位 18×18 小球，中心基准 (106,182) 与准星一致。
- `:152-160` `calibrate()` 把当前角度累加进 `offsetRoll/offsetPitch` 后归零；`:141-150` 状态判定只用 `Math.abs`，不受符号影响。全文件**没有任何坐标轴映射/屏幕旋转补偿**。
- 官方 `subscribeAccelerometer` 的 `interval` 是字符串枚举 `game|ui|normal`（`vela-quickapp-dev` 技能 `references/api/system/system_sensor.md:35-46`），当前传数字 200 不合法；且该接口在小米手环 10 上受支持（同文档 `:100`）。
- `src/pages/level/level.ux:103` 只考虑了 `z→0`，未处理 `z<0`：`atan2(x, z)` 在 `z` 为负时落到 ±180° 象限，会被 `:136-137` 的 `clamp(±45)` 压到端点，视觉上就像「始终顶在一侧 / 方向反了」。`PLAN.md:127-130` 原方案用的是分母恒非负的 `atan2(x, sqrt(y²+z²))`，实际实现偏离了它。

### 根因（推断，必须先标定）

当前公式在「标准设备坐标系 + 小球滚向低侧」的语义下是自洽的；用户看到完全相反，最可能是：① 手环竖长屏的传感器轴相对屏幕旋转了 90°/180°，需要交换或反号轴；② 产品语义其实是「气泡指向高侧」，整体符号应取反；③ `z` 过零/负值导致的象限跳变放大了 ①。三者修复方式不同，**先标定再改符号**，不要凭感觉只改一行。

### 修复方案（分三步，均改 `src/pages/level/level.ux`）

**步骤 0｜轴标定（前置，阻塞后续）**：在真机（必要时模拟器注入读数）记录 5 组 `ret.x/y/z`——面朝上静止、右侧下沉、左侧下沉、顶部下沉、底部下沉；把读数与轴映射结论写进本节或发布说明。这一步只加临时日志，验收后移除。

**步骤 1｜数学稳健化**：
- `rollRaw = Math.atan2(ax, Math.sqrt(ay*ay + az*az))`、`pitchRaw = Math.atan2(ay, Math.sqrt(ax*ax + az*az))`，分母恒非负，消除 `z<0` 的 ±180° 跳变；
- `interval` 改为 `'ui'`（约 60ms，配合 EMA 更顺滑）或 `'normal'`（约 200ms，保持原节奏）；
- EMA、`clamp(±45)`、`MAX_OFFSET=70`、`formatAngle`、状态色逻辑保持不变。

**步骤 2｜集中式轴映射**：在文件顶部定义常量 `AXIS_MAP`（例如 `{ x: 1, y: -1, swap: false }`，或 90° 旋转时 `{ swap: true, ... }`），在 raw 层一次性完成符号/换轴，得到 `ax/ay/az`。角度读数（`:132-133`）、小球（`:138-139`）、校准（`:155-156`）全部用同一组 raw 值，避免「读数对、小球反」或「取反两次」。`calibrate()` 的偏移量必须与 raw 同号，否则「校准为零」会放大偏差。
- 若标定结论是「仅两轴都反向」：最小改动是 `:138` 的 `+`→`-`、`:139` 的 `-`→`+`，并同步改 `:135` 注释；单轴反向只改对应一行。
- 若是轴旋转 90°：必须交换 x/y 再按标定取符号，不能只改 `:138-139`。

**步骤 3｜语义统一**：明确小球是「滚向低侧的重物」还是「指示高侧的气泡」，二选一，并把 `:18` 的脚注「放平设备，圆点回到中心」补成与该语义一致的说明；UI 文案、角度读数符号、小球位移三者一致。

### 验收

- 四个方向倾斜，小球位移方向与选定语义一致；`Roll/Pitch` 读数符号与小球方向不矛盾。
- 面朝上静止时小球在准星中心、读数 ≈ 0；点「校准为零」后中心归零且继续倾斜时方向仍正确。
- 翻面（`z<0`）不再出现小球顶死一侧；快速来回倾斜无跳变、EMA 平滑。
- 进出页面 10 次，`subscribeAccelerometer` / `unsubscribeAccelerometer` 成对，常亮开关正常恢复。
- 结论与轴映射表记录到发布说明，便于其它机型复用。

### 风险与待确认

模拟器没有真实加速度计，方向类结论只能真机确认；不同机型（手环 10/11、圆屏手表）轴定义可能不同，建议把 `AXIS_MAP` 写成易改常量而不是散落的符号。**待用户确认**：小球语义（滚向低侧 / 气泡指高侧）。若暂不确认，按「滚向低侧」实现，因为这是传统水平仪的常见语义。

---

## 4. 跑马灯：横屏不生效、竖屏不滚动

### 已确认事实

**模式传递**
- `src/pages/marquee/marquee.ux:15-22,86-101`：竖屏/横屏两张卡片调 `play(mode)`，写 `kv.set('marqueeMode', mode)` + `kv.flush()` 后 `router.push('/pages/textShow', {..., mode})`。
- `src/pages/textShow/textShow.ux:52` 只信 KV：`kv.get('marqueeMode', this.mode) || this.mode`，**忽略路由参数**（`protected.mode` 默认 `'v'`）；`marqueeSet.ux:155-159` 的「保存并播放」和 `notebook/more/more.ux:71-88`（只跳到设置页）都不写 `marqueeMode`。KV 里残留的 `'h'` 会一直覆盖后续入口。
- `src/utils/kv.js:24-41,53-80`：`writeText` 异步、120ms 防抖、`init()` 会重读文件覆盖内存 `data`；`textShow.ux:45-55` 的 `kv.init` 回调又是异步的 → 模式判断存在竞态与滞后。
- 项目已有成熟解法：`src/pages/fluorescence/fluoroState.js` 明确记录「每个页面打成独立 bundle、模块变量不跨页共享；KV 异步会读到旧配置」，改为 `globalThis` 同步传值；`src/pages/fluorescence/play/play.ux:62-65` 在 `onShow` 同步路径读取。

**竖屏滚动**
- `src/pages/textShow/textShow.ux:4`：`<marquee class="f mqV" scrollamount="{{ speed }}" text-offset="40" loop="-1" ...>`，**没有 id、没有 `onReady`、没有调用 `start()`**；`protected.speed` 是字符串 `'6'`（`:30`），`loop="-1"` 是字符串字面量。
- 官方 `marquee` 文档（技能 `references/components/basic/basic_marquee.md:30-45`）示例明确要求在 `onReady()` 里 `this.$element('marquee').start()`；`scrollamount/loop/text-offset` 都是 `<number>`，另有 `direction`（默认 `left`），样式支持 `color` / `font-size`。全项目目前没有任何 `$element(...).start()` 调用（仅 `lyrics/show/show.ux:117` 使用 `scrollBy`）。
- 文本来自 `kv.init` 异步回调（`:46-51`），组件初始化时内容可能为空；`.mqV`（`:16`）没有 `font-size`，`protected.size` 读了却完全没用（`:48`），注释 `:42-44` 声称「marquee 字号锁死」与官方文档不一致，需实测。

**横屏**
- `src/pages/textShow/textShow.ux:6-7,66-77` 的「横屏」只是 56px 大字 + 定时器逐字循环字符串；`.mqH`（`:17`）带 `text-align:center; text-overflow:ellipsis; lines:1`，超宽文本被截成一行；页面仍是 212×520 竖屏画布（`:14`），全文件无 `rotate`/`orientation`。
- `src/pages/lyrics/show/show.ux:15-20,37-45` 有项目内**已实测可用**的真旋转方案：`.lyLandWrap { position:absolute; left:212px; top:0; width:520px; height:212px; transform-origin:0 0; transform:rotate(90deg); }`，注释记录了「绕中心旋转会向左溢出被裁剪 → 整块不渲染」的失败教训；`:115-120` 用 `scrollBy` 做匀速滚动。
- `src/manifest.json:60-225` 每个路由只有 `component`，**无页面级 `orientation` 配置**；全项目无屏幕方向 API。即横屏只能做「内容整块旋转 90°」，不能靠系统旋转。
- 其它坑：`release/BandBox-0.3.4/说明.md:24-25` 记录 class 三元绑定与 `$index` 不可靠、`list-item` 需确定高度；`textShow.ux:3,6` 用 `show` 切换两个分支，`stepTimer`（`:76`）未在 `private` 声明（`:35-38`）。

### 修复方案（分四阶段）

**阶段 A｜统一模式真源**（`src/pages/marquee/marquee.ux`、`src/pages/marqueeSet/marqueeSet.ux`、`src/pages/textShow/textShow.ux`，新增 `src/utils/marqueeState.js`）
1. 仿照 `src/pages/fluorescence/fluoroState.js` 新增 `marqueeState`：把 `{ text, size, speed, color, bg, mode }` 挂到 `globalThis` 的独立 key 上，跨页同步读写。
2. `marquee.ux:play(mode)` 在 `push` 前同步 `marqueeState.set({...当前配置, mode})`；`marqueeSet.ux:save()` 明确写入 `mode:'v'`（或用户上次选择）；KV 仍保留用于「记住上次配置」，但不再作为当次播放模式的判据。
3. `textShow.onShow()` 在**同步路径**上先读 `marqueeState.get()`，缺失时才回落 `protected` 参数 / `kv.init` 兜底；删除 `:52` 对 `marqueeMode` 的优先判定。这样既无 KV 残留，也无异步竞态。
4. `notebook/more.ux:71-88` 的路径只跳设置页，设置页保存时已写 mode，无需额外改动；改动清单里复核一次即可。

**阶段 B｜竖屏真正滚动**（`src/pages/textShow/textShow.ux`）
1. 首选按官方用法修 `<marquee>`：加 `id="mq"`，`scrollamount`/`loop`/`text-offset` 用数字（`Number(this.speed)`、`loop="{{ -1 }}"`、`text-offset="{{ 40 }}"`），补 `direction="left"`，把 `size` 通过 `font-size` 应用到 `.mqV`（若实测本渲染器确实锁死字号，走下一节的降级方案）。
2. 在 `onReady()` 与配置就绪回调里调用 `this.$element('mq').start()`；文本/速度变化后 `stop()` → `start()` 重启测量；`onHide/onDestroy` 停止。
3. **降级方案（推荐实现为可切换后端）**：若 marquee 仍不滚动，改用项目已验证的 `<scroll id="mqScroll" scroll-x="true">`（官方 `container_scroll.md:5,11-17` 支持横向滚动，`scrollBy({left})` 见 `:149-152`；`lyrics/show/show.ux:115-120` 已验证 `scrollBy` 可用）。文本重复两遍拼成超宽单行，用 `setInterval` + `scrollBy({ left: n, behavior:'instant' })` 推进，到边界 `scrollTo({left:0})` 形成无缝循环；字号/颜色用普通 `<text>` 的 CSS，完全可控。
4. 两种后端共用 `startScroll()/stopScroll()`，在 `onShow/onHide/onDestroy` 统一收口，避免定时器泄漏；`stepTimer` 之类的临时字段统一声明到 `private`。
5. 顺带修 `src/pages/marquee/marquee.ux:8` 的预览 `<marquee>`（同样补 `start()`，或改成静态预览并注明「预览不滚动」），避免用户误判播放效果。

**阶段 C｜真横屏**（`src/pages/textShow/textShow.ux`）
1. 复用 `lyrics/show/show.ux:41` 的 `.landWrap`：`left:212px; top:0; width:520px; height:212px; transform-origin:0 0; transform:rotate(90deg)`，内部放 520 宽的滚动条/文字，旋转后正好铺满 212×520。不要绕中心旋转，也不要给 `.page` 加 `transform`。
2. 删除 `:6-7` 的「56px + 逐字字符串位移」方案与 `stepText/stepTimer`；去掉 `ellipsis; lines:1`，改为单行超宽文本 + 横向滚动。旋转后的文字朝向在模拟器上截图校准（必要时改 `rotate(-90deg)` 或调整容器偏移）。
3. `:3,6` 的 `show` 换成 `if`（与歌词页一致，规避表达式绑定风险）；横竖两分支共用同一份配置与同一套滚动后端，只是容器尺寸/旋转不同。
4. 保持「轻触屏幕退出」（`:2,9,82-84`），退出层不要被旋转容器盖住。

**阶段 D｜配置生效与清理**
- 字号 24/30/38、速度 3/6/12、文字/背景颜色在竖屏与横屏两条路径上都要生效（当前 `size` 只在预览页有效）。
- `src/manifest.json` 不新增 `orientation`（该能力不存在）；README 中「竖屏 / 横屏全屏滚动」的措辞在执行阶段补充为「内容旋转模拟横屏」，避免歧义。

### 验收

- 从 `marquee` 页点「竖屏播放」：文字从右向左连续滚动，字号三档、速度三档、文字/背景色生效；短文本（如 `BandBox`）也能滚动。
- 点「横屏播放」：整块内容旋转 90° 铺满 212×520，文字方向可读、连续滚动，轻触退出。
- 从「设置页 → 保存并播放」和「笔记 → 推送至跑马灯 → 设置页 → 播放」进入时模式正确，不被上一次的 `'h'` 残留污染；连续 v/h 切换 10 次无滞后。
- 进出播放页 10 次无残留定时器，`onHide/onDestroy` 后停止滚动；返回手势与退出点击正常。

### 风险与待确认

- 本渲染器对 `<marquee>` 的 `start()` / `font-size` 支持需实测，故保留 `scroll + scrollBy` 降级路径；两条路径都要在同一台设备验证。
- 旋转容器与 `.page { overflow:hidden }` 的裁剪关系敏感，必须照抄歌词页已验证的坐标，不要自行改 `left/top/width/height`。
- **待用户确认**：横屏预期是「内容旋转 90°」（与歌词本一致、可立即实现）还是系统级方向切换（当前 Vela 快应用无页面级方向配置，需另行调研，可能不可实现）。

---

## 5. 史载今日：内容太少

### 已确认事实

- 数据全在 `src/data/history.js`：`:5-96` 的 `events` 是 **90 条** `'MM-DD' → 单个字符串`（每月 7~10 天）；`:98-111` 的 `tips` 是 **12 条**字符串。覆盖约 90/366 天，其余日期回落到 12 条轮换小知识。
- `:113-120` `getByDate()` 只返回一个字符串或 `null`，`tipOfDay()` 用 `(month*31+day) % 12` 取一条。
- `src/pages/history/history.ux:13-24` 是两张互斥卡片：有事件就渲染**一个** `<text>`（外层 `scroll` 只是让这一句能滚），没事件就显示「今日暂无大事记」+ 一条 tip；`:82-88` `refresh()`、`:89-102` 前后日切换。无 `for`、无列表、无分页、无多事件。
- `PLAN.md:148` 原计划是「按 366 天生成、每条 >20 字」，当前只做到 90 条；`tools/` 下没有 `gen-data` 生成脚本，现有 90 条为手写。`REPORT.md` 里「~300 条」描述的是被逆向的第三方样本，不是本项目现状，别拿它当基准。

### 修复方案（分三期，目标：任意日期都有 2~3 条可读内容）

**P1｜补齐全年，每天至少 1 条史实**
- `src/data/history.js` 的 `events` 补齐 366 个合法键（含 `02-29`），新增约 276 条；每条 ≥20 字、自写措辞、公共领域科技/文化事实，年份写在内容里。
- 数据格式升级为数组以承载多条：`'MM-DD': [{ year, title, text, tag }]`；迁移期允许 value 为旧的字符串，`getByDate()` 内部统一归一成数组，避免一次性重写 90 条旧数据。
- 内容口径：以科技、文化、探索、发明为主；避免现实时政、争议事件与人物评价，复核现有 90 条中同类表述并按同一口径处理；不引入外部版权语料、不联网。

**P2｜每天多条 + 小知识池扩容**
- 重点日期（节日、重大科技节点）补到 2~3 条；其余日期至少 1 条史实 + 1 条小知识，保证「任意日期都有 2 条以上可读内容」。
- `tips` 从 12 条扩到 ≥60 条；`tipOfDay(m,d)` 改成按 `(m,d)` 稳定散列取两条**不同**的 tip，避免一年内反复看到同一句。

**P3｜页面改成多条列表**（`src/pages/history/history.ux`）
- 删除 `:13-24` 两张互斥卡片，改成统一的 `scroll`（`scroll-y="true"`，固定 214px 高）+ `for` 渲染 `items`；每条一个固定高度条目：年份/分类小标签 + 标题 + 正文，可上下滚动看完全部内容。
- `refresh()`（`:82-88`）用 `getByDate()` 得到数组后拼 `items`；史实不足时用 `tipOfDay()` 补足，空态文案改为「今日小知识」，避免出现「暂无大事记」这种像缺内容的提示。
- 遵守 `release/BandBox-0.3.4/说明.md:24-25`：`scroll` + `for` 里不用 class 三元绑定、不用 `$index`，条目用 `$item` 字段；不用 `list`（`list-item` 需要确定高度）。
- 日期前后切换、时钟刷新、页头/返回按钮保持原样；页脚「公共领域科技事实」与新数据口径一致。

**校验脚本**：新增 `tools/test-history.mjs`（参照 `tools/test-lyrics-doc.mjs:11-19` 用 `pathToFileURL` 动态 import 纯 JS 模块），断言：
1. 366 个键且格式/日期合法（含 `02-29`，无 `02-30`）；
2. 每天 ≥1 条史实、重点日期 ≥2 条，每条 `text` ≥20 字，无重复文本；
3. `tips` ≥60 条、`tipOfDay` 对任意 `(m,d)` 返回两条不同且不越界；
4. `getByDate` 对字符串/数组两种旧新格式都返回数组，随机 20 天结果稳定；
5. 数据文件体积在预算内（`npm run build` 后核对 rpk < 1.5 MB；估算 276~700 条 × 60~100B ≈ 20~70 KB，可控）。

### 验收

- 任意一天（含 `02-29`、跨月/跨年切换）都显示 ≥2 条内容且能滚到底，无截断、无空白页。
- `node tools/test-history.mjs` 与现有 `node tools/test-*.mjs` 全绿；`npm run build` 通过，包体积不超门禁。
- 内容与日期对应、无虚构史实、无版权与外部依赖；README「按日期查看科技文化事件」描述与实际一致。

### 风险与待确认

- 数据录入是最大工作量，按月分批提交，每批跑校验脚本；不要一次性塞入未经复核的批量文本。
- `getByDate` 返回类型变化只影响 `history.ux` 一个调用方，改动前全局搜一次确认。
- **待用户确认**：目标密度是「全年每天 1 条史实 + 1 条小知识」还是「每天 2~3 条史实」（后者工作量约翻倍）；是否允许引入外部开放语料（本项目原则是自写、零联网，计划默认不允许）。

---

## 6. 执行阶段才做的事（本轮不做）

1. 按第 0 节顺序逐项落地，每项单独提交，附「改动文件 + 验收结果」。
2. 真机专项：#1 首帧、#3 传感器四向与翻面、#4 横屏旋转与滚动；模拟器只做布局与状态机回归。
3. 文档同步：`README.md`（跑马灯横屏措辞、史载今日内容量、手速测试交互）、`PLAN.md`（如与实现不符的条目）、新增版本目录下的 `说明.md`（六项坑位记录可复用）；`src/manifest.json`（0.3.4 / 214）与 `package.json`（0.3.2）版本号对齐。
4. 发布前跑一遍第 0 节通用回归与 `npm run build:jsc`，核对 `SHA256SUMS.txt` 与新版本产物。

## 7. 待确认事项汇总

| # | 事项 | 影响的方案 | 未确认时的默认 |
|---|---|---|---|
| 1 | 水平仪小球语义：滚向低侧 / 气泡指高侧 | #3 步骤 2、3 | 滚向低侧 |
| 2 | 手环真机的加速度计轴映射读数 | #3 全部 | 先做标定，不先改符号 |
| 3 | 跑马灯「横屏」是内容旋转还是系统方向切换 | #4 阶段 C | 内容旋转 90°（复用歌词页方案） |
| 4 | 史载今日的目标内容密度与外部语料许可 | #5 P1/P2 | 每天 ≥2 条、全部自写、不联网 |
| 5 | 手速测试结算后是否长期保留结果 | #2 第 5 步 | 保留到主动重测或退出 |

**本轮交付边界**：只新增 `FIXPLAN.md`。任何代码改动、测试脚本、构建产物、文档同步与部署，均留待用户确认计划后再执行。
