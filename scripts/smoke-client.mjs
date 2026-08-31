/**
 * dsh-web-search-anysearch — browser half smoke test.
 *
 * Executes `lib/client.js` under a stubbed DSH client environment and asserts:
 *   1. it registers exactly one `__ModuleLoader__` entry with the right id
 *   2. the factory exports `apply` (function) and `inject` (array) declaring
 *      slots / settingsScope / remote / remote.credentials
 *   3. `apply(ctx)` registers the `settings.plugin.item` slot entry keyed
 *      `web-search-anysearch` with a component and an inject face
 *   4. the card face: snapshot carries the resolved section, editing + saving
 *      writes the section fields through the scope and the API key through
 *      credentials.set, and a configured key flips the badge to configured
 *   5. rendering the card component against the injected face does not throw
 *
 * Usage: node scripts/smoke-client.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CLIENT = resolve(ROOT, 'lib/client.js')

/** Stand-in for any React component export (icons etc.). */
function stubComponent(name) {
  const Comp = () => ({ __stub: name })
  Object.defineProperty(Comp, 'name', { value: name })
  return Comp
}

/** Minimal DOM node (ensureStyles only needs createElement + head.appendChild). */
function stubNode(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    attrs: {},
    textContent: '',
    id: '',
    appendChild(child) { node.children.push(child); return child },
    insertBefore(child) { node.children.unshift(child); return child },
    removeChild(child) {
      const i = node.children.indexOf(child)
      if (i >= 0) node.children.splice(i, 1)
      return child
    },
    remove() {},
    setAttribute(k, v) { node.attrs[k] = v },
    getAttribute(k) { return node.attrs[k] ?? null },
    removeAttribute(k) { delete node.attrs[k] },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    contains: () => false,
    compareDocumentPosition: () => 0,
    getRootNode: () => sandbox.document,
    focus: () => {},
    click: () => {},
  }
  return node
}

/** Explicit React overrides. Kept separate so the Proxy below can consult it
 *  first — a bare `get` trap would otherwise shadow every one of these. */
const REACT_OVERRIDES = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  cloneElement: (el) => el,
  isValidElement: () => false,
  Children: { map: () => [], forEach: () => {}, count: () => 0, toArray: () => [] },
  Fragment: Symbol('Fragment'),
  // Real class, not a stub function: `class X extends Component` would throw
  // "is not a constructor" at module top level.
  Component: class Component {
    constructor(props) { this.props = props; this.state = null }
    setState() {}
    forceUpdate() {}
    render() { return null }
  },
  StrictMode: stubComponent('StrictMode'),
  Suspense: stubComponent('Suspense'),
  memo: (comp) => comp,
  forwardRef: (render) => render,
  lazy: () => stubComponent('Lazy'),
  startTransition: (fn) => fn?.(),
  createRef: () => ({ current: null }),
  createContext: () => ({ Provider: stubComponent('Provider'), Consumer: stubComponent('Consumer') }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useReducer: (reducer, init) => [init, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useInsertionEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
  useImperativeHandle: () => {},
  useContext: () => ({}),
  useId: () => 'stub-id',
  useDebugValue: () => {},
  useSyncExternalStore: (_sub, get) => get(),
  useTransition: () => [false, (fn) => fn?.()],
  useDeferredValue: (v) => v,
}

/** Minimal snapshot store standing in for @deepseek-ai/dsh-client-store. */
function createSnapshotStore(init) {
  let snapshot = init
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    set: (next) => { snapshot = next; for (const l of [...listeners]) l() },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

/** Everything the bundle may ask the platform for. */
const MODULES = {
  'react': new Proxy(REACT_OVERRIDES, {
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined
      if (Object.hasOwn(target, prop)) return target[prop]
      return stubComponent(prop)
    },
    has: () => true,
  }),
  'react/jsx-runtime': {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
    Fragment: Symbol('Fragment'),
  },
  'react-dom': { createPortal: (node) => node },
  'react-dom/client': { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
  '@deepseek-ai/dsh-client-store': { createSnapshotStore },
  '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, {
    get: (_t, prop) => (typeof prop === 'string' ? stubComponent(prop) : undefined),
    has: () => true,
  }),
}

