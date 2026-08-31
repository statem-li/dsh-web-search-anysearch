window.__ModuleLoader__.load({ id: "dsh-web-search-anysearch", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/AnySearchCard.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/card-form.ts
var import_dsh_client_store = require("@deepseek-ai/dsh-client-store");
function numberField(field) {
  return {
    field,
    format: (value) => typeof value === "number" ? String(value) : "",
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return { kind: "clear" };
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? { kind: "set", value: parsed } : void 0;
    }
  };
}
function textField(field) {
  return {
    field,
    format: (value) => typeof value === "string" ? value : "",
    parse: (text) => {
      const trimmed = text.trim();
      return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
    }
  };
}
var CardForm = class {
  /**
   * @param scope - the bound settings scope for this card's namespace.
   * @param specs - the section fields this card edits.
   * @param secrets - the card's write-only controls, written outside the section.
   */
  constructor(scope, specs, secrets = []) {
    __publicField(this, "scope", scope);
    __publicField(this, "specs");
    __publicField(this, "secretSpecs");
    __publicField(this, "staged", /* @__PURE__ */ new Map());
    __publicField(this, "listeners", /* @__PURE__ */ new Set());
    __publicField(this, "saving", false);
    __publicField(this, "failed", false);
    this.specs = new Map(specs.map((spec) => [spec.field, spec]));
    this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]));
    scope.subscribe(() => {
      this.publish();
    });
  }
  /**
   * Publish a projection of this form, rebuilt whenever the scope or a draft changes.
   * @param project - build the card's state from the form's current reads.
   * @returns the store the card's component reads through its bound selector.
   */
  bind(project) {
    const store = (0, import_dsh_client_store.createSnapshotStore)(project());
    this.listeners.add(() => {
      store.set(project());
    });
    return store;
  }
  /** Read the card-level state: what the Host serves, and what a save would do. */
  shell() {
    const snapshot = this.scope.getSnapshot();
    const plan = this.plan();
    return {
      available: snapshot.status === "ready",
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === void 0),
      saving: this.saving,
      failed: this.failed
    };
  }
  /**
   * Read one control's state.
   * @param field - field name of a section field or of a write-only control.
   * @returns the draft text, whether a save would leave an override, and whether it is invalid.
   */
  field(field) {
    const staged = this.staged.get(field);
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? "", overridden: false, invalid: false };
    }
    const spec = this.spec(field);
    if (staged === void 0) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
    }
    const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
    return {
      text: staged.text,
      overridden: write?.kind === "set",
      invalid: write === void 0
    };
  }
  /**
   * Build the edit, reset, save, and discard actions bound to this form.
   * @returns the actions a card's slot entry injects.
   */
  actions() {
    return {
      edit: (field, text) => {
        this.stage(field, { text, clear: false });
      },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true });
      },
      save: () => {
        void this.save();
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return;
        this.staged.clear();
        this.failed = false;
        this.publish();
      }
    };
  }
  /**
   * Write every staged edit, then re-seed from what the Host accepted.
   *
   * The Host is the only authority on whether a value was accepted, so the
   * outcome is read back from the section rather than predicted here. A save
   * that did not land keeps its drafts, so the user can correct them instead of
   * retyping.
   */
  async save() {
    const plan = this.plan();
    const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
    this.saving = true;
    this.failed = false;
    this.publish();
    let landed = true;
    for (const write of writes) {
      landed = await write() && landed;
    }
    if (landed) this.staged.clear();
    this.saving = false;
    this.failed = !landed;
    this.publish();
  }
  /**
   * Every staged edit a save would write. An entry whose draft is not a value
   * its field accepts carries no write: the form is still dirty, and the save
   * refuses rather than dropping the edit.
   */
  plan() {
    const plan = [];
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field);
      if (secret !== void 0) {
        const value = staged.text.trim();
        if (value !== "") plan.push({ field, run: () => secret.write(value) });
        continue;
      }
      const spec = this.spec(field);
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, run: () => this.clear(field) });
        continue;
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue;
      const write = spec.parse(staged.text);
      if (write === void 0) plan.push({ field, run: void 0 });
      else if (write.kind === "clear") plan.push({ field, run: () => this.clear(field) });
      else plan.push({ field, run: () => this.store(field, write.value) });
    }
    return plan;
  }
  async clear(field) {
    await this.scope.unset(field);
    return !this.stored(field);
  }
  async store(field, value) {
    await this.scope.set(field, value);
    return this.userLayer()?.[field] === value;
  }
  stage(field, edit) {
    this.staged.set(field, edit);
    this.failed = false;
    this.publish();
  }
  spec(field) {
    const spec = this.specs.get(field);
    if (spec === void 0) throw new Error(`plugin card has no field ${field}`);
    return spec;
  }
  snapshotOf() {
    return this.scope.getSnapshot();
  }
  sectionValue(field) {
    return this.snapshotOf().value?.[field];
  }
  baseValue(field) {
    return this.snapshotOf().base?.[field];
  }
  userLayer() {
    return this.snapshotOf().user;
  }
  stored(field) {
    const user = this.userLayer();
    return user !== void 0 && Object.hasOwn(user, field);
  }
  publish() {
    for (const listener of this.listeners) listener();
  }
};

