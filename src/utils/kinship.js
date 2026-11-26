/**
 * 亲戚称呼计算器纯 JS 归约引擎：
 *   - 基于 10 个原子关系代币（f, m, h, w, ob, lb, os, ls, s, d）+ 自身性别（'M' | 'F'）
 *   - 最多 6 层关系链
 *   - 同步产出正查（「我叫 TA」）与反查（「TA 叫我」）结果
 *   - 拦截性别关系冲突（如男选「夫」/ 女选「妻」/ 连续同性婚姻链）
 *
 * 零 @system.* 依赖，不使用 .find( / .includes(，可在 QuickJS 与 Node 中直接运行。
 */

export const MAX_DEPTH = 6

export const TOKEN_META = {
  f:  { key: 'f',  short: '父', label: '爸爸', sex: 'M' },
  m:  { key: 'm',  short: '母', label: '妈妈', sex: 'F' },
  h:  { key: 'h',  short: '夫', label: '老公', sex: 'M' },
  w:  { key: 'w',  short: '妻', label: '妻子', sex: 'F' },
  ob: { key: 'ob', short: '兄', label: '哥哥', sex: 'M' },
  lb: { key: 'lb', short: '弟', label: '弟弟', sex: 'M' },
  os: { key: 'os', short: '姐', label: '姐姐', sex: 'F' },
  ls: { key: 'ls', short: '妹', label: '妹妹', sex: 'F' },
  s:  { key: 's',  short: '子', label: '儿子', sex: 'M' },
  d:  { key: 'd',  short: '女', label: '女儿', sex: 'F' }
}

/** 3×4 按键矩阵（共 12 键） */
export const KEYPAD_ROWS = [
  [
    { id: 'f', text: '父', kind: 'rel' },
    { id: 'm', text: '母', kind: 'rel' },
    { id: 'h', text: '夫', kind: 'rel' },
    { id: 'w', text: '妻', kind: 'rel' }
  ],
  [
    { id: 'ob', text: '兄', kind: 'rel' },
    { id: 'lb', text: '弟', kind: 'rel' },
    { id: 'os', text: '姐', kind: 'rel' },
    { id: 'ls', text: '妹', kind: 'rel' }
  ],
  [
    { id: 's', text: '子', kind: 'rel' },
    { id: 'd', text: '女', kind: 'rel' },
    { id: 'back', text: '退格', kind: 'fn' },
    { id: 'clear', text: '清空', kind: 'fn' }
  ]
]

function normSex(sex) {
  return sex === 'F' ? 'F' : 'M'
}

export function sexOfToken(tok) {
  if (tok === 'xb') return 'M'
  if (tok === 'xs') return 'F'
  const m = TOKEN_META[tok]
  return m ? m.sex : 'M'
}

function isSibling(tok) {
  return tok === 'ob' || tok === 'lb' || tok === 'os' || tok === 'ls' || tok === 'xb' || tok === 'xs'
}

function isMaleSibling(tok) {
  return tok === 'ob' || tok === 'lb' || tok === 'xb'
}

function isFemaleSibling(tok) {
  return tok === 'os' || tok === 'ls' || tok === 'xs'
}

/** 校验整条关系链的性别约束与长度上限。 */
export function validateChain(chain, selfSex) {
  const s = normSex(selfSex)
  if (!Array.isArray(chain)) return { ok: false, reason: 'bad-chain', message: '关系链非法' }
  if (chain.length > MAX_DEPTH) {
    return { ok: false, reason: 'max-depth', message: '最多支持 ' + MAX_DEPTH + ' 层关系' }
  }
  let curSex = s
  for (let i = 0; i < chain.length; i++) {
    const tok = chain[i]
    if (!TOKEN_META[tok]) {
      return { ok: false, reason: 'bad-token', message: '未知关系：' + tok }
    }
    if (tok === 'h' && curSex !== 'F') {
      return {
        ok: false,
        reason: 'sex-conflict',
        message: i === 0 ? '男性不能选「夫」' : '男性亲属不能再选「夫」'
      }
    }
    if (tok === 'w' && curSex !== 'M') {
      return {
        ok: false,
        reason: 'sex-conflict',
        message: i === 0 ? '女性不能选「妻」' : '女性亲属不能再选「妻」'
      }
    }
    curSex = TOKEN_META[tok].sex
  }
  return { ok: true, targetSex: chain.length ? curSex : s }
}

