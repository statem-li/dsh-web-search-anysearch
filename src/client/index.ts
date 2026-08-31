/**
 * dsh-web-search-anysearch — 入口（client 半身）。
 *
 * 移植自 dsh-webui 的 AnySearchCard（原 dsh-web-search-anysearch 设置卡）。
 * 通过 `settings.plugin.item` 键槽（key = web-search-anysearch）在
 * 「设置 → 插件 → 可配置」页注册「外接网页搜索」卡片：API Key 走凭据域
 * （ANYSEARCH_API_KEY），Base URL / 默认结果数 写设置命名空间
 * web-search-anysearch（与旧 webui 同名，旧设置文档无缝延续）。
 *
 * 模块整体 try/catch：挂载失败只诊断，不拖垮其他 client 插件。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { registerAnySearchCard } from './AnySearchCard'

/** 顶层服务依赖（client boot graph 用）。 */
export const inject = ['slots', 'settingsScope', 'remote', 'remote.credentials']

/**
 * 挂载 AnySearch 设置卡。
 * @param ctx - client root context。
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.inject(['slots', 'settingsScope', 'remote', 'remote.credentials'], () => {
      registerAnySearchCard(ctx)
    })
  } catch (error) {
    console.warn(`[dsh-web-search-anysearch] 设置卡挂载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
