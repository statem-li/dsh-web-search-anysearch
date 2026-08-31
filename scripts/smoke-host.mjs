/**
 * dsh-web-search-anysearch — host half smoke test.
 *
 * Imports the real `lib/index.js` with **bare node** (the installed-location
 * resolution check: an `@deepseek-ai/*` runtime import would throw
 * ERR_MODULE_NOT_FOUND right here) and asserts the Cordis plugin contract,
 * then runs `apply()` against a stub host context and drives the provider:
 *
 *   1. name / inject / apply contract
 *   2. a provider registers under id `anysearch` and is available
 *   3. the `web-search-anysearch` settings namespace registers with a schema
 *      that applies defaults (apiKeyEnv = ANYSEARCH_API_KEY) and validates
 *   4. one search POSTs `POST /v1/search` with the credentials-domain key as
 *      Bearer auth, maxResults / tag / zone / language projection, and maps
 *      the envelope into normalized sources
 *   5. business-error envelope (code≠0 on HTTP 200) throws WebError
 *      WEB_PROVIDER_ERROR; HTTP 500 throws WebError WEB_PROVIDER_ERROR
 *   6. a literal `apiKey` in the composition config wins over resolution
 *
 * Usage: node scripts/smoke-host.mjs
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

// ── 1. import the plugin ─────────────────────────────────────────────────
let mod
try {
  mod = await import(pathToFileURL(resolve(ROOT, 'lib/index.js')).href)
  pass('lib/index.js imported with bare node (no @deepseek-ai/* runtime imports)')
} catch (error) {
  fail(`cannot import lib/index.js: ${error?.stack ?? error}`)
  process.exit(process.exitCode ?? 1)
}

// ── 2. Cordis plugin contract ────────────────────────────────────────────
if (mod.name !== 'dsh-web-search-anysearch') fail(`expected name "dsh-web-search-anysearch", got ${JSON.stringify(mod.name)}`)
else pass(`name = ${JSON.stringify(mod.name)}`)

if (!Array.isArray(mod.inject)) fail('inject is not an array')
else pass(`inject = [${mod.inject.join(', ')}]`)

if (!mod.inject.includes('web')) fail('inject must declare the "web" seam service')
pass('inject covers the web seam service')

if (typeof mod.apply !== 'function') fail('apply is not a function')
else pass('apply is a function')

// ── 3. stub host context ─────────────────────────────────────────────────
function makeCtx({ credentials, userSection = {} } = {}) {
  const providers = []
  const namespaces = new Map()
  let currentResolver = null

  /** fake settings namespace bound to a mutable user section */
  class FakeScope {
    constructor(schema, base, ns) {
      this.schema = schema
      this.base = base
      this.ns = ns
      this.watchers = new Set()
      this.recompute(userSection)
    }

    recompute(input) {
      const merged = { ...(this.base ?? {}), ...(input ?? {}) }
      this.resolved = this.schema(merged)
      return this.resolved
    }

    get() { return this.resolved }
    watch(cb) { this.watchers.add(cb); return () => this.watchers.delete(cb) }
    async update(patch) { this.resolved = this.recompute({ ...userSection, ...patch }) }
    async replace(section) { this.resolved = this.recompute({ ...section }) }
  }

  const sctx = {
    settings: {
      register(ns, schema, options) {
        if (namespaces.has(ns)) throw new Error(`duplicate settings namespace ${ns}`)
        const scope = new FakeScope(schema, options?.base, ns)
        namespaces.set(ns, { scope, schema })
        return scope
      },
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }

  const ctx = {
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    fiber: { state: 0 },
    web: {
      registerSearchProvider(provider) {
        if (providers.some(p => p.id === provider.id)) {
          throw new Error(`duplicate web provider ${provider.id}`)
        }
        providers.push(provider)
        return () => providers.splice(providers.indexOf(provider), 1)
      },
    },
    get: (name) => {
      if (name === 'credentials') return credentials
      if (name === 'launchEnvironment') return undefined
      return undefined
    },
    inject: (names, callback) => {
      if (!Array.isArray(names)) throw new Error('ctx.inject must receive a service name array')
      callback(sctx)
      return () => {}
    },
    getProviders: () => providers,
    getNamespaces: () => namespaces,
    scopeBase: sctx,
  }
  return ctx
}