/** 判断能否在当前关系链末尾继续追加 token。 */
export function canPush(chain, token, selfSex) {
  const base = Array.isArray(chain) ? chain : []
  if (!TOKEN_META[token]) {
    return { ok: false, reason: 'bad-token', message: '未知关系' }
  }
  if (base.length >= MAX_DEPTH) {
    return { ok: false, reason: 'max-depth', message: '最多支持 ' + MAX_DEPTH + ' 层关系' }
  }
  const curCheck = validateChain(base, selfSex)
  if (!curCheck.ok) return curCheck
  const nextCheck = validateChain(base.concat([token]), selfSex)
  if (!nextCheck.ok) return nextCheck
  return { ok: true }
}

/** 计算当前链尾人物的性别（空链为 selfSex）。 */
export function currentTailSex(chain, selfSex) {
  const base = Array.isArray(chain) ? chain : []
  if (base.length === 0) return normSex(selfSex)
  return sexOfToken(base[base.length - 1])
}

/** 生成从目标人物视角看回「我」的反向关系链。 */
export function invertChain(chain, selfSex) {
  const s = normSex(selfSex)
  if (!Array.isArray(chain) || chain.length === 0) {
    return { chain: [], selfSex: s }
  }
  const sexes = [s]
  for (let i = 0; i < chain.length; i++) {
    sexes.push(sexOfToken(chain[i]))
  }
  const targetSex = sexes[chain.length]
  const rev = []
  for (let i = chain.length - 1; i >= 0; i--) {
    const prevSex = sexes[i]
    const tok = chain[i]
    if (tok === 'f' || tok === 'm') {
      rev.push(prevSex === 'M' ? 's' : 'd')
    } else if (tok === 'h') {
      rev.push('w')
    } else if (tok === 'w') {
      rev.push('h')
    } else if (tok === 's' || tok === 'd') {
      rev.push(prevSex === 'M' ? 'f' : 'm')
    } else if (tok === 'ob' || tok === 'os') {
      rev.push(prevSex === 'M' ? 'lb' : 'ls')
    } else if (tok === 'lb' || tok === 'ls') {
      rev.push(prevSex === 'M' ? 'ob' : 'os')
    }
  }
  return { chain: rev, selfSex: targetSex }
}

/** 合并同代兄弟姐妹连续步骤。 */
function collapseSiblings(a, b) {
  if (a === 'ob' && b === 'ob') return 'ob'
  if (a === 'lb' && b === 'lb') return 'lb'
  if (a === 'os' && b === 'os') return 'os'
  if (a === 'ls' && b === 'ls') return 'ls'
  if (a === 'ob' && b === 'os') return 'os'
  if (a === 'os' && b === 'ob') return 'ob'
  if (a === 'lb' && b === 'ls') return 'ls'
  if (a === 'ls' && b === 'lb') return 'lb'
  return isMaleSibling(b) ? 'xb' : 'xs'
}

/** 迭代路径归约引擎：化简自反/配偶/长幼/父母子女冗余路径。 */
export function reduceChain(chain, selfSex) {
  const s = normSex(selfSex)
  const arr = Array.isArray(chain) ? chain.slice() : []
  let guard = 0
  while (guard < 32) {
    guard++
    let changed = false
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i]
      const b = arr[i + 1]
      const prevSex = i === 0 ? s : sexOfToken(arr[i - 1])

      // 1. 夫妻自反消去
      if ((a === 'h' && b === 'w') || (a === 'w' && b === 'h')) {
        arr.splice(i, 2)
        changed = true
        break
      }
      // 2. 父母配偶直归
      if (a === 'f' && b === 'w') {
        arr.splice(i, 2, 'm')
        changed = true
        break
      }
      if (a === 'm' && b === 'h') {
        arr.splice(i, 2, 'f')
        changed = true
        break
      }
      // 3. 配偶的子女 → 子女
      if ((a === 'h' || a === 'w') && (b === 's' || b === 'd')) {
        arr.splice(i, 2, b)
        changed = true
        break
      }
      // 4. 兄弟姐妹的父母 → 父母
      if (isSibling(a) && (b === 'f' || b === 'm')) {
        arr.splice(i, 2, b)
        changed = true
        break
      }
      // 5. 子女的兄弟姐妹 → 子女
      if ((a === 's' || a === 'd') && isSibling(b)) {
        arr.splice(i, 2, isMaleSibling(b) ? 's' : 'd')
        changed = true
        break
      }
      // 6. 子女的父母 → 自己或配偶
      if ((a === 's' || a === 'd') && b === 'f') {
        if (prevSex === 'M') arr.splice(i, 2)
        else arr.splice(i, 2, 'h')
        changed = true
        break
      }
      if ((a === 's' || a === 'd') && b === 'm') {
        if (prevSex === 'F') arr.splice(i, 2)
        else arr.splice(i, 2, 'w')
        changed = true
        break
      }
      // 7. 同辈兄弟姐妹连续归并
      if (isSibling(a) && isSibling(b)) {
        arr.splice(i, 2, collapseSiblings(a, b))
        changed = true
        break
      }
      // 8. 父母的子女再接父母（如 爸爸的儿子的爸爸 → 爸爸）
      if (
        i + 2 < arr.length &&
        (a === 'f' || a === 'm') &&
        (b === 's' || b === 'd') &&
        (arr[i + 2] === 'f' || arr[i + 2] === 'm')
      ) {
        arr.splice(i, 3, arr[i + 2])
        changed = true
        break
      }
    }
    if (!changed) break
  }
  return arr
}