// src/client/anysearch-card-controller.ts
var DEFAULT_API_KEY_REF = "ANYSEARCH_API_KEY";
var API_KEY_FIELD = "apiKey";
var AnySearchCardController = class {
  /**
   * @param scope - the bound settings scope for the `web-search-anysearch` namespace.
   * @param credentials - Remote face used for the credential the section references.
   */
  constructor(scope, credentials) {
    __publicField(this, "scope", scope);
    __publicField(this, "credentials", credentials);
    __publicField(this, "form");
    __publicField(this, "store");
    __publicField(this, "credential", { ref: "", configured: false, writable: true });
    this.form = new CardForm(
      scope,
      [textField("baseURL"), numberField("maxResults")],
      [{ field: API_KEY_FIELD, write: (text) => this.writeKey(text) }]
    );
    this.store = this.form.bind(() => this.projection());
    scope.subscribe(() => {
      void this.readCredential();
    });
    void this.readCredential();
  }
  projection() {
    return {
      ...this.form.shell(),
      baseURL: this.form.field("baseURL"),
      maxResults: this.form.field("maxResults"),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable
    };
  }
  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force.
   */
  async readCredential() {
    const ref = refOf(this.scope.getSnapshot());
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true };
      this.store.set(this.projection());
    }
    let response;
    try {
      response = await this.credentials.describe([ref]);
    } catch (_credentialReadFailure) {
      return;
    }
    if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return;
    const view = response.value[ref];
    const next = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the card guessing a refusal.
      writable: view?.writable ?? true
    };
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
    this.credential = next;
    this.store.set(this.projection());
  }
  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject() {
    return { hooks: { anysearchCard: this.store }, ...this.form.actions() };
  }
  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  async writeKey(value) {
    try {
      await this.credentials.set(refOf(this.scope.getSnapshot()), value);
    } catch (_credentialWriteFailure) {
    }
    await this.readCredential();
    return this.credential.configured;
  }
};
function refOf(snapshot) {
  const declared = snapshot.value?.apiKeyEnv;
  return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
}