// ── capture the loader registration ──────────────────────────────────────
const registrations = []
const sandbox = {
  __ModuleLoader__: { load: (entry) => { registrations.push(entry) } },
  document: {
    head: stubNode('head'),
    body: stubNode('body'),
    documentElement: stubNode('html'),
    createElement: (tag) => stubNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    getElementById: (id) => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  console,
  // Timers are recorded but never scheduled: the card's close animation timer
  // would keep the event loop alive and hang the smoke run.
  setTimeout: (() => { let id = 0; return (fn, ms) => { void fn; void ms; return ++id } })(),
  clearTimeout: () => {},
  setInterval: (() => { let id = 0; return (fn, ms) => { void fn; void ms; return ++id } })(),
  clearInterval: () => {},
  queueMicrotask: (fn) => fn(),
  fetch: async () => ({ ok: false, status: 599, json: async () => ({}) }),
  AbortController,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  CSS: { supports: () => false },
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox
sandbox.top = sandbox
sandbox.parent = sandbox
sandbox.location = { href: 'http://127.0.0.1:0/', origin: 'http://127.0.0.1:0', protocol: 'http:', host: '127.0.0.1:0' }
sandbox.navigator = { userAgent: 'dsh-web-search-anysearch-smoke', language: 'zh-CN', maxTouchPoints: 0 }
sandbox.innerWidth = 1440
sandbox.innerHeight = 900
sandbox.devicePixelRatio = 1
sandbox.addEventListener = () => {}
sandbox.removeEventListener = () => {}
sandbox.dispatchEvent = () => true
sandbox.scrollTo = () => {}

const context = vm.createContext(sandbox)
const code = readFileSync(CLIENT, 'utf8')
new vm.Script(code, { filename: CLIENT }).runInContext(context)

// ── assertions ───────────────────────────────────────────────────────────
const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`ok    ${msg}`)

if (registrations.length !== 1) fail(`expected 1 loader registration, got ${registrations.length}`)
else pass('registered exactly one __ModuleLoader__ entry')

const entry = registrations[0]
if (entry?.id !== 'dsh-web-search-anysearch') fail(`expected id "dsh-web-search-anysearch", got ${JSON.stringify(entry?.id)}`)
else pass('loader id is "dsh-web-search-anysearch"')

const require = (id) => {
  if (id in MODULES) return MODULES[id]
  throw new Error(`[smoke] unexpected require(${id}) — add it to the stub table`)
}

const mod = entry.factory(require)
if (typeof mod.apply !== 'function') fail('factory did not export apply()')
else pass('factory exports apply()')
if (!Array.isArray(mod.inject)) fail('factory did not export inject[]')
else pass(`factory exports inject[] = [${mod.inject.join(', ')}]`)

for (const svc of ['slots', 'settingsScope', 'remote', 'remote.credentials']) {
  if (!mod.inject.includes(svc)) fail(`inject must declare "${svc}"`)
}
pass('inject declares slots / settingsScope / remote / remote.credentials')

// ── run apply() against a stub client context ────────────────────────────
const registered = []
const credentialWrites = []
let credentialConfigured = false

const fakeScope = (() => {
  let snapshot = {
    status: 'ready',
    writable: true,
    value: { apiKeyEnv: 'ANYSEARCH_API_KEY' },
    base: { apiKeyEnv: 'ANYSEARCH_API_KEY' },
    user: {},
  }
  const listeners = new Set()
  const publish = () => { for (const l of [...listeners]) l() }
  return {
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => snapshot,
    set: (field, value) => {
      snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value }, user: { ...snapshot.user, [field]: value } }
      publish()
    },
    unset: (field) => {
      const { [field]: _gone, ...value } = snapshot.value
      const { [field]: _goneUser, ...user } = snapshot.user
      snapshot = { ...snapshot, value, user }
      publish()
    },
  }
})()

const ctx = {
  inject: (names, callback) => {
    if (!Array.isArray(names)) fail('ctx.inject must receive a service name array')
    callback({})
    return () => {}
  },
  settingsScope: { bind: (spec) => {
    if (spec?.namespace !== 'web-search-anysearch') fail(`bind namespace expected web-search-anysearch, got ${JSON.stringify(spec)}`)
    return fakeScope
  } },
  slots: {
    inject: (slot, factory) => { factory(); return () => {} },
    register: (spec, comp) => {
      if (comp === undefined) throw new Error('slots.register called without component')
      registered.push({ spec, comp })
      return () => {}
    },
  },
  remote: {
    credentials: {
      describe: async ([ref]) => {
        if (ref !== 'ANYSEARCH_API_KEY') fail(`credentials.describe expected ANYSEARCH_API_KEY, got ${JSON.stringify(ref)}`)
        return { ok: true, value: { [ref]: { configured: credentialConfigured, writable: true } } }
      },
      set: async (ref, value) => {
        credentialWrites.push({ ref, value })
        credentialConfigured = true
      },
    },
  },
}

