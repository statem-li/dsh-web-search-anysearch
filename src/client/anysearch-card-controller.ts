/**
 * The AnySearch card's staged form over the `web-search-anysearch` settings
 * namespace — adapted from the built-in `WebSearchCardController`
 * (`packages/client/ui-settings-plugins/src/client/web-search-card-controller.ts`)
 * with the namespace / credential reference / fields re-targeted to AnySearch.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the card learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * section names. It is still staged with the rest of the form, so one save
 * covers everything the card shows.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the AnySearch search provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const ANYSEARCH_NS = 'web-search-anysearch'

/** Credential reference the provider resolves when the section names none. */
export const DEFAULT_API_KEY_REF = 'ANYSEARCH_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The search-provider fields this card edits. */
export interface AnySearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. */
  maxResults?: number
}

/** The credentials Remote methods this card reads and writes through. */
export type AnySearchCredentials = Pick<ClientRemote['credentials'], 'describe' | 'set'>

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the anysearch card renders. */
export interface AnySearchCardState extends CardShell {
  /** Provider endpoint. */
  baseURL: CardFieldState
  /** Default result count per request. */
  maxResults: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the anysearch card's slot entry injects. */
export interface AnySearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useAnysearchCard. */
    anysearchCard: SnapshotStore<AnySearchCardState>
  }
}

/** Bridges the `web-search-anysearch` scope and the credentials domain onto the card. */
export class AnySearchCardController {
  private readonly form: CardForm<AnySearchSettings>
  private readonly store: SnapshotStore<AnySearchCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `web-search-anysearch` namespace.
   * @param credentials - Remote face used for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsScope<AnySearchSettings>,
    private readonly credentials: AnySearchCredentials,
  ) {
    this.form = new CardForm(
      scope,
      [textField('baseURL'), numberField('maxResults')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): AnySearchCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      maxResults: this.form.field('maxResults'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<AnySearchCredentials['describe']>>
    try {
      response = await this.credentials.describe([ref])
    } catch (_credentialReadFailure) {
      // The card stays usable without this: the key control simply reports the
      // last state it knew, and a write still reaches the Host.
      return
    }
    if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.value[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the card guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): AnySearchCardFace {
    return { hooks: { anysearchCard: this.store }, ...this.form.actions() }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.credentials.set(refOf(this.scope.getSnapshot()), value)
    } catch (_credentialWriteFailure) {
      // Refusals surface through the re-read below: the Host is the only
      // authority on whether the key now exists.
    }
    await this.readCredential()
    return this.credential.configured
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<AnySearchSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}
