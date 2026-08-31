/**
 * dsh-web-search-anysearch — host 半身入口（Cordis 插件契约）。
 *
 * 移植自 statem-li/dsh-webui 的 webSearch 模块（原独立插件 dsh-web-search-anysearch
 * 被合并进 webui 后，随 webui 卸载一并消失；本插件把该能力拆回单体）：
 *
 *  1. 向 `ctx.web` 注册 id=`anysearch` 的网页搜索 provider（替换内置 DeepSeek
 *     搜索；profile 里已有的 `web.searchProvider: anysearch` 配置原样生效）。
 *  2. 注册设置命名空间 `web-search-anysearch`（与旧 webui 同名，旧设置文档无缝
 *     延续；API Key 走凭据域 ANYSEARCH_API_KEY，不落进设置文档），客户端在
 *     「设置 → 插件 → 外接网页搜索」卡片编辑。
 *
 * 运行时不允许 import 任何 `@deepseek-ai/*`：装进 profile node_modules 的插件
 * 拿不到宿主源码包，需要的叶子能力（WebError / credentialRef /
 * launchEnvironmentOf / installSettingsSection 等价物）全部内联在 src/vendor/。
 * 模块独立 try/catch：设置命名空间挂载失败只诊断，不影响 provider 注册。
 */
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls in dsh-web 的 Context 增强（ctx.web 服务名）与
// WebSearchProvider 契约；esbuild 完全擦除，不参与运行时解析。
import type {} from '@deepseek-ai/dsh-web'
import {
  AnySearchSearchProvider,
  ANYSEARCH_DEFAULT_BASE_URL,
  ANYSEARCH_PROVIDER_ID,
} from './anysearch-provider.ts'
import type { AnySearchSearchProviderOptions } from './anysearch-provider.ts'
import { credentialRef } from './vendor/credential-ref.ts'
import { launchEnvironmentOf } from './vendor/launch-environment.ts'
import { installSettingsSection, sectionSchema, settingsNamespace } from './vendor/settings-section.ts'

export const name = 'dsh-web-search-anysearch'

/** The web seam this provider registers into; settings/credentials are optional accesses. */
export const inject = ['web']

/** 诊断日志：宿主日志不可达时，把模块挂载失败落盘到这里（排查用）。 */
const DIAG_LOG = join(tmpdir(), 'dsh-web-search-anysearch-apply.log')

function diag(label: string, error: unknown): void {
  try {
    appendFileSync(DIAG_LOG, `[${new Date().toISOString()}] ${label}: ${String((error as Error)?.stack ?? error)}\n`)
  } catch { /* 诊断失败不干扰主流程 */ }
}

// ── AnySearch 网页搜索 ───────────────────────────────────────────────────────

/** AnySearch API key 默认环境变量。 */
const DEFAULT_API_KEY_ENV = 'ANYSEARCH_API_KEY'

/** 插件配置（全部可选，apply 填环境变量与常量默认值）。 */
export interface AnySearchConfig {
  /** 字面 API key；优先用 apiKeyEnv，避免密钥进配置文件。 */
  apiKey?: string
  /** 每次搜索解析的凭据引用；默认 ANYSEARCH_API_KEY。 */
  apiKeyEnv?: string
  /** API 端点基址；自动拼接 /v1/search。默认公共 API。 */
  baseURL?: string
  /** 请求未带 maxResults 时的默认结果数。 */
  maxResults?: number
  /** 可选子域能力标签，如 code.doc。 */
  tag?: string
  /** 可选区域：cn 或 intl。 */
  zone?: string
  /** 可选首选语言，如 zh-CN 或 en。 */
  language?: string
}

const ANYSEARCH_SETTINGS_NAMESPACE = settingsNamespace('web-search-anysearch')

/** 设置命名空间承载 provider 的 key 引用与选项（schema 与旧 webui 同构）。 */
const AnySearchSchema = sectionSchema<Record<string, unknown>>({
  apiKey: { type: 'string', role: 'secret' },
  apiKeyEnv: { type: 'string', role: 'credential-ref', default: DEFAULT_API_KEY_ENV },
  baseURL: { type: 'string' },
  maxResults: { type: 'number', min: 1 },
  tag: { type: 'string' },
  zone: { type: 'string' },
  language: { type: 'string' },
})

/**
 * 把已解析的 section 投影为 provider 下一次搜索的选项；环境变量回退放在这
 * 里而非 provider 内，provider 读到的每个值都已完全默认化。
 */
function resolveAnySearchOptions(ctx: Context, config: AnySearchConfig): AnySearchSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials') as
        | { resolve: (ref: string) => Promise<{ value: string } | undefined> }
        | undefined
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // 没有凭据服务时，进程环境就是整个凭据平面。
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? ANYSEARCH_DEFAULT_BASE_URL,
    ...(config.maxResults !== undefined ? { maxResults: config.maxResults } : {}),
    ...(config.tag !== undefined && config.tag.length > 0 ? { tag: config.tag } : {}),
    ...(config.zone !== undefined && config.zone.length > 0 ? { zone: config.zone } : {}),
    ...(config.language !== undefined && config.language.length > 0 ? { language: config.language } : {}),
  }
}

/**
 * 注册 AnySearch 搜索 provider + 设置命名空间（可选的 settings 服务）。
 * @param ctx - host 上下文（inject 声明了 web）。
 * @param config - 组合配置（默认空对象，各字段自带默认值）。
 */
export function apply(ctx: Context, config: AnySearchConfig = {}): void {
  // 1) 核心：AnySearch 搜索 provider。失败必须诊断（provider 缺失等于功能没了）。
  try {
    let current: () => AnySearchConfig = () => config
    ctx.web.registerSearchProvider(
      new AnySearchSearchProvider(() => resolveAnySearchOptions(ctx, current())),
    )
    // 设置命名空间放 provider 注册之后再挂：挂载失败只影响「设置页卡片」，
    // 不影响搜索功能（此时 current 保持组合配置回退）。
    try {
      installSettingsSection(ctx, ANYSEARCH_SETTINGS_NAMESPACE, AnySearchSchema, config, {
        setSource: (source) => {
          current = source
        },
        // 注册不持有解析值：provider 每次搜索重新投影 section，提交无需重注册。
        onChange: () => {},
      })
    } catch (error) {
      diag('settings-section', error)
      ctx.logger?.warn?.(`[dsh-web-search-anysearch] 设置命名空间挂载失败：${String(error)}`)
    }
  } catch (error) {
    diag('provider', error)
    ctx.logger?.warn?.(`[dsh-web-search-anysearch] AnySearch provider 注册失败：${String(error)}`)
  }
}

// ── 供冒烟与外部复用 ─────────────────────────────────────────────────────────

export {
  ANYSEARCH_DEFAULT_BASE_URL,
  ANYSEARCH_PROVIDER_ID,
  ANYSEARCH_SETTINGS_NAMESPACE,
  AnySearchSchema,
  AnySearchSearchProvider,
}
export type { AnySearchConfig, AnySearchSearchProviderOptions }
export { mapAnySearchResponse } from './anysearch-provider.ts'
