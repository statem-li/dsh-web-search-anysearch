/**
 * dsh-web-search-anysearch — build script.
 *
 * Two bundles from one esbuild run:
 *
 *   lib/index.js   host half    ESM,  node platform,  self-contained
 *   lib/client.js  browser half CJS,  browser platform, wrapped in the
 *                  `window.__ModuleLoader__.load` factory contract
 *
 * The host half must stay **resolvable from an installed location**, i.e. from
 * inside `~/.dsh/profiles/<p>/node_modules/`. That rules out importing any
 * `@deepseek-ai/*` package at runtime: DSH ships those as source only and
 * resolves them through tsx + tsconfig `paths`, which apply only to importers
 * outside node_modules. The needed leaves (WebError / credentialRef /
 * launchEnvironmentOf / installSettingsSection-equivalent) live in
 * `src/vendor/` and are inlined by this bundle; `assertHostExternals()` below
 * fails the build if a runtime import still slips through.
 *
 * Usage: node build.mjs
 */

import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_CHECKOUT = process.env.DSH_CHECKOUT ?? 'D:/AI/deepseek-harness'
const PLUGIN_ID = 'dsh-web-search-anysearch'

/**
 * Resolve esbuild, three tiers:
 *  1. the plugin's own `node_modules` (normal install path; esbuild is a
 *     devDependency so `pnpm install` provides it),
 *  2. a local DSH checkout's pnpm store (scan `node_modules/.pnpm/esbuild@*`,
 *     take the highest version),
 *  3. a clear, actionable error.
 */
function loadEsbuild() {
  const localRequire = createRequire(resolve(HERE, 'package.json'))
  try {
    return localRequire('esbuild')
  } catch {
    // Not installed locally; fall through to the checkout scan.
  }

  const store = join(DSH_CHECKOUT, 'node_modules', '.pnpm')
  const candidates = []
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('esbuild@')) continue
      candidates.push(join(store, entry, 'node_modules', 'esbuild'))
    }
  }
  if (candidates.length > 0) {
    const pick = candidates.sort().at(-1)
    return createRequire(resolve(pick, 'package.json'))(pick)
  }

  throw new Error(
    'dsh-web-search-anysearch: cannot find esbuild.\n'
    + '  Run `pnpm install` in this directory (esbuild is a devDependency).\n'
    + `  Or set DSH_CHECKOUT to a DSH checkout to borrow its copy (currently: ${DSH_CHECKOUT}).`,
  )
}

const esbuild = loadEsbuild()

/**
 * Platform packages + react come from the DSH module table at runtime. This
 * plugin's own client code has no other third-party runtime imports (the card
 * CSS is an injected string; clsx-free class join is local).
 */
const CLIENT_EXTERNAL = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]

/** Browser half: one CJS factory registered with the host module loader. */
const clientBundle = {
  entryPoints: [resolve(HERE, 'src/client/index.ts')],
  outfile: resolve(HERE, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  sourcemap: true,
  logLevel: 'info',
  external: CLIENT_EXTERNAL,
  // Everything under @deepseek-ai/ stays a runtime require (module table).
  plugins: [{
    name: 'anysearch-external-platform',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: args.path, external: true }))
    },
  }],
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      'var module = { exports: {} };',
      'var exports = module.exports;',
      'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    ].join('\n'),
  },
  footer: {
    js: 'return module.exports; } });',
  },
}

/**
 * The only bare specifiers the host bundle may leave to runtime resolution.
 *
 * A plugin installed into a profile's node_modules can only resolve packages
 * that DSH actually ships runtime JS for AND the profile carries. Verified for
 * this deployment: NOTHING under `@deepseek-ai/` is present in the profile's
 * node_modules, so the allowlist is deliberately empty — every need is
 * vendored in src/vendor/ instead.
 *
 * This is an allowlist rather than "whatever resolved at build time" on
 * purpose: the build runs from a source checkout where every `@deepseek-ai/*`
 * name resolves to a source dir, so a build-time check would pass and the
 * installed plugin would still crash at startup.
 */
const HOST_RUNTIME_EXTERNAL_ALLOWLIST = new Set([
  // '@deepseek-ai/cordis',  // would need re-verification if the profile ever hosts it
])

/** Host half: ESM, self-contained except node builtins and the allowlist above. */
const hostBundle = {
  entryPoints: [resolve(HERE, 'src/host.ts')],
  outfile: resolve(HERE, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  // node:* builtins stay external. Nothing else is inlined today, but keep
  // the createRequire banner so a future CJS vendor dep cannot surprise us.
  external: [],
  banner: {
    js: [
      "import { createRequire as __anysearchCreateRequire } from 'node:module';",
      'const require = __anysearchCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  plugins: [{
    name: 'anysearch-external-platform',
    setup(build) {
      build.onResolve({ filter: /^(@deepseek-ai\/|node:)/ }, args => ({ path: args.path, external: true }))
    },
  }],
}

/**
 * Fail the build if the host bundle still hands an unresolvable specifier to
 * runtime resolution. Catches exactly the regression `src/vendor/` exists to
 * prevent: adding `import { X } from '@deepseek-ai/dsh-llm'` to a host module
 * looks fine on a dev machine and throws ERR_MODULE_NOT_FOUND for every user
 * who installed the plugin.
 */
function assertHostExternals(outfile) {
  const source = readFileSync(outfile, 'utf8')
  const specifiers = new Set()
  for (const m of source.matchAll(/(?:^|[;\n])\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g)) {
    specifiers.add(m[1])
  }
  for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.add(m[1])
  }
  // `export { X } from '...'` re-export marker is caught by the first regex too.

  const violations = [...specifiers].filter((spec) => {
    if (spec.startsWith('node:')) return false
    return !HOST_RUNTIME_EXTERNAL_ALLOWLIST.has(spec)
  })

  if (violations.length > 0) {
    throw new Error(
      'dsh-web-search-anysearch: host bundle imports packages that an installed plugin cannot resolve.\n'
      + violations.map(v => `  - ${v}`).join('\n')
      + '\n\n'
      + 'DSH ships @deepseek-ai/* as source only; a plugin inside a profile\'s\n'
      + 'node_modules gets plain node resolution and finds no lib/index.js.\n'
      + 'Vendor the leaf modules you need into src/vendor/ (see src/vendor/), or\n'
      + `add the name to HOST_RUNTIME_EXTERNAL_ALLOWLIST in ${basename(fileURLToPath(import.meta.url))}\n`
      + 'after verifying the package really ships runtime JS in the target profile.',
    )
  }
  return [...specifiers]
}

await Promise.all([esbuild.build(clientBundle), esbuild.build(hostBundle)])
const hostExternals = assertHostExternals(resolve(HERE, 'lib/index.js'))
console.log('[dsh-web-search-anysearch] built lib/index.js + lib/client.js')
console.log(`[dsh-web-search-anysearch] host runtime imports: ${hostExternals.length === 0 ? '(none)' : hostExternals.join(', ')}`)