// ── 4. apply() registers provider + settings namespace ───────────────────
{
  const ctx = makeCtx({ credentials: { resolve: async (ref) => ref === 'ANYSEARCH_API_KEY' ? { value: 'cred-key-1' } : undefined } })
  try {
    await Promise.resolve(mod.apply(ctx, {}))
    pass('apply(ctx) completed without throwing')
  } catch (error) {
    fail(`apply(ctx) threw: ${error?.stack ?? error}`)
  }

  const providers = ctx.getProviders()
  if (providers.length !== 1) fail(`expected 1 provider, got ${providers.length}`)
  else if (providers[0]?.id !== 'anysearch') fail(`expected provider id "anysearch", got ${JSON.stringify(providers[0]?.id)}`)
  else pass('provider registered with id "anysearch"')

  if (providers[0]?.available?.() !== true) fail('provider must be available with default options')
  else pass('provider available() = true with default options')

  const namespaces = ctx.getNamespaces()
  if (!namespaces.has('web-search-anysearch')) fail('settings namespace "web-search-anysearch" not registered')
  else pass('settings namespace "web-search-anysearch" registered')

  const { scope, schema } = namespaces.get('web-search-anysearch') ?? {}
  if (schema === undefined) fail('no schema attached to the namespace')
  else {
    try {
      const resolved = schema({})
      if (resolved?.apiKeyEnv !== 'ANYSEARCH_API_KEY') fail(`schema default apiKeyEnv expected "ANYSEARCH_API_KEY", got ${JSON.stringify(resolved?.apiKeyEnv)}`)
      else pass('schema applies apiKeyEnv default')
      let threw = false
      try { schema({ maxResults: 'NaN' }) } catch { threw = true }
      if (!threw) fail('schema must reject a non-integer maxResults')
      else pass('schema rejects non-integer maxResults')
    } catch (error) {
      fail(`schema evaluation threw: ${error?.stack ?? error}`)
    }
  }

  // scope resolution: user section {} + base {} → defaults only
  const resolved = scope?.get?.()
  if (resolved == null || Object.keys(resolved).length !== 1 || resolved.apiKeyEnv !== 'ANYSEARCH_API_KEY') {
    fail(`scope.get() expected { apiKeyEnv: 'ANYSEARCH_API_KEY' }, got ${JSON.stringify(resolved)}`)
  } else {
    pass('scope resolves { apiKeyEnv: ANYSEARCH_API_KEY }')
  }

  // ── 5. one search over the stub fetch ──────────────────────────────────
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        request_id: 'req-1',
        data: {
          results: [
            { title: 'A', url: 'https://a.test', snippet: 'snippet A', published_at: '2026-01-02T03:04:05Z' },
            { title: 'B', url: '' }, // dropped: no URL
            { url: 'https://b.test' }, // no title/snippet
          ],
          metadata: { total_results: 2, search_time_ms: 42 },
        },
      }),
    }
  }
  try {
    const provider = providers[0]
    const result = await provider.search({ query: 'deepseek harness', maxResults: 5 })
    if (requests.length !== 1) fail(`expected 1 fetch, got ${requests.length}`)
    else {
      const req = requests[0]
      if (req.url !== 'https://api.anysearch.com/v1/search') fail(`request URL expected /v1/search, got ${req.url}`)
      else pass(`POST ${req.url}`)
      if (req.init?.method !== 'POST') fail('request method must be POST')
      else pass('request method is POST')
      const headers = req.init?.headers ?? {}
      if (headers['authorization'] !== 'Bearer cred-key-1') fail(`authorization expected "Bearer cred-key-1", got ${JSON.stringify(headers['authorization'])}`)
      else pass('authorization carries the credentials-domain key')
      const body = JSON.parse(req.init?.body ?? '{}')
      if (body.query !== 'deepseek harness') fail(`body.query expected the query, got ${JSON.stringify(body.query)}`)
      else if (body.max_results !== 5) fail(`body.max_results expected 5, got ${JSON.stringify(body.max_results)}`)
      else pass('body carries query + max_results')
      if (body.tag !== undefined || body.zone !== undefined || body.language !== undefined) fail('default options must project no tag/zone/language')
      else pass('no tag/zone/language projected by default')
    }
    if (!Array.isArray(result.sources) || result.sources.length !== 2) fail(`expected 2 sources, got ${JSON.stringify(result.sources)}`)
    else {
      const first = result.sources[0]
      if (first?.url !== 'https://a.test' || first?.title !== 'A' || first?.snippet !== 'snippet A' || first?.publishedAt !== '2026-01-02T03:04:05Z') {
        fail(`source mapping wrong: ${JSON.stringify(first)}`)
      } else pass('envelope maps to normalized sources (url/title/snippet/publishedAt)')
      if (result.sources[1]?.url !== 'https://b.test') fail('URL-less entry dropped; URL-only entry kept')
      else pass('URL-less entry dropped, URL-only entry kept')
    }
    if (result.truncated !== false) fail('provider must report truncated:false (seam owns truncation)')
    else pass('truncated:false')
  } catch (error) {
    fail(`provider.search threw: ${error?.stack ?? error}`)
  } finally {
    globalThis.fetch = originalFetch
  }

  // ── 6. business error envelope → WebError WEB_PROVIDER_ERROR ───────────
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 401, message: 'auth required' }) })
  try {
    await providers[0].search({ query: 'q' })
    fail('business-error envelope must throw')
  } catch (error) {
    if (error?.code !== 'WEB_PROVIDER_ERROR') fail(`expected code WEB_PROVIDER_ERROR, got ${JSON.stringify(error?.code)}`)
    else pass('business-error envelope throws WebError WEB_PROVIDER_ERROR')
    if (error?.name !== 'WebError') fail(`expected name WebError, got ${JSON.stringify(error?.name)}`)
    else pass('error name is WebError')
    if (!String(error?.message ?? '').includes('auth required')) fail(`message must carry the API text, got ${error?.message}`)
    else pass('error message carries the API detail')
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ── 7. HTTP 500 → WebError WEB_PROVIDER_ERROR ────────────────────────────
{
  const ctx = makeCtx()
  mod.apply(ctx, {})
  const provider = ctx.getProviders()[0]
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) })
  try {
    await provider.search({ query: 'q' })
    fail('HTTP 500 must throw')
  } catch (error) {
    if (error?.code !== 'WEB_PROVIDER_ERROR') fail(`expected code WEB_PROVIDER_ERROR, got ${JSON.stringify(error?.code)}`)
    else pass('HTTP 500 throws WebError WEB_PROVIDER_ERROR')
  } finally {
    globalThis.fetch = undefined
  }
}

