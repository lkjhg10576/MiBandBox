# BandBox UI 设计优化计划（基于 vela-watch-design）

## Summary

**目标**：按 `vela-watch-design` 设计系统优化 BandBox 的 UI，首要解决**手环端小屏幕的易读性**；主界面（首页）支持**双栏（现状）与单栏（一行一个）**两种模式；并在**所有功能列表的最后**新增一个**单/双栏模式切换入口**；**去掉进入应用后的启动屏**，启动即直达首页。

**关键设计决策**

1. **屏幕是药丸形，不是矩形** —— 这是本计划最重要的发现。Band 10 的 skin 定义 `corner_radius 104`（212×520），可见开口在顶部/底部迅速收窄（y=12 时仅约 51px 宽）。当前代码把 **返回键（全局 44 页）放在 `left:8, top:11`、设置按钮放在 `left:160, top:12`**，这两处在真实设备上被边框遮掉 **93% / 89%**。必须整体下移到安全区。
2. **字号体系与 skill 冲突，需取舍** —— skill 给的是 212×520 手表口径（标题 26px、正文 23px）；`vela-quickapp-dev` 明确给出 212dp 手环口径（标题 15-16dp、正文 13-14dp）。手环屏更小更窄，**采用手环口径**，并把正文下限锁在 14px。当前 49 个页面里 **41 个页面存在 ≤12px 文字**（共 122 处 ≤14px、68 处 ≤12px），是易读性的首要缺陷。
3. **复用现有资产、不引入新依赖** —— 保持 `px` 单位（项目 `designWidth: "device-width"`，1px = 1dp = 1 物理像素，212×520 上 1:1）；不引入 `dp`（会引入换算风险）。字体子集剩余 **仅 12 个汉字**（全部是标点），任何新文案必须复用现有字表，**不得引入新汉字**，否则需重建字体子集（当前 `fonttools` 与 `/tmp/opencode/fontenv` 均已缺失）。
4. **不动数据层** —— 纯前端改造，不改 `data/*.js`、不碰净室资产边界。**唯一的 manifest 改动是把入口从 `pages/index` 改为 `pages/home`**（因去除启动屏所必需），路由条目仍为 49 条（`pages/index` 条目保留但不再作为入口，或直接删除——见 §2.6）。
5. **删掉启动屏而非加速它** —— 不把 1100ms 缩短，而是**彻底移除** `pages/index` 这一屏：manifest 入口直接指向 `pages/home`。冷启动直接渲染首页，省掉一次页面切换与 1100ms 空窗。

**非目标（Non-goals）**：不做 466 圆屏适配；不新增应用功能；不改字体/图标资产来源；不重构 `data/` 数据集；不引入第三方库或联网能力；**不保留任何启动/欢迎页**（不改成"更快的闪屏"，也不做首启引导）。

---

## 1. 现状核查（已完成，附证据）

### 1.1 项目结构

- 技术栈：Vela JS 快应用（`.ux`），49 个页面 / 49 条路由，`src/manifest.json`
- 画布：212×520，`designWidth: "device-width"`，纯黑底
- 字体：`src/common/fonts/BandBoxSans.ttf`（551KB，Noto Sans CJK 子集，OFL 1.1）
- 已有工具链：`npm run build`（aiot-toolkit 2.0.5）、`tools/emu.py`（gRPC 截图/触摸）、`tools/gen-assets/gen.py`（PIL 自绘图标）
- 模拟器：VVD `~/.vela/vvd/Vela_Band10.vvd`，skin `xiaomi_band_10`

### 1.2 屏幕真实几何（关键约束）

`~/.vela/sdk/skins/builtin/xiaomi_band_10/layout`：

```
display { width 212  height 520  corner_radius 104 }
```

前景遮罩 `foreground.png`（212×520，alpha=0 处为**实际可见开口**）实测逐行可见宽度：

| y | 可见 xmin..xmax | 可见宽度 |
|---|---|---|
| 0 | — | ≈1px（圆尖） |
| 12 | 81..131 | **51px** |
| 16 | 68..144 | 77px |
| 24 | 51..160 | 110px |
| 32 | 40..171 | 132px |
| 40 | 31..180 | 150px |
| 60 | 16..195 | 180px |
| 110 | 2..209 | 208px（接近满宽） |
| 260 | 1..210 | 210px（满宽） |
| 410 | 2..209 | 208px |
| 470 | 24..187 | 164px |
| 490 | 45..166 | 122px |
| 500 | 62..149 | 88px |

