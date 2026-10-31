# BandBox UI 优化实施记录

对应计划：`docs/ui-optimization-plan.md`。

## 已完成

- 新增 `src/common/styles/theme.css`，统一页面、卡片、字号、提示的基线。
- 新增 `src/components/PageHead.ux`：时钟 15px（top 22）+ 标题 17px（top 42）+ `shadow.png` 顶部遮罩；44 个页面接入。
- `src/components/BackBtn.ux` 改为安全区内的圆形返回按钮，42 个页面自动受益。
- `src/pages/home/home.ux`：
  - 双栏 / 单栏两种布局；
  - 应用列表最后新增切换磁贴（第 27 项），点击立即切换并落盘；
  - `gridHeight` 按布局和项数动态计算；
  - `layoutReady` 保证首帧按最终布局渲染，避免 grid→list 跳变；
  - 单栏行高 72、名称 17、说明 14；双栏名称 16。
- `hset` 选择后写 kv 并返回；`set` 的“恢复默认设置”同步复位双栏。
- 删除启动屏：`manifest.entry` 改为 `pages/home`，删除 `pages/index` 路由与页面，路由数 48。
- 全量可读性：所有页面 `font-size` 下限 14px；标题 17px；所有可点控件移入安全区；卡片圆角统一 26px。
- 长列表改用 `<list>`：笔记本、目标日、歌词本、密码收藏夹。
- 文档同步：README / cleanroom 的页数与路由数改为 48。

## 实施中发现并处理的问题

1. **实际应用可视高度是 466px，不是 520px。** 模拟器截图显示 212×520 的画面中，底部 54px 为不可绘制的系统区域。所有底部提示、按钮、列表视口已上移到 `y <= 462`，避免被裁切。
2. **字体子集只有常规字重，`font-weight: bold` 会触发合成粗体，部分汉字在模拟器中变成豆腐块。** 为保证“无缺字/无截断”，全项目移除 `font-weight: bold`；层级改由字号、颜色和留白建立。
3. **80px 居中返回胶囊会与居中标题冲突。** 改为 28px 圆形返回按钮（`left:32, top:42`），标题保持居中，5 字标题也不重叠。
4. **`text-overflow: ellipsis` 在 PageHead 的居中标题上会把 3 字标题裁成 1 字。** PageHead 标题改为 `lines:1` 单行裁切，不再使用 ellipsis。
5. **`pages/index` 启动屏删除后，kv 读盘可能晚于首帧。** 首页用 `layoutReady` 把住应用网格的首次渲染，kv 回调到达后一次性按正确布局渲染；失败时降级双栏且不白屏。
6. **`<list>` 不支持 `scroll-y` 属性。** 已移除，构建无警告。

## 验收结果

- `router.entry == "pages/home"`，`router.pages` 48 条，无 `pages/index`。
- 全项目无 `font-size < 14px`，无 `font-weight: bold`。
- 源码字符集与字体 cmap 比对：仅 `storage.ux` 注释中的「桥」不在子集内（不渲染，无影响）。
- `npm run build` 成功，无警告；rpk 约 778 KB。
- 模拟器验证：冷启动直达首页；首页双栏/单栏即时切换；设置页切换后首页生效；恢复默认回到双栏；返回键、保存/完成按钮、底部提示均在安全区。