/** 常见直系、旁系与姻亲称呼字典（支持通配符 xb/xs）。 */
const EXACT = {
  '': '自己',
  'f': '爸爸',
  'm': '妈妈',
  'h': '老公',
  'w': '老婆',
  'ob': '哥哥',
  'lb': '弟弟',
  'os': '姐姐',
  'ls': '妹妹',
  's': '儿子',
  'd': '女儿',
  'xb': '兄弟',
  'xs': '姐妹',

  // 父母辈直系 / 祖辈
  'f,f': '爷爷',
  'f,m': '奶奶',
  'm,f': '外公',
  'm,m': '外婆',
  'f,f,f': '曾祖父',
  'f,f,m': '曾祖母',
  'f,m,f': '曾外祖父',
  'f,m,m': '曾外祖母',
  'm,f,f': '外曾祖父',
  'm,f,m': '外曾祖母',
  'm,m,f': '外曾外祖父',
  'm,m,m': '外曾外祖母',
  'f,f,f,f': '高祖父',
  'f,f,f,m': '高祖母',
  'm,f,f,f': '外高祖父',
  'm,f,f,m': '外高祖母',

  // 孙辈
  's,s': '孙子',
  's,d': '孙女',
  'd,s': '外孙',
  'd,d': '外孙女',
  's,s,s': '曾孙',
  's,s,d': '曾孙女',
  's,d,s': '曾外孙',
  's,d,d': '曾外孙女',
  'd,s,s': '曾外孙',
  'd,s,d': '曾外孙女',
  'd,d,s': '曾外孙',
  'd,d,d': '曾外孙女',
  's,s,s,s': '玄孙',
  's,s,s,d': '玄孙女',

  // 父母的兄弟姐妹及配偶
  'f,ob': '伯父',
  'f,lb': '叔叔',
  'f,xb': '伯父/叔叔',
  'f,os': '姑妈',
  'f,ls': '姑姑',
  'f,xs': '姑妈/姑姑',
  'f,ob,w': '伯母',
  'f,lb,w': '婶婶',
  'f,xb,w': '伯母/婶婶',
  'f,os,h': '姑父',
  'f,ls,h': '姑父',
  'f,xs,h': '姑父',

  'm,ob': '大舅',
  'm,lb': '小舅',
  'm,xb': '舅舅',
  'm,os': '姨妈',
  'm,ls': '小姨',
  'm,xs': '姨妈/阿姨',
  'm,ob,w': '舅妈',
  'm,lb,w': '舅妈',
  'm,xb,w': '舅妈',
  'm,os,h': '姨父',
  'm,ls,h': '姨父',
  'm,xs,h': '姨父',

  // 祖辈兄弟姐妹（伯公/叔公/姑奶奶/舅公/姨奶奶）
  'f,f,ob': '伯祖父',
  'f,f,lb': '叔祖父',
  'f,f,xb': '伯公/叔公',
  'f,f,os': '姑奶奶',
  'f,f,ls': '姑奶奶',
  'f,f,xs': '姑奶奶',
  'f,f,ob,w': '伯祖母',
  'f,f,lb,w': '叔祖母',
  'f,f,os,h': '姑爷爷',
  'f,f,ls,h': '姑爷爷',
  'f,m,ob': '舅公',
  'f,m,lb': '舅公',
  'f,m,xb': '舅公',
  'f,m,os': '姨奶奶',
  'f,m,ls': '姨奶奶',
  'f,m,xs': '姨奶奶',
  'f,m,ob,w': '舅奶奶',
  'f,m,lb,w': '舅奶奶',
  'f,m,os,h': '姨爷爷',
  'f,m,ls,h': '姨爷爷',
  'm,f,ob': '伯外公',
  'm,f,lb': '叔外公',
  'm,f,xb': '大姥爷/小姥爷',
  'm,f,os': '姑姥姥',
  'm,f,ls': '姑姥姥',
  'm,f,xs': '姑姥姥',
  'm,m,ob': '舅外公',
  'm,m,lb': '舅外公',
  'm,m,xb': '舅姥爷',
  'm,m,os': '姨姥姥',
  'm,m,ls': '姨姥姥',
  'm,m,xs': '姨姥姥',

  // 平辈配偶与兄弟姐妹配偶
  'ob,w': '嫂子',
  'lb,w': '弟妹',
  'xb,w': '嫂子/弟妹',
  'os,h': '姐夫',
  'ls,h': '妹夫',
  'xs,h': '姐夫/妹夫',

  // 侄/甥辈
  'ob,s': '侄子',
  'lb,s': '侄子',
  'xb,s': '侄子',
  'ob,d': '侄女',
  'lb,d': '侄女',
  'xb,d': '侄女',
  'os,s': '外甥',
  'ls,s': '外甥',
  'xs,s': '外甥',
  'os,d': '外甥女',
  'ls,d': '外甥女',
  'xs,d': '外甥女',

  // 侄/甥配偶及下一代
  'ob,s,w': '侄媳妇',
  'lb,s,w': '侄媳妇',
  'xb,s,w': '侄媳妇',
  'ob,d,h': '侄女婿',
  'lb,d,h': '侄女婿',
  'xb,d,h': '侄女婿',
  'os,s,w': '外甥媳妇',
  'ls,s,w': '外甥媳妇',
  'xs,s,w': '外甥媳妇',
  'os,d,h': '外甥女婿',
  'ls,d,h': '外甥女婿',
  'xs,d,h': '外甥女婿',

  'ob,s,s': '侄孙',
  'lb,s,s': '侄孙',
  'xb,s,s': '侄孙',
  'ob,s,d': '侄孙女',
  'lb,s,d': '侄孙女',
  'xb,s,d': '侄孙女',
  'ob,d,s': '外侄孙',
  'lb,d,s': '外侄孙',
  'ob,d,d': '外侄孙女',
  'lb,d,d': '外侄孙女',
  'os,s,s': '甥孙',
  'ls,s,s': '甥孙',
  'xs,s,s': '甥孙',
  'os,s,d': '甥孙女',
  'ls,s,d': '甥孙女',
  'xs,s,d': '甥孙女',
  'os,d,s': '外甥孙',
  'ls,d,s': '外甥孙',
  'os,d,d': '外甥孙女',
  'ls,d,d': '外甥孙女',

  // 堂亲
  'f,ob,s': '堂哥/堂弟',
  'f,lb,s': '堂哥/堂弟',
  'f,xb,s': '堂兄弟',
  'f,ob,d': '堂姐/堂妹',
  'f,lb,d': '堂姐/堂妹',
  'f,xb,d': '堂姐妹',
  'f,ob,s,w': '堂嫂/堂弟妹',
  'f,lb,s,w': '堂嫂/堂弟妹',
  'f,ob,d,h': '堂姐夫/堂妹夫',
  'f,lb,d,h': '堂姐夫/堂妹夫',
  'f,ob,s,s': '堂侄',
  'f,lb,s,s': '堂侄',
  'f,ob,s,d': '堂侄女',
  'f,lb,s,d': '堂侄女',

  // 表亲（姑表 / 舅表 / 姨表）
  'f,os,s': '姑表兄弟',
  'f,ls,s': '姑表兄弟',
  'f,xs,s': '姑表兄弟',
  'f,os,d': '姑表姐妹',
  'f,ls,d': '姑表姐妹',
  'f,xs,d': '姑表姐妹',
  'm,ob,s': '表哥/表弟',
  'm,lb,s': '表哥/表弟',
  'm,xb,s': '表兄弟',
  'm,ob,d': '表姐/表妹',
  'm,lb,d': '表姐/表妹',
  'm,xb,d': '表姐妹',
  'm,os,s': '表哥/表弟',
  'm,ls,s': '表哥/表弟',
  'm,xs,s': '表兄弟',
  'm,os,d': '表姐/表妹',
  'm,ls,d': '表姐/表妹',
  'm,xs,d': '表姐妹',
  'm,ob,s,w': '表嫂/表弟妹',
  'm,lb,s,w': '表嫂/表弟妹',
  'm,os,s,w': '表嫂/表弟妹',
  'm,ls,s,w': '表嫂/表弟妹',
  'm,ob,d,h': '表姐夫/表妹夫',
  'm,lb,d,h': '表姐夫/表妹夫',
  'm,os,d,h': '表姐夫/表妹夫',
  'm,ls,d,h': '表姐夫/表妹夫',
  'f,os,s,s': '表侄',
  'f,ls,s,s': '表侄',
  'm,ob,s,s': '表侄',
  'm,lb,s,s': '表侄',
  'm,os,s,s': '表侄',
  'm,ls,s,s': '表侄',
  'f,os,s,d': '表侄女',
  'f,ls,s,d': '表侄女',
  'm,ob,s,d': '表侄女',
  'm,lb,s,d': '表侄女',
  'm,os,s,d': '表侄女',
  'm,ls,s,d': '表侄女',

  // 夫家亲属（女视角）
  'h,f': '公公',
  'h,m': '婆婆',
  'h,f,f': '太公公',
  'h,f,m': '太婆婆',
  'h,m,f': '外太公公',
  'h,m,m': '外太婆婆',
  'h,ob': '大伯子',
  'h,lb': '小叔子',
  'h,xb': '大伯子/小叔子',
  'h,os': '大姑子',
  'h,ls': '小姑子',
  'h,xs': '大姑子/小姑子',
  'h,ob,w': '妯娌（大嫂）',
  'h,lb,w': '妯娌（弟妹）',
  'h,xb,w': '妯娌',
  'h,os,h': '大姑姐夫',
  'h,ls,h': '小姑妹夫',
  'h,xs,h': '姑姐夫/妹夫',
  'h,ob,s': '侄子',
  'h,lb,s': '侄子',
  'h,xb,s': '侄子',
  'h,ob,d': '侄女',
  'h,lb,d': '侄女',
  'h,xb,d': '侄女',
  'h,os,s': '外甥',
  'h,ls,s': '外甥',
  'h,xs,s': '外甥',
  'h,os,d': '外甥女',
  'h,ls,d': '外甥女',
  'h,xs,d': '外甥女',
  'h,f,ob': '伯公',
  'h,f,lb': '叔公',
  'h,f,os': '姑婆',
  'h,f,ls': '姑婆',
  'h,m,ob': '舅公',
  'h,m,lb': '舅公',
  'h,m,os': '姨婆',
  'h,m,ls': '姨婆',

  // 妻家亲属（男视角）
  'w,f': '岳父',
  'w,m': '岳母',
  'w,f,f': '太岳父',
  'w,f,m': '太岳母',
  'w,m,f': '外太岳父',
  'w,m,m': '外太岳母',
  'w,ob': '大舅哥',
  'w,lb': '小舅子',
  'w,xb': '大舅哥/小舅子',
  'w,os': '大姨子',
  'w,ls': '小姨子',
  'w,xs': '大姨子/小姨子',
  'w,ob,w': '舅嫂',
  'w,lb,w': '舅弟妹',
  'w,xb,w': '舅嫂/弟妹',
  'w,os,h': '连襟（大姨夫）',
  'w,ls,h': '连襟（小姨夫）',
  'w,xs,h': '连襟',
  'w,ob,s': '内侄',
  'w,lb,s': '内侄',
  'w,xb,s': '内侄',
  'w,ob,d': '内侄女',
  'w,lb,d': '内侄女',
  'w,xb,d': '内侄女',
  'w,os,s': '姨甥',
  'w,ls,s': '姨甥',
  'w,xs,s': '姨甥',
  'w,os,d': '姨甥女',
  'w,ls,d': '姨甥女',
  'w,xs,d': '姨甥女',
  'w,f,ob': '太伯父',
  'w,f,lb': '太叔父',
  'w,f,os': '太姑妈',
  'w,f,ls': '太姑姑',
  'w,m,ob': '太舅父',
  'w,m,lb': '太舅父',
  'w,m,os': '太姨妈',
  'w,m,ls': '太姨妈',

  // 儿女婚姻与亲家
  's,w': '儿媳',
  'd,h': '女婿',
  's,s,w': '孙媳妇',
  's,d,h': '孙女婿',
  'd,s,w': '外孙媳妇',
  'd,d,h': '外孙女婿',
  's,w,f': '亲家公',
  's,w,m': '亲家母',
  'd,h,f': '亲家公',
  'd,h,m': '亲家母',
  'ob,w,f': '姻伯',
  'lb,w,f': '姻伯',
  'os,h,f': '姻伯',
  'ls,h,f': '姻伯',
  'ob,w,m': '姻母',
  'lb,w,m': '姻母',
  'os,h,m': '姻母',
  'ls,h,m': '姻母'
}