**结论**：`y < 40` 与 `y > 480` 为严重收窄区；`y ∈ [40, 480]` 才是可靠的满宽工作区；`y=0..10` 几乎不可用。

### 1.3 现有 UI 遮挡缺陷（mask 实测，共 50 处越界）

| 元素 | 位置 | 可见率 | 页面 |
|---|---|---|---|
| `BackBtn.bbBack` | left:8 top:11 | **7%** | 全局 44 页 |
| `input.cancel` | left:8 top:11 | 7% | input |
| `home.setBtn` | left:160 top:12 | **11%** | home |
| `input.done` / `*.save` ×4 / `random.numBtn` | left:158 top:12 | 13% | 6 处 |
| `performance.ref` | left:154 top:12 | 18% | performance |
| `scoreboard.tVal` | top:10 全宽 | 51% | scoreboard |
| `display.top` / `fluorescence.top` / `flashlight.top` | top:8~12 全宽 | 53%~67% | 3 页 |
| `marqueeSet.go` | top:478 | 59% | marqueeSet |
| `plus` 圆形按钮（bottom 424） | left:132 w:64 | 91% | notebook/daysmatter/lylist list |
| `home.apps` 滚动区 | top:184 h:336 | 89% | home |

> 交叉验证：原厂 Hyper Box（`_re/hyperbox/`）在同一屏幕上把**返回箭头放在整幅 212×67 的 `back.png` 顶部渐变条上、箭头水平居中于 x=98..109**，而非左下角——即原厂也规避了左上角不可见区。本项目采用同一思路：**顶部控件水平居中，底部控件上移**。

### 1.4 字号易读性审计

- 49 页中 **41 页含 ≤12px 文字**；全项目 ≤14px 共 122 处、≤12px 共 68 处
- 最小字号 10px（input/marqueeSet/morseCode/system），11px 极多
- `vela-quickapp-dev` 手环口径要求：标题 15-16dp、正文 13-14dp、按钮 11-12dp、提示 10dp
- 对比：当前页面标题 26px、列表主标题 18-19px、副标题 12px

### 1.5 启动屏现状（本次新增需求的对象）

| 项 | 实测值 |
|---|---|
| manifest 入口 | `src/manifest.json:58` → `"entry": "pages/index"` |
| 页面实现 | `src/pages/index/index.ux`：发光光晕 + logo + "BandBox" 大标题 + "手腕上的百宝箱" + 分割线 + "净室实现 · 本地数据 · 无广告" + "v1.0.0" |
| 跳转逻辑 | `onShow` 内 `setTimeout(..., 1100)` → `router.replace('/pages/home')` |
| 引用情况 | **全项目仅 `src/manifest.json` 引用 `pages/index`**（另 `REPORT.md:58` 是对原厂行为的描述，不改） |
| 字符影响 | 该页文案用到的汉字中，仅「广」**未被其他页面使用**；其余（净/室/实/现/无/告/手/腕/上/的/百/宝/箱）均 elsewhere 在用 → 删除该页**不需重建字体子集** |
| 构建产物 | `build/manifest.json`、`build/manifest-watch.json` 均含 `entry: pages/index`；`build/pages/index/` 与 rpk 内 `pages/index/index.js` 由构建生成 |

### 1.6 其他发现

- `src/utils/theme.js` **已定义完整设计令牌但从未被任何页面 import**（死代码）
- `src/common/shadow.png`（212×84 顶部渐变）**已存在但全项目未使用**（skill 明确要求用顶部遮罩保证圆角区文字可读）
- 15 个页面用 `<scroll>` + `div for`，**0 个页面用 `<list>`**（skill 要求长列表用 `<list>` 虚拟滚动）
- 字体子集剩余可用汉字仅 **12 个**（〈〉『』【】﹣％＋－＝？）；`fonttools` 与 `/tmp/opencode/fontenv` 已缺失，`tools/gen-assets/font.py` 当前**无法运行**
- `src/pages/storage/storage.ux:101` 注释含「桥」字，字体子集不含该字（仅注释，不渲染，无影响）
- 现有图标资源齐全（`switch_on/off.png`、`plus.png`、`more.png`、`enter.png`、`empty.png`、`check.png`、`back.png`）

