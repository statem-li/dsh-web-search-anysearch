/**
 * AnySearch web-search provider settings card — ported from
 * `statem-li/dsh-webui` `src/client/AnySearchCard.tsx`, with the credential
 * write path updated to the current DSH client contract (`ctx.remote.credentials`
 * instead of the legacy `connection.api.credentials`).
 *
 * Registers a card into `settings.plugin.item` (the Plugins → Configurable
 * tab) bound to the `web-search-anysearch` namespace. The card is an exact
 * visual re-implementation of the built-in plugin cards (`PluginCard` /
 * `SecretField` / `ValueField` / `CardForm` from `dsh-client-ui-settings-plugins`),
 * which are internal and not importable by a third-party plugin. The CSS is
 * copied verbatim (theme variables intact, class names prefixed `ase-`) and
 * injected once as a style sheet; the form state machine is the built-in
 * `CardForm` ported verbatim (see ./card-form.ts). The API key is written
 * through the credentials domain (never into the settings section), exactly
 * like the built-in web-search card does for DeepSeek.
 */

import { useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { AnySearchCardController } from './anysearch-card-controller.ts'
import type { AnySearchCardFace, AnySearchCardState, AnySearchCredentials, AnySearchSettings } from './anysearch-card-controller.ts'

/**
 * Declare the plugin-configuration card slot this package contributes into.
 * The slot's declarer lives in `dsh-client-ui-settings-plugins` (an internal
 * repo package a third-party plugin must not depend on), so the card claims
 * the slot by augmenting the platform SlotMap with its contract directly.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section, keyed by settings namespace. */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root' }
  }
}

/** Namespace this card edits. Spelled here rather than imported: a client package must not depend on a Host package. */
export const NS = 'web-search-anysearch'

/** Credential reference the provider resolves when the section names none. */
export const DEFAULT_API_KEY_REF = 'ANYSEARCH_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

// ────────────────────────────────────────────────────────────────────────────
// Card chrome CSS — verbatim port of the built-in `PluginCard.module.css` and
// `fields.module.css`, class names prefixed `ase-` to stay collision-free.
// Injected once; the theme variables come from the host design system.
// ────────────────────────────────────────────────────────────────────────────

const CARD_STYLES = `
.ase-card {
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s, background .16s;
}
.ase-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.ase-cardOpen {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
.ase-header {
  width: 100%;
  appearance: none;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
}
.ase-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.ase-headText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ase-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--dsw-alias-label-primary);
}
.ase-description {
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.ase-chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform .16s;
}
.ase-chevronOpen { transform: rotate(180deg); }
.ase-body {
  border-top: 1px solid var(--dsw-alias-border-l2);
  margin: 0 16px;
  padding-bottom: 8px;
}
.ase-readOnly {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.ase-pending {
  flex: none;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.ase-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 4px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.ase-failed {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-error);
}
.ase-discard,
.ase-save {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 5px 14px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
}
.ase-discard {
  border-color: var(--dsw-alias-border-l2);
  background: none;
  color: var(--dsw-alias-label-secondary);
}
.ase-discard:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-dimmed);
}
.ase-save {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3);
}
.ase-discard:disabled,
.ase-save:disabled { opacity: 0.4; cursor: default; }
.ase-discard:focus-visible,
.ase-save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

.ase-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.ase-field + .ase-field { border-top: 1px solid var(--dsw-alias-border-l2); }
.ase-head { display: flex; align-items: center; gap: 8px; }
.ase-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.ase-badges { display: inline-flex; align-items: center; gap: 8px; }
.ase-badge {
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
  font-weight: 500;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.ase-badgeMuted {
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.ase-reset {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.ase-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.ase-reset:disabled { cursor: default; }
.ase-input {
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.ase-input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.ase-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.ase-inputInvalid { border-color: var(--dsw-alias-label-error); }
.ase-invalid {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-error);
}
.ase-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
`

/** Inject the card styles once. */
const STYLE_TAG_ID = 'dsh-web-search-anysearch-styles'
export function ensureCardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_TAG_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_TAG_ID
  style.textContent = CARD_STYLES
  document.head.appendChild(style)
}

/** `clsx`-free class join. */
function clsx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** One labelled text field control, matching the built-in `ValueField`. */
function ValueField(props: {
  id: string
  label: string
  hint: string
  text: string
  overridden: boolean
  invalid: boolean
  disabled: boolean
  numeric?: boolean
  placeholder?: string
  onEdit: (text: string) => void
  onReset: () => void
}): React.ReactElement {
  return (
    <div className="ase-field">
      <div className="ase-head">
        <label className="ase-label" htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className="ase-badges">
              <span className="ase-badge">已覆盖</span>
              <button
                type="button"
                className="ase-reset"
                disabled={props.disabled}
                onClick={props.onReset}
              >
                重置
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        className={props.invalid ? 'ase-input ase-inputInvalid' : 'ase-input'}
        type="text"
        inputMode={props.numeric === true ? 'numeric' : undefined}
        aria-invalid={props.invalid || undefined}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? 'ase-invalid' : 'ase-hint'}>
        {props.invalid ? '请输入有效的数字' : props.hint}
      </p>
    </div>
  )
}