/** 结合自身性别处理 (f|m)+(s|d) 等歧义组合及远亲兜底拼接。 */
function lookupReduced(reduced, selfSex) {
  const s = normSex(selfSex)
  const key = reduced.join(',')
  if (key === 'f,s' || key === 'm,s') {
    return s === 'M' ? '兄弟 / 自己' : '哥哥 / 弟弟'
  }
  if (key === 'f,d' || key === 'm,d') {
    return s === 'F' ? '姐妹 / 自己' : '姐姐 / 妹妹'
  }
  if (EXACT[key]) return EXACT[key]

  // 分段组合兜底：寻找最长已知前缀 + 已知后缀（如「太爷爷的哥哥」「妻子的堂哥」）
  for (let split = reduced.length - 1; split >= 1; split--) {
    const head = reduced.slice(0, split)
    const tail = reduced.slice(split)
    const headTitle = EXACT[head.join(',')]
    const tailTitle = EXACT[tail.join(',')]
    if (headTitle && tailTitle) {
      return headTitle + '的' + tailTitle
    }
  }
  // 单步串连兜底
  const parts = []
  for (let i = 0; i < reduced.length; i++) {
    const t = reduced[i]
    parts.push(EXACT[t] || (TOKEN_META[t] && TOKEN_META[t].label) || t)
  }
  return parts.length ? parts.join('的') : '自己'
}