---

## 2. 方案架构

### 2.1 引入共享样式表（关键杠杆）

Vela 支持 `<style src="./style.css">` 与 `@import`（`vela-quickapp-dev/references/guide/framework/framework_style_index.md` 确认），支持 less/sass 预编译。

**做法**：新建 `src/common/styles/theme.css`（或 `theme.less`），用 **CSS 自定义属性不可用**（Vela CSS 是 flexbox 子集，不支持 `var()`），因此改为**约定式类名**：

```css
/* src/common/styles/theme.css —— 全局排版与安全区令牌 */
.page   { width: 212px; height: 520px; background-color: #000000; }
.header { position: absolute; left: 0px; top: 42px; width: 212px; height: 34px;
          line-height: 34px; text-align: center; font-size: 17px;
          font-weight: bold; color: #FFFFFF; }
.clock  { position: absolute; left: 0px; top: 22px; width: 212px; line-height: 22px;
          text-align: center; font-size: 15px; color: rgba(255,255,255,0.6); }
```

各页面 `<style>` 顶部 `@import '../../common/styles/theme.css';`（或 `<style src="...">`），页面内只写页面私有样式。

> 注意：Vela CSS **不支持后代选择器 / 属性选择器 / 伪类 / 通配符 / 多类交集**，因此全局类必须是**单类名**，页面私有样式不得与全局类重名。

### 2.2 安全区规范（Safe Area）

定义三条垂直带（基于 §1.2 实测）：

| 区域 | y 范围 | 规则 |
|---|---|---|
| **顶部死区** | 0–40 | 禁止任何可点控件；仅允许居中单行文字（宽度 ≤ 130px） |
| **安全工作区** | 40–480 | 满宽可用（x 0..212）；所有卡片、列表、按钮 |
| **底部收窄区** | 480–520 | 仅允许水平居中、宽度 ≤ 120px 的元素 |

**水平安全宽度**（按元素所在行取）：y=42→约 150px 宽（x 31..180）；y=60→180px；y≥110→210px。

**具体位移清单**

| 元素 | 现状 | 目标 |
|---|---|---|
| `BackBtn.bbBack` | left:8 top:11 | **改为顶部居中胶囊**：left:66 top:42, w:80 h:28；或按原厂做法做成 212×67 顶部渐变条 + 居中箭头 |
| `input.cancel` | left:8 top:11 | 同 BackBtn 规则，移入 top:42 |
| `input.done` / `*.save` / `random.numBtn` / `performance.ref` | left:158 top:12 | **改为右下安全角**：left:150 top:444（宽 44 仍在 y=444..468 可用宽度 ~180 内，x 需 ≤ 30+150=180 → 收紧为 left:136, w:44, 居右于 x=180） |
| `home.setBtn` | left:160 top:12 | 移至顶部栏安全位：left:136 top:42（宽 44 → x 136..180，安全） |
| `scoreboard.tVal` | top:10 全宽 | top:44 |
| `display.top` / `fluorescence.top` / `flashlight.top` | top:8~12 | top:44 |
| `marqueeSet.go` | top:478 | top:452（宽 160 → x 26..186，y=452 可见 ~178px，收紧为 left:26 w:160 或改居中 120px） |
| `plus` 圆形按钮 | left:132 top:424 | 保持居中 x=74..138（w=64），top:396（避开底部收窄） |
| `home.apps` 滚动区 | top:184 h:336 | top:184 h=272（至 y=456），底部留 64px 给圆角收窄 |

**顶部遮罩**：统一在所有页面引用 `src/common/shadow.png`（212×84，`position:absolute; left:0; top:0; width:212px; height:84px;`），压暗顶部区域保证 y=22..40 的时钟/标题在药丸尖端仍可读。

### 2.3 字号体系（手环口径）

| 用途 | 当前 | 目标 |
|---|---|---|
| 页面标题 | 26px | **17px bold**（下移至 top:42） |
| 顶部时间 | 17px | **15px**（top:22） |
| 卡片主标题 / 列表主标题 | 18–19px | **17px bold** |
| 列表副标题 | 12px | **14px**（下限） |
| 按钮文字 | 15px | **14px bold** |
| 辅助说明 / 提示 | 10–13px | **14px**（下限，≥14 一律不小于 14） |
| 极小角标（计数等） | 10px | **14px**（保留最少信息，宁可省略） |

