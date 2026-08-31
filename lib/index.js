import { createRequire as __anysearchCreateRequire } from 'node:module';
const require = __anysearchCreateRequire(import.meta.url);

// src/host.ts
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// src/vendor/error.ts
var HarnessError = class extends Error {
  /** Stable machine-routable failure class; route on this, never by parsing `message`. */
  code;
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
};
var WebError = class extends HarnessError {
};

// src/anysearch-provider.ts
var ANYSEARCH_PROVIDER_ID = "anysearch";
var ANYSEARCH_DEFAULT_BASE_URL = "https://api.anysearch.com";
var USER_AGENT = "dsh-web-search-anysearch/0.1.0";
function mapAnySearchResponse(response) {
  if (response.code !== void 0 && response.code !== 0) {
    const message = response.message?.trim();
    throw new WebError(
      `AnySearch API ${message !== void 0 && message.length > 0 ? message : `code ${response.code}`}`,
      "WEB_PROVIDER_ERROR"
    );
  }
  const sources = [];
  const results = response.data?.results ?? response.results ?? [];
  for (const result of results) {
    const url = result.url;
    if (url === void 0 || url.length === 0) continue;
    const snippet = result.snippet ?? result.description;
    sources.push({
      url,
      ...result.title !== void 0 && result.title.length > 0 ? { title: result.title } : {},
      ...snippet !== void 0 && snippet.length > 0 ? { snippet } : {},
      ...result.published_at !== void 0 && result.published_at.length > 0 ? { publishedAt: result.published_at } : {}
    });
  }
  return { sources, truncated: false };
}
var AnySearchSearchProvider = class {
  /**
   * @param resolveOptions - options for the NEXT operation, snapshotted once at
   * each operation's entry so one search never mixes two settings revisions.
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions;
  }
  resolveOptions;
  id = ANYSEARCH_PROVIDER_ID;
  available() {
    const options = this.resolveOptions();
    return URL.canParse(options.baseURL) && (options.maxResults === void 0 || isPositiveInteger(options.maxResults));
  }
  async search(request, signal) {
    const options = this.resolveOptions();
    const apiKey = await this.apiKey(options, signal);
    throwIfSearchAborted(signal);
    const maxResults = request.maxResults ?? options.maxResults;
    let response;
    try {
      response = await fetch(`${options.baseURL}/v1/search`, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "user-agent": USER_AGENT,
          ...apiKey !== void 0 && apiKey.length > 0 ? { "authorization": `Bearer ${apiKey}` } : {}
        },
        body: JSON.stringify({
          query: request.query,
          ...maxResults !== void 0 ? { max_results: maxResults } : {},
          ...options.tag !== void 0 && options.tag.length > 0 ? { tag: options.tag } : {},
          ...options.zone !== void 0 && options.zone.length > 0 ? { zone: options.zone } : {},
          ...options.language !== void 0 && options.language.length > 0 ? { language: options.language } : {}
        }),
        ...signal !== void 0 ? { signal } : {}
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError(`AnySearch search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
    if (!response.ok) {
      const status = response.status;
      let message = `AnySearch API error (HTTP ${status})`;
      try {
        const parsed = await response.json();
        const detail = parsed.message;
        if (detail !== void 0 && detail.length > 0) message = detail;
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      }
      throw new WebError(message, "WEB_PROVIDER_ERROR");
    }
    try {
      const payload = await response.json();
      return mapAnySearchResponse(payload);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError(`AnySearch returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
  }
  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  async apiKey(options, signal) {
    throwIfSearchAborted(signal);
    if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
    let resolved;
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(void 0), signal);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw new WebError(
        `AnySearch search credential resolution failed: ${String(error)}`,
        "WEB_PROVIDER_ERROR",
        { cause: error }
      );
    }
    return resolved !== void 0 && resolved.length > 0 ? resolved : void 0;
  }
};
function abortable(operation, signal) {
  if (signal === void 0) return operation;
  if (signal.aborted) return Promise.reject(searchAborted(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(searchAborted(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(new Error(String(error).replace(/^Error: /u, ""), { cause: error }));
      }
    );
  });
}
function throwIfSearchAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal);
}
function searchAborted(signal, fallback) {
  return new WebError("AnySearch search aborted", "WEB_ABORTED", {
    cause: signal?.aborted === true ? signal.reason : fallback
  });
}
function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}
function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

// src/vendor/credential-ref.ts
var REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
function credentialRef(value) {
  if (!REF_PATTERN.test(value)) {
    throw new TypeError(`credential ref "${value}" must match ${String(REF_PATTERN)}`);
  }
  return value;
}

// src/vendor/launch-environment.ts
var SOURCE_ORDER = ["process", "project-env", "user-env"];
function lookupKey(name2) {
  return process.platform === "win32" ? name2.toUpperCase() : name2;
}
function createLaunchEnvironmentSnapshot(layers) {
  const bySource = /* @__PURE__ */ new Map();
  for (const layer of layers) {
    bySource.set(layer.source, {
      ...layer.path === void 0 ? {} : { path: layer.path },
      values: new Map(Object.entries(layer.values).map(([name2, value]) => [lookupKey(name2), value]))
    });
  }
  const getFrom = (name2, sources) => {
    const key = lookupKey(name2);
    for (const source of SOURCE_ORDER) {
      if (!sources.includes(source)) continue;
      const layer = bySource.get(source);
      const value = layer?.values.get(key);
      if (value === void 0) continue;
      return { value, source, ...layer?.path === void 0 ? {} : { path: layer.path } };
    }
    return void 0;
  };
  return {
    get: (name2) => getFrom(name2, SOURCE_ORDER),
    getFrom
  };
}
var DSH_LAUNCH_ENVIRONMENT_KEY = "launchEnvironment";
function launchEnvironmentOf(ctx) {
  return ctx.get(DSH_LAUNCH_ENVIRONMENT_KEY) ?? createLaunchEnvironmentSnapshot([{ source: "process", values: process.env }]);
}

