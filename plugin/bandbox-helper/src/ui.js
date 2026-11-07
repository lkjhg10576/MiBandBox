/**
 * 插件界面：使用 AstroBox 原生声明式 UI（ui 接口）。
 *
 * 注意：v4 的 ui 元素方法名是 camelCase（flexDirection / scrollTop ...），
 * 枚举值是大写字符串（'DIV' / 'BUTTON' / 'SCROLL-AREA' ...）。
 *
 * 布局：顶部两个 Tab（歌词同步 / 动态口令），按 state.tab 分支渲染。
 * 歌词区的结构保持与 0.2.x 逐字一致（回归风险最小化）；
 * 动态口令区为 0.3.0 新增，弹窗用自绘 DIV 覆盖层。
 */
import { Element, render } from 'astrobox:psys-host-v4/ui'

const C = {
  bg: '#111417',
  card: '#1E2226',
  text: '#FFFFFF',
  dim: 'rgba(255,255,255,0.55)',
  accent: '#0D6EFF',
  ok: '#00A846',
  warn: '#FF9F0A',
  danger: '#B3261E'
}

/**
 * 造一个元素。
 */
function el(type, content) {
  return new Element(type, content === undefined ? undefined : String(content))
}

/**
 * 造一个文本块。
 */
function text(content, color, size) {
  return el('P', content).textColor(color || C.text).size(size || 14)
}

/**
 * 造一个卡片容器。
 */
function card(children) {
  const c = el('DIV').bg(C.card).radius(16).padding(14).widthFull()
  for (let i = 0; i < children.length; i++) {
    c.child(children[i])
  }
  return c
}

/**
 * 造一个按钮。
 */
function button(label, id, bgColor) {
  return el('BUTTON', label)
    .bg(bgColor || C.accent)
    .textColor('#FFFFFF')
    .radius(12)
    .padding(10)
    .on('CLICK', id)
}

/**
 * 造一个多行输入框（WIT 无 placeholder，用上方小标签说明）。
 */
function textarea(value, inputId, height) {
  const t = new Element('TEXTAREA', value === undefined ? '' : String(value))
    .bg('#15181B')
    .textColor(C.text)
    .radius(10)
    .padding(8)
    .widthFull()
  if (height) t.height(height)
  return t.on('INPUT', inputId)
}

/**
 * 造一个 Tab 按钮行。
 */
function tabBar(tab) {
  const bar = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
  const lyricsBg = tab === 'lyrics' ? C.accent : '#33383D'
  const otpBg = tab === 'otp' ? C.accent : '#33383D'
  bar.child(button('歌词同步', 'tab-lyrics', lyricsBg).flexGrow(1))
  bar.child(button('动态口令', 'tab-otp', otpBg).flexGrow(1))
  return bar
}

// ------------------------------------------------------------------
// 歌词 Tab（0.2.x 结构逐字保留）
// ------------------------------------------------------------------

function renderLyricsTab(root, state) {
  // ---- 顶部：手环信息 ----
  const devLines = []
  if (state.deviceName) {
    const online = state.watchOnline ? ' · 在线' : ''
    const saved = state.deviceSource === 'saved' ? ' · 历史设备' : ''
    devLines.push(text('手环：' + state.deviceName + saved + online, C.text, 15))
  } else {
    devLines.push(text('未检测到已连接的手环', C.dim, 15))
    devLines.push(text('请确认 AstroBox 已连接手环，并允许插件的设备权限', C.dim, 12))
  }
  if (state.deviceAddr) {
    devLines.push(text(state.deviceAddr, C.dim, 12))
  }
  if (state.deviceCount > 1) {
    devLines.push(text('共 ' + state.deviceCount + ' 个已连接设备', C.dim, 12))
  }
  root.child(card(devLines))

  // ---- 状态区 ----
  const statusColor =
    state.status === 'sent' ? C.ok :
    state.status === 'failed' ? C.warn :
    state.status === 'sending' ? C.accent : C.dim
  root.child(card([text(state.statusText, statusColor, 15)]))

  // ---- 设备刷新 / 诊断 ----
  const tools = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
  tools.child(button('刷新设备', 'refresh-devices', '#33383D').flexGrow(1))
  tools.child(button(state.debug ? '关闭诊断' : '诊断', 'toggle-debug', '#33383D').flexGrow(1))
  root.child(tools)

  // ---- 诊断（放在顶部，避免被预览区挤出屏幕）----
  if (state.debug) {
    const dbg = []
    dbg.push(text('平台：' + (state.platform || '未知'), C.dim, 12))
    dbg.push(
      text(
        '设备：' + state.deviceCount + ' 个' +
          (state.deviceSource ? '（' + state.deviceSource + '）' : ''),
        C.dim,
        12
      )
    )
    dbg.push(text('UI：' + (state.lastUiEvent || '无'), C.dim, 12))
    dbg.push(text('动作：' + (state.lastAction || '无'), C.dim, 12))
    dbg.push(text('手环：' + (state.lastReply || '无'), C.dim, 12))
    dbg.push(text('选择：' + (state.pickResult || '无'), C.dim, 12))
    dbg.push(text('宿主：' + (state.lastHost || '无'), C.dim, 12))
    root.child(card(dbg))
  }

  // ---- 选择文件 ----
  root.child(button('选择 LRC 文件', 'pick-file'))

  // ---- 预览 ----
  if (state.fileName || state.title) {
    const preview = []
    preview.push(text('歌名：' + (state.title || '（未命名）'), C.text, 15))
    preview.push(
      text(
        '行数：' + state.lineCount + '  字数：' + state.charCount,
        C.dim,
        13
      )
    )
    const sample = state.previewLines.join('\n')
    if (sample) {
      const box = el('SCROLL-AREA').height(160).widthFull().bg('#15181B').radius(10)
      box.child(text(sample, C.dim, 13))
      preview.push(box)
    }
    root.child(card(preview))
  }

  // ---- 发送 ----
  if (state.hasContent) {
    root.child(button('发送到手环', 'send', state.status === 'sending' ? C.dim : C.accent))
  }

  // ---- 多设备选择 ----
  if (state.needsDeviceChoice && state.devices.length > 1) {
    const opts = []
    opts.push(text('选择目标手环：', C.text, 15))
    for (let i = 0; i < state.devices.length; i++) {
      const d = state.devices[i]
      opts.push(button(d.name + ' (' + d.addr + ')', 'pick-device:' + d.addr, '#33383D'))
    }
    root.child(card(opts))
  }

  // ---- 错误 ----
  if (state.lastError) {
    root.child(card([text(state.lastError, C.warn, 13)]))
  }
}