**硬约束**：≤12px 的 68 处全部抬到 **≥14px**；信息放不下时**删字**而非缩字号（与 skill「文本超限用 ellipsis」一致）。

### 2.4 首页双栏 / 单栏（主界面）

现有实现已具备双/单栏切换（`kv` 键 `home`，值 `grid`/`list`），但存在三个问题：

1. **切换入口太深**：现状是 `设置 → 首页样式 → 双列/单列`（三步），且 `hset` 页面提示「选择后返回首页立即生效」但**未真正生效**（`home` 页 `onShow` 才读 kv，返回时若 kv 未落盘会回退）
2. **单栏 desc 字号 11px** → 不可读
3. **网格高度写死**：`gridHeight = 26 * 68 + 40`（list）/ `13 * 83 + 40`（grid），新增切换项后必须改动态计算

**改造方案**

- `src/data/apps.js` **保持 26 个应用不变**（避免破坏目录）
- 首页在应用网格**末尾追加一个切换磁贴**（第 27 项），文案「双栏/单栏」或图标区分，作为**所有功能列表的最后一项**
- 该磁贴**直接切换** `kv.set('home', mode)` 并立即重排，无需二次确认
- `set.ux` 的「首页样式」入口**保留**，与首页磁贴双向同步（两处都能切，读同一个 kv 键）
- 单栏模式：行高 62→**72px**，图标 34→36px，名称 15→**17px**，desc 11→**14px**（一行放不下 desc 时允许省略号截断）
- 双栏模式：磁贴 97×80，图标 30→**32px**，名称 15→**16px**（两栏各 97px 宽，16px 中文可放 6 字，够用）
- `gridHeight` 改为**按当前模式与项数动态计算**（27 项 → grid 14 行、list 27 行）

**磁贴位置的技术细节**：切换项在双栏下占 1 格（97×80），在单栏下占整行（200×62）。由于磁贴本身也是 grid 的一格，双栏模式下 27 项 = 14 行（最后一行只有 1 格 + 空位），需要处理尾部空行高度。

### 2.5 组件与规范收敛

- **启用 `src/utils/theme.js`**：把 `colors/font/radius/size` 令牌改为**页面可直接 import 的 JS 常量**（Vela 不支持 CSS 变量，但 `<style>` 里的值需静态字符串——因此采用「JS 导出 + 页面内联 style 绑定」或「CSS 约定类名」两种方式；**推荐 CSS 类名方案**，避免 49 页重复内联）。
- **`<list>` 替换 `<scroll>`**：notebook/list、daysmatter/list、lylist、set、about 等长列表页改用 `<list>` + `<list-item>`，获得虚拟滚动与复用（skill §8.3）。
- **统一卡片规格**：`206px × ≥72px`，`border-radius 26px`，`#262626`，`margin-bottom 8px`（现状已接近，仅个别页为 20/22/24/30px 圆角，统一为 26px）。
- **统一返回键**：`src/components/BackBtn.ux` 改为顶部居中胶囊，44 个引用页自动受益。
- **统一顶栏**：抽出 `src/components/PageHead.ux`（时钟 + 标题 + shadow 遮罩），49 页替换手写的 `.clock`/`.title`。
- **删除死代码**：`src/utils/theme.js` 若最终以 CSS 类名落地则删除或改为纯文档；避免"看起来在用其实没用"。

### 2.6 去掉启动屏（本次新增）

**目标**：冷启动**直接渲染首页**，不出现任何 logo / 大标题 / 版本号启动屏，也不做 1.1s 空窗。

**做法（三处改动，缺一不可）**

| # | 改动 | 文件 | 说明 |
|---|---|---|---|
| 1 | **入口改指首页** | `src/manifest.json` | `router.entry`：`"pages/index"` → `"pages/home"` |
| 2 | **删除启动屏页面** | `src/pages/index/index.ux` | 整个文件删除（内容仅为品牌展示 + 1100ms 定时跳转，无任何数据加载/鉴权/引导逻辑） |
| 3 | **移除路由条目** | `src/manifest.json` | `router.pages` 中删除 `"pages/index"` 条目 → 路由数 49 → **48** |