try {
  mod.apply(ctx)
  pass('apply(ctx) ran without throwing')
} catch (error) {
  fail(`apply(ctx) threw: ${error?.stack ?? error}`)
}

if (registered.length !== 1) fail(`expected 1 slot registration, got ${registered.length}`)
else pass('registered exactly one slot entry')

const registration = registered[0]
if (registration?.spec?.name !== 'settings.plugin.item') fail(`expected slot name "settings.plugin.item", got ${JSON.stringify(registration?.spec?.name)}`)
else pass('slot name is settings.plugin.item')
if (registration?.spec?.key !== 'web-search-anysearch') fail(`expected entry key "web-search-anysearch", got ${JSON.stringify(registration?.spec?.key)}`)
else pass('entry key is web-search-anysearch')
if (typeof registration?.spec?.inject !== 'function') fail('entry inject is not a function')
else pass('entry inject is a function')

// ── card face: snapshot + staged save ────────────────────────────────────
const face = typeof registration?.spec?.inject === 'function' ? registration.spec.inject() : {}

if (typeof face?.hooks?.anysearchCard?.getSnapshot !== 'function') fail('inject face must carry the anysearchCard snapshot store')
else {
  const state = face.hooks.anysearchCard.getSnapshot()
  if (state.available !== true) fail('card must be available while the namespace is served')
  else pass('card snapshot available = true')
  if (state.apiKeyEnv !== undefined && state.apiKeyEnv !== 'ANYSEARCH_API_KEY') fail(`unexpected apiKeyEnv ${JSON.stringify(state.apiKeyEnv)}`)
  else pass('card snapshot carries the resolved section fields')
}

if (typeof face?.edit === 'function' && typeof face?.save === 'function') {
  // edit the section field, then save → scope.set
  face.edit('baseURL', 'https://custom.anysearch.test')
  face.save()
  await new Promise((render) => setImmediate(render))
  const snapshot = face.hooks.anysearchCard.getSnapshot()
  if (snapshot.baseURL.text !== 'https://custom.anysearch.test') fail('edit must stage baseURL into the field state')
  else pass('edit stages baseURL')
  if (snapshot.saving || snapshot.dirty) fail('save must clear drafts and dirty state')
  else pass('save clears drafts')

  // stage the API key → credentials.set with the referenced env name
  face.edit('apiKey', 'as_sk_smoke_test')
  face.save()
  await new Promise((render) => setImmediate(render))
  if (credentialWrites.length !== 1) fail(`expected 1 credentials.set, got ${credentialWrites.length}`)
  else if (credentialWrites[0]?.ref !== 'ANYSEARCH_API_KEY' || credentialWrites[0]?.value !== 'as_sk_smoke_test') {
    fail(`credentials.set payload wrong: ${JSON.stringify(credentialWrites[0])}`)
  } else pass('apiKey staged write goes to credentials.set(ANYSEARCH_API_KEY, ...)')

  const afterKey = face.hooks.anysearchCard.getSnapshot()
  if (afterKey.apiKeyConfigured !== true) fail('badge must flip to configured after a successful key write')
  else pass('apiKeyConfigured flips to true after set')
}

// invalid number blocks the save
if (typeof face?.edit === 'function' && typeof face?.save === 'function') {
  face.edit('maxResults', 'abc')
  const invalid = face.hooks.anysearchCard.getSnapshot()
  if (invalid.invalid !== true || invalid.maxResults.invalid !== true) fail('a non-numeric maxResults must mark the form invalid')
  else pass('non-numeric maxResults blocks the save (invalid)')
}

// ── render the card against the injected face (smoke-level render) ───────
if (typeof registration?.comp === 'function') {
  try {
    const element = registration.comp({
      ...face,
      useAnysearchCard: (selector) => selector(face.hooks.anysearchCard.getSnapshot()),
    })
    if (element === undefined || element === null) fail('card component returned null/undefined')
    else pass('card component renders against the injected face')
  } catch (error) {
    fail(`card component threw: ${error?.stack ?? error}`)
  }
}

console.log(`\n${process.exitCode ? 'SMOKE FAILED' : 'SMOKE PASSED'} — ${CLIENT}`)
// Explicit exit: stubbed modules may hold listeners/timers that keep node alive.
process.exit(process.exitCode ?? 0)