// ------------------------------------------------------------------
// 动态口令 Tab（0.3.0 新增）
// ------------------------------------------------------------------

function renderOtpTab(root, state) {
  // ---- 设备与同步状态 ----
  const otpLines = []
  if (state.deviceName) {
    otpLines.push(text('手环：' + state.deviceName + (state.watchOnline ? ' · 在线' : ''), C.text, 15))
  } else {
    otpLines.push(text('未检测到已连接的手环', C.dim, 15))
  }
  otpLines.push(text(state.otpStatusText, state.otpBusy ? C.accent : C.dim, 13))
  if (state.timeSkewSec !== 0 && state.otpLoaded) {
    otpLines.push(
      text(
        '手表时间偏差 ' + (state.timeSkewSec > 0 ? '快' : '慢') + ' ' + Math.abs(state.timeSkewSec) + ' 秒',
        C.warn,
        13
      )
    )
  }
  root.child(card(otpLines))

  // ---- 时间偏差修正 ----
  if (state.otpLoaded && Math.abs(state.timeSkewSec) >= 5) {
    const fix = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
    fix.child(
      button('按偏差 ' + (state.timeSkewSec > 0 ? '-' : '+') + Math.abs(state.timeSkewSec) + 's 校时', 'otp-offset-apply', C.warn).flexGrow(1)
    )
    fix.child(button('忽略', 'otp-offset-dismiss', '#33383D'))
    root.child(fix)
  }

  // ---- 操作行 ----
  const ops = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
  ops.child(button('拉取数据', 'otp-pull', '#33383D').flexGrow(1))
  ops.child(button('添加账户', 'otp-add', '#33383D').flexGrow(1))
  root.child(ops)

  // ---- 账户列表（实时验证码）----
  if (state.otpLoaded && state.otpAccounts.length) {
    for (let i = 0; i < state.otpAccounts.length; i++) {
      const item = state.otpAccounts[i]
      const lines = []
      lines.push(text(item.title, C.text, 15))
      if (item.state === 'ok') {
        lines.push(text(item.code, item.remaining <= 5 ? C.warn : C.ok, 22))
        lines.push(text('剩余 ' + item.remaining + ' 秒 · ' + item.sub, C.dim, 12))
      } else {
        lines.push(text(item.state === 'unsupported' ? '算法暂不支持' : '密钥无效', C.warn, 15))
      }
      const row = card(lines)
      const btns = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
      btns.child(button('编辑', 'otp-edit:' + item.id, '#33383D').flexGrow(1))
      btns.child(button('删除', 'otp-del:' + item.id, C.danger).flexGrow(1))
      row.child(btns)
      root.child(row)
    }
  } else if (state.otpLoaded) {
    root.child(card([text('还没有账户，点「添加账户」或「批量粘贴」导入', C.dim, 14)]))
  } else {
    root.child(card([text('先点「拉取数据」从手环读取账户', C.dim, 14)]))
  }

  // ---- 批量工具 + 保存 ----
  const batch = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
  batch.child(button('批量粘贴', 'otp-paste', '#33383D').flexGrow(1))
  batch.child(button('批量导出', 'otp-export', '#33383D').flexGrow(1))
  root.child(batch)

  const pendingLabel = state.otpPending > 0
    ? '保存修改（' + state.otpPending + '）'
    : '保存修改'
  root.child(button(pendingLabel, 'otp-save', state.otpPending > 0 ? C.accent : '#33383D'))

  // ---- 错误 ----
  if (state.lastError) {
    root.child(card([text(state.lastError, C.warn, 13)]))
  }
}