**为什么三条都要做**：只改 entry 会留下一个「注册了但无页面文件」的路由（构建期可能报缺页/空页）；只删文件不改 entry 会导致启动即白屏；只改 entry 不删文件会残留 786KB 里无用的启动屏代码。

**构建产物同步**：`build/manifest.json`、`build/manifest-watch.json`、`build/pages/index/` 与 rpk 内的 `pages/index/index.js` 均为**构建生成物**（`build/`、`dist/` 已在 `.gitignore`）。`aiot build` 的 `moveBackResult` 阶段会 `removeSync` 后再 `moveSync` 整个 build 目录 → **旧 `pages/index` 产物不会残留**，无需手工清理。

**冷启动时序影响（关键）**

- 现状：`app.ux onCreate` → `kv.init()` 启动异步读盘；`index` 页显示 1100ms（**恰好掩盖了读盘延迟**）；随后 `home.onShow` → `kv.init(cb)` → kv 已在 80ms 合并窗口内就绪 → **同步拿到 `layout`**
- 去掉启动屏后：`home.onShow` 可能在 kv 读盘完成前就渲染 → `this.layout` 停留在默认 `'grid'`，随后 kv 回调到达才切到 `'list'` → **出现"先双栏后单栏"的跳变**
- **对策**：`home.ux` 首屏渲染前用 `layoutReady` 标志位把关；`kv.init` 回调到达前不渲染应用网格（渲染骨架/空态），回调到达后一次性按正确布局渲染。目标：**首帧即最终布局，无跳变**
- 若 kv 读取失败（`fail` 分支已容错）：`layout` 保持默认 `'grid'`，`layoutReady` 置 true，页面正常渲染双栏 —— **失败降级不白屏**

**首页顶部"目标日"卡片**：其内容来自 `fs.readText('internal://files/bandbox/events.json')`，是**异步**的。现状下由启动屏的 1100ms 掩盖；去掉后首页会先显示占位文案「记录一个目标日 / 把重要的日子放在心上」，随后替换为真实内容。**这是可接受的渐进填充**（占位文案本身语义完整，不出现空白或"加载中"），无需额外处理。

**连带清理（非阻塞）**

- `README.md`：`49 个页面` → `48 个页面`；`49 条路由` → `48 条路由`；§功能首句提到首页为 2 列网格 → 同步为"双栏/单栏可切换"
- `docs/cleanroom.md`：自检项 `49 条路由全部有页面文件` → `48 条`
- `REPORT.md:58` 描述的是**原厂 Hyper Box** 的入口行为，**不改**（净室分析记录，非本项目实现）

**保留项**：`src/common/icon.png` 仍被 `about.ux` 与 manifest `icon` 字段使用，**不删除**。

---

## 3. 实施步骤（按依赖顺序）

### 阶段 A — 基础设施（无视觉变化，可独立验收）
1. 新建 `src/common/styles/theme.css`：`.page / .header / .clock / .card / .cardTitle / .cardSub / .btnText / .hint` 等**单类名**令牌类
2. 新建 `src/components/PageHead.ux`：时钟（15px，top:22）+ 标题（17px bold，top:42）+ `shadow.png` 顶部遮罩
3. 改造 `src/components/BackBtn.ux`：改为顶部居中胶囊（`left:66, top:42, w:80, h:28`）
4. 修正 `src/utils/theme.js`：与 CSS 令牌对齐，或删除并以 CSS 为唯一来源

### 阶段 B — 首页（本次需求核心）
5. `src/pages/home/home.ux`：
   - 引入 `PageHead`；`setBtn` 从 `left:160,top:12` 移到 `left:136,top:42`
   - `apps` 滚动区 `top:184 h:336` → `h:272`
   - 双栏/单栏样式按 §2.4 重排（字号、行高、图标尺寸）
   - **末尾追加切换磁贴**（第 27 项），点击即 `kv.set('home', ...)` 并重排
   - `gridHeight` 改为动态计算
   - **新增 `layoutReady` 标志**：`kv.init` 回调到达前不渲染网格，到达后一次性渲染正确布局（配合 §2.6 的冷启动时序要求）
6. `src/pages/hset/hset.ux`：改为**立即生效**（写 kv → `router.back()` → home `onShow` 重新读取），并同步首页磁贴文案
7. `src/pages/set/set.ux`：「首页样式」卡片副标题与磁贴状态一致