// src/vendor/settings-section.ts
var NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
function settingsNamespace(value) {
  if (!NAMESPACE_PATTERN.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
  }
  return value;
}
function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function normalizeField(field, def, raw) {
  if (raw === void 0) {
    return def.default === void 0 ? void 0 : def.default;
  }
  if (def.type === "string") {
    if (typeof raw !== "string") {
      throw new TypeError(`settings section field "${field}" must be a string`);
    }
    return raw;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new TypeError(`settings section field "${field}" must be an integer`);
  }
  if (def.min !== void 0 && raw < def.min) {
    throw new TypeError(`settings section field "${field}" must be at least ${String(def.min)}`);
  }
  return raw;
}
function sectionSchema(fields) {
  const nodes = {};
  for (const [field, def] of Object.entries(fields)) {
    nodes[field] = {
      type: def.type,
      ...def.role === void 0 ? {} : { meta: { role: def.role } }
    };
  }
  const schema = ((input) => {
    if (!isPlainObject(input)) {
      throw new TypeError("settings section must be an object of keys");
    }
    const out = {};
    for (const [field, def] of Object.entries(fields)) {
      const value = normalizeField(field, def, input[field]);
      if (value !== void 0) out[field] = value;
    }
    return out;
  });
  schema.type = "object";
  schema.dict = nodes;
  schema.toJSON = () => ({
    type: "object",
    dict: Object.fromEntries(
      Object.entries(nodes).map(([field, node]) => [
        field,
        { type: node.type, ...node.meta === void 0 ? {} : { meta: node.meta } }
      ])
    )
  });
  return schema;
}
var FIBER_DISPOSED = 4;
var FIBER_UNLOADING = 5;
function isUnloading(ctx) {
  const state = ctx.fiber?.state ?? 0;
  return state === FIBER_UNLOADING || state === FIBER_DISPOSED;
}
function installSettingsSection(ctx, ns, schema, entry, hooks) {
  ctx.inject(["settings"], (sctx) => {
    const scope = sctx.settings.register(ns, schema, { base: entry });
    hooks.setSource(() => scope.get());
    sctx.effect(() => () => {
      if (isUnloading(ctx)) return;
      hooks.setSource(() => entry);
      hooks.onChange();
    });
    hooks.onChange();
    scope.watch(() => {
      if (isUnloading(ctx)) return;
      hooks.onChange();
    });
  });
}

// src/host.ts
var name = "dsh-web-search-anysearch";
var inject = ["web"];
var DIAG_LOG = join(tmpdir(), "dsh-web-search-anysearch-apply.log");
function diag(label, error) {
  try {
    appendFileSync(DIAG_LOG, `[${(/* @__PURE__ */ new Date()).toISOString()}] ${label}: ${String(error?.stack ?? error)}
`);
  } catch {
  }
}
var DEFAULT_API_KEY_ENV = "ANYSEARCH_API_KEY";
var ANYSEARCH_SETTINGS_NAMESPACE = settingsNamespace("web-search-anysearch");
var AnySearchSchema = sectionSchema({
  apiKey: { type: "string", role: "secret" },
  apiKeyEnv: { type: "string", role: "credential-ref", default: DEFAULT_API_KEY_ENV },
  baseURL: { type: "string" },
  maxResults: { type: "number", min: 1 },
  tag: { type: "string" },
  zone: { type: "string" },
  language: { type: "string" }
});
function resolveAnySearchOptions(ctx, config) {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
  return {
    ...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get("credentials");
      if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
      return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? ANYSEARCH_DEFAULT_BASE_URL,
    ...config.maxResults !== void 0 ? { maxResults: config.maxResults } : {},
    ...config.tag !== void 0 && config.tag.length > 0 ? { tag: config.tag } : {},
    ...config.zone !== void 0 && config.zone.length > 0 ? { zone: config.zone } : {},
    ...config.language !== void 0 && config.language.length > 0 ? { language: config.language } : {}
  };
}
function apply(ctx, config = {}) {
  try {
    let current = () => config;
    ctx.web.registerSearchProvider(
      new AnySearchSearchProvider(() => resolveAnySearchOptions(ctx, current()))
    );
    try {
      installSettingsSection(ctx, ANYSEARCH_SETTINGS_NAMESPACE, AnySearchSchema, config, {
        setSource: (source) => {
          current = source;
        },
        // 注册不持有解析值：provider 每次搜索重新投影 section，提交无需重注册。
        onChange: () => {
        }
      });
    } catch (error) {
      diag("settings-section", error);
      ctx.logger?.warn?.(`[dsh-web-search-anysearch] \u8BBE\u7F6E\u547D\u540D\u7A7A\u95F4\u6302\u8F7D\u5931\u8D25\uFF1A${String(error)}`);
    }
  } catch (error) {
    diag("provider", error);
    ctx.logger?.warn?.(`[dsh-web-search-anysearch] AnySearch provider \u6CE8\u518C\u5931\u8D25\uFF1A${String(error)}`);
  }
}
export {
  ANYSEARCH_DEFAULT_BASE_URL,
  ANYSEARCH_PROVIDER_ID,
  ANYSEARCH_SETTINGS_NAMESPACE,
  AnySearchSchema,
  AnySearchSearchProvider,
  apply,
  inject,
  mapAnySearchResponse,
  name
};
//# sourceMappingURL=index.js.map
