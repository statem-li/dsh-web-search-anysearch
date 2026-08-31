# dsh-web-search-anysearch

DSH 外接网页搜索（AnySearch）独立插件 —— 从 [statem-li/dsh-webui](https://github.com/statem-li/dsh-webui) 的
`webSearch` 模块拆回单体的版本（原 `dsh-web-search-anysearch` 插件被合并进 webui 后，
随 webui 卸载一并消失；本插件补回该能力）。**零 DSH 源码改动，纯插件实现。**

## 功能

| 模块 | 说明 |
| --- | --- |
| AnySearch 搜索 provider | 向 `ctx.web` 注册 id=`anysearch` 的 `WebSearchProvider`，web_search 工具经 `POST https://api.anysearch.com/v1/search` 搜网页（匿名免费层可用；也可配 AnySearch API Key）。 |
| 插件设置卡 | 「设置 → 插件 → 可配置」出现「外接网页搜索」卡片（键槽 `settings.plugin.item`，key=`web-search-anysearch`）：API Key（写凭据域 `ANYSEARCH_API_KEY`，不进设置文档）/ Base URL / 默认结果数。 |

与内置 DeepSeek 搜索（`web-search-deepseek`）**不冲突**：provider id 唯一、设置卡键槽唯一；
profile 里已有的 `web.searchProvider: anysearch` 配置（webui 时代遗留）无缝指向本插件的 provider。

### 配置

设置命名空间 `web-search-anysearch`（与旧 webui 同名，旧设置文档无缝延续），字段：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `apiKeyEnv` | `ANYSEARCH_API_KEY` | 每次搜索解析的凭据引用 |
| `apiKey` | — | 字面 key（secret 角色，走设置文档时会被红act；建议只用 apiKeyEnv） |
| `baseURL` | `https://api.anysearch.com` | API 端点基址，`/v1/search` 自动拼接 |
| `maxResults` | — | 请求未带 `maxResults` 时的默认结果数 |
| `tag` / `zone` / `language` | — | AnySearch 可选能力标签 / 区域(cn\|intl) / 首选语言 |

组合配置（cordis 层、作为设置命名空间的 `base` 层）同名递补；没有配置时全默认。

## 架构与关键文件

```
src/
├── host.ts                    # Cordis 插件入口（name/inject/apply，双模块独立 try/catch）
├── anysearch-provider.ts      # AnySearchSearchProvider（webui provider.ts 逐字移植）
├── vendor/
│   ├── error.ts               # HarnessError + WebError（宿主叶子类内联副本）
│   ├── credential-ref.ts      # credentialRef（宿主叶子函数内联副本）
│   ├── launch-environment.ts  # launchEnvironmentOf（宿主叶子模块内联副本）
│   └── settings-section.ts    # settingsNamespace + installSettingsSection 等价物
│                              # + 极简 schemastery 兼容 schema（defaults/校验/redact 节点/toJSON）
└── client/
    ├── index.ts               # client 入口（__ModuleLoader__ 契约）
    ├── AnySearchCard.tsx      # 设置卡（webui AnySearchCard 移植；凭据路径改为当前契约）
    ├── anysearch-card-controller.ts  # 现版内置 WebSearchCardController 改版
    └── card-form.ts           # 现版内置 CardForm 逐字内联（ui-settings-plugins 不可被三方插件 import）
```

**为什么 vendor 这么多宿主模块**：装进 profile `node_modules` 的插件运行时**不能** import 任何
`@deepseek-ai/*`（DSH 只发源码，tsx paths 只对 node_modules 之外的 importer 生效），
需要的能力以叶子模块内联。构建末尾的守卫（`build.mjs` 的 `assertHostExternals`）会
在产物残留未验证的裸导入时**直接让构建失败**。

### 已知取舍（不修复）

- `web_search` 失败时工具结果携带完整人类可读 message，但**结构化 error info
  （`{ name, code }`）不会附带**：宿主工具层用
  `error instanceof HarnessError`（宿主类身份）提取它，第三方插件拿不到宿主类。
  仓库内 provider（exa/perplexity/deepseek）走 tsx paths 不受影响。
- 宿主插件重启前不生效（host 半身无热重载；client 半身刷页面即生效）。

## 构建与测试

```bash
pnpm install        # 只需要 esbuild（devDependency）
node build.mjs      # 产出 lib/index.js + lib/client.js（esbuild 双 bundle）
node scripts/smoke-host.mjs    # 裸 node 跑宿主冒烟（解析/契约/provider 端到端）
node scripts/smoke-client.mjs  # vm 沙箱跑 client 冒烟（loader/槽位/卡片表单流）
```

构建不需要 DSH checkout；本机有 DSH checkout 时 esbuild 也可以从
`node_modules/.pnpm/esbuild@*` 借用（见 build.mjs 的三档解析）。
`lib/` 已提交（git 依赖安装不跑 prepare），克隆后可直接安装。

## 安装 / 卸载

```bash
# 安装（bundle patch 自动注册，无需手改 profile 配置）
dsh plugin --profile web add github:statem-li/dsh-web-search-anysearch

# 卸载
dsh plugin --profile web remove dsh-web-search-anysearch
```

本地开发沿用 junction：

```powershell
# junction 运行时代码 + junction node_modules（自包含，无 node_modules 也可）
New-Item -ItemType Junction `
  -Path "C:\Users\Anti\.dsh\profiles\web\node_modules\dsh-web-search-anysearch" `
  -Target "D:\AI\Dsh\dsh-web-search-anysearch"
```

改完 host 代码**重启一次 DSH**（改 client 代码普通刷新页面即可）。

## 验收清单（本次已跑）

- [x] `node build.mjs`：host 产物运行时导入仅剩 `node:` 内置模块（守卫通过）
- [x] 源码目录 + 已安装（junction）位置双侧冒烟 PASS
- [x] `--dump-config`：`- id: dsh-web-search-anysearch` 出现在组合中；
      `web.searchProvider: anysearch` 与已有配置闭环
- [x] DSH 源码零改动（`git -C D:/AI/deepseek-harness status` 确认）

## License

MIT