export function formatBreadcrumb(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return '我'
  const out = ['我']
  for (let i = 0; i < chain.length; i++) {
    const m = TOKEN_META[chain[i]]
    out.push(m ? m.label : chain[i])
  }
  return out.join(' → ')
}

/**
 * 计算完整称呼结果：
 *   - 校验链与性别冲突
 *   - 归约正查（我叫 TA）
 *   - 反转并归约反查（TA 叫我）
 */
export function evaluate(chain, selfSex) {
  const s = normSex(selfSex)
  const base = Array.isArray(chain) ? chain.slice() : []
  const check = validateChain(base, s)
  if (!check.ok) {
    return {
      ok: false,
      reason: check.reason,
      message: check.message,
      chain: base,
      selfSex: s,
      breadcrumb: formatBreadcrumb(base)
    }
  }
  if (base.length === 0) {
    return {
      ok: true,
      chain: [],
      reduced: [],
      reverseReduced: [],
      selfSex: s,
      targetSex: s,
      breadcrumb: '我',
      callTitle: '自己',
      reverseTitle: '自己'
    }
  }

  const fwdReduced = reduceChain(base, s)
  const callTitle = lookupReduced(fwdReduced, s)

  const inv = invertChain(base, s)
  const revReduced = reduceChain(inv.chain, inv.selfSex)
  const reverseTitle = lookupReduced(revReduced, inv.selfSex)

  return {
    ok: true,
    chain: base,
    reduced: fwdReduced,
    reverseReduced: revReduced,
    selfSex: s,
    targetSex: check.targetSex,
    breadcrumb: formatBreadcrumb(base),
    callTitle: callTitle,
    reverseTitle: reverseTitle
  }
}

export default {
  MAX_DEPTH,
  TOKEN_META,
  KEYPAD_ROWS,
  sexOfToken,
  validateChain,
  canPush,
  currentTailSex,
  invertChain,
  reduceChain,
  formatBreadcrumb,
  evaluate
}