// ------------------------------------------------------------------
// 弹窗覆盖层（自绘 DIV，每次 repaint 整棵重建）
// ------------------------------------------------------------------

function renderDialog(root, state) {
  const d = state.otpDialog
  if (!d) return
  const overlay = el('DIV')
    .bg('#0B0E11')
    .radius(16)
    .padding(14)
    .widthFull()
    .border(1, C.accent)

  if (d.kind === 'edit') {
    overlay.child(text(d.editId ? '编辑账户' : '添加账户', C.text, 16))
    overlay.child(text('名称', C.dim, 12))
    overlay.child(textarea(d.draft.name, 'otp-field:name', 40))
    overlay.child(text('颁发者', C.dim, 12))
    overlay.child(textarea(d.draft.issuer, 'otp-field:issuer', 40))
    overlay.child(text('密钥（Base32）', C.dim, 12))
    overlay.child(textarea(d.draft.secret, 'otp-field:secret', 56))
    const row = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
    row.child(button('取消', 'otp-dialog-close', '#33383D').flexGrow(1))
    row.child(button('确定', 'otp-edit-done', C.accent).flexGrow(1))
    overlay.child(row)
  } else if (d.kind === 'confirm-save') {
    overlay.child(text('确认保存修改？', C.text, 16))
    overlay.child(text(
      '将向手环下发 ' + d.upsertCount + ' 条修改、删除 ' + d.removeCount + ' 条账户',
      C.dim,
      13
    ))
    const row = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
    row.child(button('取消', 'otp-dialog-close', '#33383D').flexGrow(1))
    row.child(button('确认保存', 'otp-confirm-save', C.accent).flexGrow(1))
    overlay.child(row)
  } else if (d.kind === 'del') {
    overlay.child(text('删除账户？', C.text, 16))
    overlay.child(text(d.title, C.dim, 14))
    const row = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
    row.child(button('取消', 'otp-dialog-close', '#33383D').flexGrow(1))
    row.child(button('删除', 'otp-del-yes', C.danger).flexGrow(1))
    overlay.child(row)
  } else if (d.kind === 'paste') {
    overlay.child(text('批量粘贴 otpauth:// 文本', C.text, 16))
    overlay.child(text('每行一条，支持 \\/ 与 &amp; 转义', C.dim, 12))
    overlay.child(textarea(d.draft.pasteText, 'otp-field:pasteText', 120))
    const row = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
    row.child(button('取消', 'otp-dialog-close', '#33383D').flexGrow(1))
    row.child(button('解析并导入', 'otp-paste-apply', C.accent).flexGrow(1))
    overlay.child(row)
  } else if (d.kind === 'export') {
    overlay.child(text('批量导出（otpauth 多行文本）', C.text, 16))
    overlay.child(text('长按或复制以下内容到密码管理器备份', C.dim, 12))
    const box = el('SCROLL-AREA').height(160).widthFull().bg('#15181B').radius(10)
    box.child(text(d.exportText || '（无账户）', C.dim, 12))
    overlay.child(box)
    overlay.child(button('关闭', 'otp-export-close', '#33383D').widthFull())
  } else if (d.kind === 'offset') {
    overlay.child(text('检测到手表时间偏差', C.text, 16))
    overlay.child(text(
      '手表时间比手机' + (d.suggested > 0 ? '快' : '慢') + ' ' + Math.abs(d.suggested) + ' 秒，' +
        '建议把手表偏移设为 ' + (d.suggested > 0 ? '-' : '+') + Math.abs(d.suggested) + ' 秒',
      C.dim,
      13
    ))
    const row = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
    row.child(button('忽略', 'otp-offset-dismiss', '#33383D').flexGrow(1))
    row.child(button('应用校时', 'otp-offset-apply', C.warn).flexGrow(1))
    overlay.child(row)
  }

  root.child(overlay)
}

/**
 * 根据状态构造整棵元素树并渲染。
 *
 * @param {string} elementId 宿主分配的组件 id
 * @param {object} state 插件状态
 */
export function renderUI(elementId, state) {
  const root = el('DIV').flexDirection('COLUMN').padding(16).gap(12).widthFull()

  root.child(tabBar(state.tab))

  if (state.tab === 'otp') {
    renderOtpTab(root, state)
  } else {
    renderLyricsTab(root, state)
  }

  renderDialog(root, state)

  render(elementId, root)
}

export default { renderUI }
