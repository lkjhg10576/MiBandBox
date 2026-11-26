/**
 * 手机端互传通道单例入口：桥接原生能力与全局互联核心。
 */
import interconnect from '@system.interconnect'
import { createInterconnect } from './interconnectCore'

const root =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

export default createInterconnect(interconnect, root)