// src/client/AnySearchCard.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var NS = "web-search-anysearch";
var API_KEY_FIELD2 = "apiKey";
var CARD_STYLES = `
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
`;
var STYLE_TAG_ID = "dsh-web-search-anysearch-styles";
function ensureCardStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_TAG_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = CARD_STYLES;
  document.head.appendChild(style);
}
function clsx(...parts) {
  return parts.filter(Boolean).join(" ");
}
function ValueField(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ase-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ase-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "ase-label", htmlFor: props.id, children: props.label }),
      props.overridden ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ase-badges", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ase-badge", children: "\u5DF2\u8986\u76D6" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "ase-reset",
            disabled: props.disabled,
            onClick: props.onReset,
            children: "\u91CD\u7F6E"
          }
        )
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        id: props.id,
        className: props.invalid ? "ase-input ase-inputInvalid" : "ase-input",
        type: "text",
        inputMode: props.numeric === true ? "numeric" : void 0,
        "aria-invalid": props.invalid || void 0,
        value: props.text,
        placeholder: props.placeholder ?? "",
        disabled: props.disabled,
        onChange: (event) => {
          props.onEdit(event.target.value);
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: props.invalid ? "ase-invalid" : "ase-hint", children: props.invalid ? "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u6570\u5B57" : props.hint })
  ] });
}
function SecretField(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ase-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ase-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "ase-label", htmlFor: props.id, children: props.label }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ase-badges", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: props.configured ? "ase-badge" : "ase-badgeMuted", children: props.configured ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E" }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        id: props.id,
        className: "ase-input",
        type: "password",
        autoComplete: "off",
        value: props.text,
        disabled: props.disabled,
        onChange: (event) => {
          props.onEdit(event.target.value);
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ase-hint", children: props.hint })
  ] });
}
function AnySearchCard(props) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const state = props.useAnysearchCard((snapshot) => snapshot);
  if (!state.available) return null;
  const title = "\u5916\u63A5\u7F51\u9875\u641C\u7D22";
  const blocked = !state.dirty || state.invalid || state.saving;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: clsx("ase-card", open && "ase-cardOpen"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "ase-header",
        "aria-expanded": open,
        "aria-label": `${open ? "\u6536\u8D77" : "\u5C55\u5F00"}: ${title}`,
        onClick: () => {
          setOpen(!open);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ase-headText", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ase-name", children: title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ase-description", children: "\u4F7F\u7528 AnySearch API\uFF08api.anysearch.com\uFF09\u7684\u7F51\u9875\u641C\u7D22\u63D0\u4F9B\u8005" })
          ] }),
          state.dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ase-pending", children: "\u672A\u4FDD\u5B58\u66F4\u6539" }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronDownOutline14, { className: clsx("ase-chevron", open && "ase-chevronOpen") })
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ase-body", children: [
      !state.writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ase-readOnly", role: "status", children: "\u5F53\u524D\u8BBE\u7F6E\u6587\u6863\u4E3A\u53EA\u8BFB" }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SecretField,
        {
          id: "plugin-config-anysearch-key",
          label: "API Key",
          hint: state.apiKeyConfigured ? "\u5DF2\u914D\u7F6E\uFF0C\u8F93\u5165\u65B0 Key \u4EE5\u66F4\u6362" : "\u7C98\u8D34 ANYSEARCH_API_KEY\uFF0C\u7559\u7A7A\u5219\u4F7F\u7528\u533F\u540D\u514D\u8D39\u5C42",
          text: state.apiKey.text,
          disabled: !state.apiKeyWritable,
          configured: state.apiKeyConfigured,
          onEdit: (text) => {
            props.edit(API_KEY_FIELD2, text);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ValueField,
        {
          id: "plugin-config-anysearch-base-url",
          label: "Base URL",
          hint: "AnySearch API \u5730\u5740\uFF0C/v1/search \u81EA\u52A8\u62FC\u63A5",
          text: state.baseURL.text,
          overridden: state.baseURL.overridden,
          invalid: state.baseURL.invalid,
          disabled: !state.writable,
          placeholder: "https://api.anysearch.com",
          onEdit: (text) => {
            props.edit("baseURL", text);
          },
          onReset: () => {
            props.resetField("baseURL");
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ValueField,
        {
          id: "plugin-config-anysearch-max-results",
          label: "\u9ED8\u8BA4\u7ED3\u679C\u6570",
          hint: "\u6BCF\u6B21\u641C\u7D22\u9ED8\u8BA4\u8FD4\u56DE\u7684\u7ED3\u679C\u6570\u91CF\uFF0C\u53EF\u7559\u7A7A",
          text: state.maxResults.text,
          overridden: state.maxResults.overridden,
          invalid: state.maxResults.invalid,
          disabled: !state.writable,
          numeric: true,
          onEdit: (text) => {
            props.edit("maxResults", text);
          },
          onReset: () => {
            props.resetField("maxResults");
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ase-footer", children: [
        state.failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ase-failed", role: "status", children: "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "ase-discard",
            disabled: !state.dirty || state.saving,
            onClick: props.discard,
            children: "\u653E\u5F03"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "ase-save",
            disabled: blocked,
            onClick: props.save,
            children: state.saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"
          }
        )
      ] })
    ] }) : null
  ] });
}
function registerAnySearchCard(ctx) {
  ensureCardStyles();
  const remote = ctx.remote;
  if (remote?.credentials === void 0) {
    console.warn("[dsh-web-search-anysearch] remote.credentials \u7F3A\u5931\uFF0C\u8BBE\u7F6E\u5361\u8DF3\u8FC7");
    return;
  }
  const scope = ctx.settingsScope.bind({ namespace: NS });
  const controller = new AnySearchCardController(scope, remote.credentials);
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    // A keyed slot: the entry is dispatched by its key, and the key must be
    // the settings namespace the card edits (`web-search-anysearch`) so the
    // configurable-plugins tab pairs it with the section this plugin serves.
    key: NS,
    inject: () => controller.inject()
  }, AnySearchCard));
}

// src/client/index.ts
var inject = ["slots", "settingsScope", "remote", "remote.credentials"];
function apply(ctx) {
  try {
    ctx.inject(["slots", "settingsScope", "remote", "remote.credentials"], () => {
      registerAnySearchCard(ctx);
    });
  } catch (error) {
    console.warn(`[dsh-web-search-anysearch] \u8BBE\u7F6E\u5361\u6302\u8F7D\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
}
return module.exports; } });
//# sourceMappingURL=client.js.map