### 阶段 C — 去掉启动屏
8. `src/manifest.json`：`router.entry` → `"pages/home"`；删除 `router.pages` 中的 `"pages/index"` 条目
9. 删除 `src/pages/index/index.ux`（及其空目录）
10. `README.md` / `docs/cleanroom.md` 路由数与页数 49 → 48
11. 验证：`npm run build` 后确认 `build/manifest.json` 的 `entry` 为 `pages/home`、`build/pages/` 下无 `index` 残留、rpk 内无 `pages/index/index.js`

### 阶段 D — 全局可读性批量改造（48 页）
12. 逐页把 ≤12px 抬到 ≥14px；信息溢出时**删字**优先于缩字号
13. 逐页把标题 26px → 17px、时间 17px → 15px，并把标题行下移到 top:42（时钟留在 top:22）
14. 顶部/底部越界控件按 §2.2 位移表归位
15. 卡片圆角统一 26px、高度 ≥72px

### 阶段 E — 列表性能与收尾
16. 长列表页 `notebook/list`、`daysmatter/list`、`lylist`、`set`、`about`、`history` 等改 `<list>`
17. 全量扫描复核：字号下限、安全区、圆角一致性
18. 构建 + 模拟器截图逐页比对

---

## 4. 状态、并发与失败语义

- **布局状态**：`kv` 键 `home`，值 `grid` | `list`，默认 `grid`。读写经 `src/utils/kv.js`（内存缓存 + 120ms 防抖落盘 + 80ms 合并读）
- **写入时机**：切换磁贴点击 → `kv.set('home', mode)` → `kv.flush()` → 就地重排（不跳页、不重启）
- **读取时机与首帧一致性**：`home.onShow()` 调 `kv.init(cb)`；因 kv 有 80ms 合并窗口，**同一 tick 内切换后立即 `onShow` 可能读到旧值** → 磁贴切换必须**先写内存态 `this.layout` 再落盘**，页面重排不依赖 kv 回读
- **冷启动首帧（去掉启动屏后新增）**：`app.ux onCreate` 已先发起 `kv.init()`，但读盘是异步的；`home` 首帧可能早于读盘完成 → 用 `layoutReady` 标志位保证「首帧即最终布局」，避免 grid→list 跳变
- **失败降级**：`kv.init` 的 `fail` 分支已容错（保留默认值）；读取异常时默认双栏，且 `layoutReady` 仍置 true → **不白屏**
- **失败恢复**：`set.ux` 的「恢复默认设置」已实现双击确认 + `kv.reset()` + `kv.flush()`；本计划需让该动作**同时把首页磁贴复位为「双栏网格」**
- **目标日卡片**：`fs.readText` 异步，失败时保留占位文案（语义完整，不显示空白）
- **计时器**：所有页面 `onHide`/`onDestroy` 已 `clearInterval`；新增组件不得引入常驻定时器（时钟沿用现有 20s `setInterval`）。删除 `index.ux` 后，其 `setTimeout` 定时器随之消失，无泄漏
- **字体**：**禁止引入现有子集之外的汉字**。删除 `index.ux` 不影响字表（其文案用字均 elsewhere 在用，仅「广」成为未使用字，**不需重建子集**）。若确需新字：`pip install fonttools` → `python3 tools/gen-assets/font.py --exact`（本机 `fonttools` 当前缺失，需先装）
- **构建**：`npm run build` → `dist/*.rpk`；`./tools/deploy.sh` 推送到 `emulator-5554`

---

## 5. 测试与验收标准

### 5.1 静态检查（可脚本化）
- 全部 `src/pages/**/*.ux` 中**不存在 `font-size` < 14px**
- 全部绝对定位元素**落在安全区**内（y ∈ [40,480] 或为顶部居中文字）
- 卡片 `border-radius` 统一 26px、`width` 206px
- 源码中**不新增**子集外汉字（脚本比对 cmap 与源码字符集）
- `src/manifest.json` 的 `router.entry == "pages/home"`，且 `router.pages` 中**不存在** `pages/index`
- `src/pages/index/` **不存在**

### 5.2 构建验收
- `npm run build` 零错误、零新增警告
- 路由数 **48**，rpk 体积 ≤ 当前（约 786KB，字体不变则应基本持平）
- `build/manifest.json` 的 `entry` 为 `pages/home`；`build/pages/` 下无 `index` 目录；rpk 内无 `pages/index/index.js`

