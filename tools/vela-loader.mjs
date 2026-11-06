/**
 * Node ESM loader：把手表端的 @system.* 导入替换为测试桩，
 * 并补齐快应用允许的「无扩展名相对导入」（Node ESM 要求显式扩展名）。
 * 仅 tools/test-otp-bridge.mjs 使用。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

const STUBS = {
  '@system.file': path.join(here, 'stubs/system-file.mjs'),
  '@system.interconnect': path.join(here, 'stubs/system-interconnect.mjs')
}

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) {
    return { url: pathToFileURL(STUBS[specifier]).href, shortCircuit: true }
  }
  if (
    specifier.startsWith('.') &&
    !/\.(js|mjs|json|css|png|ux)$/i.test(specifier) &&
    context.parentURL
  ) {
    const dir = path.dirname(fileURLToPath(context.parentURL))
    const cand = path.resolve(dir, specifier + '.js')
    if (existsSync(cand)) {
      return { url: pathToFileURL(cand).href, shortCircuit: true }
    }
  }
  return next(specifier, context)
}