// ── 8. literal apiKey wins over resolution; full option projection ───────
{
  const ctx = makeCtx({ credentials: { resolve: async () => ({ value: 'ambient-key' }) } })
  mod.apply(ctx, { apiKey: 'literal-key', maxResults: 7, tag: 'code.doc', zone: 'cn', language: 'zh-CN' })
  const provider = ctx.getProviders()[0]
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ code: 0, results: [{ url: 'https://c.test' }] }) }
  }
  try {
    await provider.search({ query: 'q' })
    const headers = requests[0]?.init?.headers ?? {}
    if (headers['authorization'] !== 'Bearer literal-key') fail(`literal apiKey must win, got ${JSON.stringify(headers['authorization'])}`)
    else pass('literal apiKey wins over credential resolution')
    const body = JSON.parse(requests[0]?.init?.body ?? '{}')
    if (body.max_results !== 7 || body.tag !== 'code.doc' || body.zone !== 'cn' || body.language !== 'zh-CN') {
      fail(`option projection wrong: ${JSON.stringify(body)}`)
    } else pass('maxResults/tag/zone/language projected into the request body')
  } catch (error) {
    fail(`literal-key search threw: ${error?.stack ?? error}`)
  } finally {
    globalThis.fetch = undefined
  }
}

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${resolve(ROOT, 'lib/index.js')}`)
process.exit(process.exitCode ?? 0)