### 5.3 模拟器视觉验收（212×520，`xiaomi_band_10` skin）
- **冷启动首帧即为首页**：无 logo、无 "BandBox" 大标题、无版本号启动屏，**无黑屏空窗**
- 对**每一页**截图，并与 `foreground.png` 遮罩叠加核对：
  - 顶部时钟/标题在药丸尖端**完整可读**（不被边框切掉）
  - 返回键、设置/保存/完成按钮**完整可见且可点**
  - 底部圆形按钮（plus）完整可见
  - 文字无溢出、无截断成半个字

### 5.4 功能验收
- 冷启动直接进入首页；**首帧布局即为最终布局**（选单栏的用户不会看到"先双栏后单栏"的跳变）
- 首页**双栏**显示 26 个应用 + 末尾切换磁贴（27 格）
- 点击末尾磁贴 → **立即**变为单栏（无需返回/重启），磁贴文案同步变化
- 从「设置 → 首页样式」切换 → 返回首页**立即生效**（当前是「不生效」，属修复项）
- 单栏下每行一个应用，名称 17px、副标题 14px 可读
- 「恢复默认设置」后首页回到双栏
- 48 页逐页点测返回键，无死路

---

## 6. 风险与未决事项

### 6.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 字号整体上调（12→14px）导致文本溢出 | 页面文字被截断 | 逐页「删字优先」；`text-overflow: ellipsis` 兜底；阶段 D 后逐页截图复核 |
| 标题从 26px 降到 17px，视觉层级变弱 | 观感偏平 | 依赖 `bold` + 顶部遮罩 + 更大留白建立层级；17px 已是 quickapp-dev 手环上限 |
| 44 页顶栏改造量大 | 回归面广 | 用 `PageHead` 组件一次性替换，逐页截图比对；先做 6 个代表性页面验证样式再批量铺开 |
| 遮罩 `foreground.png` 与真机不完全一致 | 模拟器通过但真机仍偏 | 遮罩上界 + 药丸几何双保险；建议真机复测顶部/底部 |
| 字体子集零余量 | 新增文案显示豆腐块 | 静态检查拦截；必要时重建子集 |
| **去掉启动屏后首帧布局跳变** | 用户看到 grid→list 闪跳 | `layoutReady` 标志位：kv 回调到达前不渲染网格，到达后一次性渲染；kv 失败时降级双栏且不白屏 |
| **去掉启动屏后目标日卡片占位文案暴露更早** | 首帧显示「记录一个目标日」而非真实内容 | 占位文案语义完整，可接受；如需彻底消除需引入读盘前置等待（**不建议**，会牺牲去屏收益） |

### 6.2 未决决策（需实现阶段确认，可在实施中按默认执行）

1. **顶部返回键形态**：采用「居中胶囊」（`left:66, top:42`）还是「原厂式整幅顶部渐变条 + 居中箭头」（212×67 `back.png`）。**默认：居中胶囊**（改动小、与现有 BackBtn 兼容）；若实机观感不佳再切原厂式。
2. **切换磁贴位置**：放在应用列表**最末**（第 27 项，双栏下独占末行）还是固定在标题栏右上角。**默认：最末**，符合用户「所有功能的最后」表述。
3. **切换磁贴文案**：「双栏 ⇄ 单栏」纯文字，还是补一枚自绘图标（`tools/gen-assets/gen.py` 可生成，但需确认新增图标不影响字体子集——图标是 PNG 不涉及字表）。**默认：文字 + 现有 `switch_on/off.png` 组合**，不新增图标文件。
4. **`pages/index` 路由条目是删除还是保留为死路由**：**默认：删除**（路由数 49→48，构建产物干净）；保留会让 manifest 出现无页面文件的条目。

### 6.3 明确不做

- 不引入 466 圆屏分支（用户已定：只适配手环 10/11）
- 不改 `src/data/*` 数据集与文案
- 不新增联网/权限
- 不替换字体来源或引入未授权字体
- **不保留启动屏**（不改成"更快的闪屏"，也不做首启引导页）
- 不修改 `REPORT.md`（其为原厂 Hyper Box 的逆向分析记录，非本项目实现）