/** Write-only credential control, matching the built-in `SecretField`. */
function SecretField(props: {
  id: string
  label: string
  hint: string
  text: string
  disabled: boolean
  configured: boolean
  onEdit: (text: string) => void
}): React.ReactElement {
  return (
    <div className="ase-field">
      <div className="ase-head">
        <label className="ase-label" htmlFor={props.id}>{props.label}</label>
        <span className="ase-badges">
          <span className={props.configured ? 'ase-badge' : 'ase-badgeMuted'}>
            {props.configured ? '已配置' : '未配置'}
          </span>
        </span>
      </div>
      <input
        id={props.id}
        className="ase-input"
        type="password"
        autoComplete="off"
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className="ase-hint">{props.hint}</p>
    </div>
  )
}

/**
 * The card component. The slot dispatcher injects the face: `hooks` arrive as
 * the `useAnysearchCard` selector hook, and the action callbacks pass through.
 */
function AnySearchCard(props: AnySearchCardFace & {
  useAnysearchCard: (selector: (state: AnySearchCardState) => AnySearchCardState) => AnySearchCardState
}): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const state = props.useAnysearchCard(snapshot => snapshot)
  if (!state.available) return null
  const title = '外接网页搜索'
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={clsx('ase-card', open && 'ase-cardOpen')}>
      <button
        type="button"
        className="ase-header"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="ase-headText">
          <span className="ase-name">{title}</span>
          <span className="ase-description">使用 AnySearch API（api.anysearch.com）的网页搜索提供者</span>
        </span>
        {state.dirty ? <span className="ase-pending">未保存更改</span> : null}
        <IconChevronDownOutline14 className={clsx('ase-chevron', open && 'ase-chevronOpen')} />
      </button>
      {open
        ? (
          <div className="ase-body">
            {!state.writable ? <p className="ase-readOnly" role="status">当前设置文档为只读</p> : null}
            <SecretField
              id="plugin-config-anysearch-key"
              label="API Key"
              hint={state.apiKeyConfigured ? '已配置，输入新 Key 以更换' : '粘贴 ANYSEARCH_API_KEY，留空则使用匿名免费层'}
              text={state.apiKey.text}
              disabled={!state.apiKeyWritable}
              configured={state.apiKeyConfigured}
              onEdit={(text) => { props.edit(API_KEY_FIELD, text) }}
            />
            <ValueField
              id="plugin-config-anysearch-base-url"
              label="Base URL"
              hint="AnySearch API 地址，/v1/search 自动拼接"
              text={state.baseURL.text}
              overridden={state.baseURL.overridden}
              invalid={state.baseURL.invalid}
              disabled={!state.writable}
              placeholder="https://api.anysearch.com"
              onEdit={(text) => { props.edit('baseURL', text) }}
              onReset={() => { props.resetField('baseURL') }}
            />
            <ValueField
              id="plugin-config-anysearch-max-results"
              label="默认结果数"
              hint="每次搜索默认返回的结果数量，可留空"
              text={state.maxResults.text}
              overridden={state.maxResults.overridden}
              invalid={state.maxResults.invalid}
              disabled={!state.writable}
              numeric
              onEdit={(text) => { props.edit('maxResults', text) }}
              onReset={() => { props.resetField('maxResults') }}
            />
            <div className="ase-footer">
              {state.failed ? <p className="ase-failed" role="status">保存失败，请重试</p> : null}
              <button
                type="button"
                className="ase-discard"
                disabled={!state.dirty || state.saving}
                onClick={props.discard}
              >
                放弃
              </button>
              <button
                type="button"
                className="ase-save"
                disabled={blocked}
                onClick={props.save}
              >
                {state.saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}

/**
 * Register the AnySearch card into the plugin-configuration section. Called by
 * the client entry so this package's SlotMap/declare-module augmentations
 * share one apply.
 * @param ctx - browser plugin context (needs slots + settingsScope + remote.credentials).
 */
export function registerAnySearchCard(ctx: ClientContext): void {
  ensureCardStyles()
  const remote = (ctx as unknown as { remote?: { credentials?: AnySearchCredentials } }).remote
  if (remote?.credentials === undefined) {
    console.warn('[dsh-web-search-anysearch] remote.credentials 缺失，设置卡跳过')
    return
  }
  const scope = ctx.settingsScope.bind({ namespace: NS }) as unknown as SettingsScope<AnySearchSettings>
  const controller = new AnySearchCardController(scope, remote.credentials)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    // A keyed slot: the entry is dispatched by its key, and the key must be
    // the settings namespace the card edits (`web-search-anysearch`) so the
    // configurable-plugins tab pairs it with the section this plugin serves.
    key: NS,
    inject: () => controller.inject(),
  }, AnySearchCard as never))
}
