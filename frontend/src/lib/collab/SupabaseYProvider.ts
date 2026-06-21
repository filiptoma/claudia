import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { base64ToBytes, bytesToBase64, bytesToPgHex, pgHexToBytes } from './codec'

// The two message-budget safeguards that live in the transport (the third — "only run at all when ≥2
// are present" — is enforced by useCollab, which decides whether to construct a provider):
//   1. Coalesce edit updates and broadcast at most once per this interval (not per keystroke).
//   2. Throttle awareness (cursor/selection) — the single biggest message source if left unthrottled.
const EDIT_FLUSH_MS = 250
const AWARENESS_FLUSH_MS = 400

// The Y.Text field bound to CodeMirror. Both peers must agree on the name.
const FIELD = 'content'

export interface CollabUser {
  uid: string
  name: string
  /** Caret colour (solid) + selection colour (translucent) for y-codemirror.next remote selections. */
  color: string
  colorLight: string
}

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] }

/**
 * A thin Yjs provider over a Supabase **broadcast** channel (`doc-collab:<id>`, private → RLS-gated to
 * editors). It is deliberately hand-rolled (~the plan's "right-size tooling") because two things are
 * bespoke and not well served by the community Supabase-Yjs packages: the DB-backed initial sync and
 * the message-budget safeguards.
 *
 * Lifecycle: construct → `start(seedText)` (loads the canonical blob from the DB, or seeds it once under
 * a single-writer election) → live. The owner (useCollab) tears it down with `destroy()` when the doc is
 * no longer being co-edited.
 *
 * Wire protocol (all payloads `{ d: base64 }`):
 *   - `sync1`  : a joiner's state vector. On receipt we reply with the diff they're missing (`update`).
 *   - `update` : a (merged) Yjs update to apply.
 *   - `awareness` : an encoded awareness update (cursors/selection/identity).
 */
export class SupabaseYProvider {
  readonly ydoc: Y.Doc
  readonly ytext: Y.Text
  readonly awareness: Awareness
  readonly whenSynced: Promise<void>

  private readonly docId: string
  // Read-only observer (a viewer/commenter watching live edits): receives + applies updates, but never
  // sends sync1/awareness/edits (a non-editor can't broadcast — RLS) and never seeds the canonical blob.
  private readonly readOnly: boolean
  // True once a canonical blob has been loaded from the DB. Observers only surface their text once this
  // is set, so a join-before-seed race never flashes an empty/partial document (updates still apply and
  // Yjs reconciles them against the blob when it arrives).
  private hasState = false
  private channel: RealtimeChannel | null = null
  private subscribed = false
  private destroyed = false
  private resolveSynced!: () => void

  // safeguard 1: buffer of local updates, drained on an interval into one broadcast.
  private pending: Uint8Array[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  // safeguard 2: clients whose awareness changed since the last throttled flush.
  private awarenessDirty = new Set<number>()
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null

  constructor(docId: string, user: CollabUser, opts: { readOnly?: boolean } = {}) {
    this.docId = docId
    this.readOnly = opts.readOnly ?? false
    this.ydoc = new Y.Doc()
    this.ytext = this.ydoc.getText(FIELD)
    this.awareness = new Awareness(this.ydoc)
    this.whenSynced = new Promise<void>((res) => (this.resolveSynced = res))
    // Identity is published in awareness, BUT it's only used to paint cursors — never to gate access
    // (that's RLS) — so a spoofed name here is cosmetic, not a privilege.
    this.awareness.setLocalStateField('user', {
      name: user.name,
      color: user.color,
      colorLight: user.colorLight,
      uid: user.uid,
    })
    // Observers never emit — so don't even wire the local→wire listeners.
    if (!this.readOnly) {
      this.ydoc.on('update', this.onLocalUpdate)
      this.awareness.on('update', this.onAwarenessUpdate)
    }
  }

  /** Has a canonical document blob been loaded yet? Observers gate their rendered text on this. */
  get ready(): boolean {
    return this.hasState
  }

  /** Load the canonical Yjs state from the DB (or seed it once), then go live on the broadcast channel. */
  async start(seedText: string): Promise<void> {
    await this.loadOrSeed(seedText)
    if (this.destroyed) return
    this.subscribe()
    if (!this.readOnly) this.flushTimer = setInterval(this.flush, EDIT_FLUSH_MS)
  }

  /** Re-read the canonical blob and merge it (Yjs reconciles). An observer polls this so it (a) picks
   *  up the blob if it joined before the first editor seeded it, and (b) backfills any edits broadcast
   *  in the gap between the leader's last persist and the observer subscribing. */
  async reloadCanonical(): Promise<void> {
    if (this.destroyed) return
    const { data } = await supabase
      .from('document_collab')
      .select('ydoc')
      .eq('document_id', this.docId)
      .maybeSingle()
    const blob = (data as { ydoc: string } | null)?.ydoc
    if (blob) {
      Y.applyUpdate(this.ydoc, pgHexToBytes(blob), this)
      this.hasState = true
    }
  }

  // ---- initial state: DB, not broadcast (no message cost, no 256 KB broadcast-size risk) ----
  private async loadOrSeed(seedText: string): Promise<void> {
    const { data, error } = await supabase
      .from('document_collab')
      .select('ydoc')
      .eq('document_id', this.docId)
      .maybeSingle()
    if (error) console.warn('[collab] read document_collab failed', error)

    const blob = (data as { ydoc: string } | null)?.ydoc
    if (blob) {
      Y.applyUpdate(this.ydoc, pgHexToBytes(blob), this)
      this.hasState = true
      this.resolveSynced()
      return
    }

    // Observers can't seed (RLS), and there's no canonical doc yet — stay empty (the caller renders the
    // static fallback) until a blob appears via the observer's reloadCanonical poll.
    if (this.readOnly) {
      this.resolveSynced()
      return
    }

    // First-ever session for this doc: elect a single seeder. Encode the candidate in a THROWAWAY doc so
    // our real ydoc never holds a seed we might have to discard — then `insert ... on conflict do nothing`
    // (ignoreDuplicates) makes the DB unique PK pick exactly one winner. Re-read and adopt the canonical
    // blob (ours if we won, the peer's otherwise). This is the classic "two clients seed the same text →
    // duplicated content" pitfall, sidestepped by only ever applying ONE elected blob to our ydoc.
    const seed = new Y.Doc()
    seed.getText(FIELD).insert(0, seedText)
    const seedBytes = Y.encodeStateAsUpdate(seed)
    seed.destroy()

    const { error: insErr } = await supabase
      .from('document_collab')
      .upsert(
        { document_id: this.docId, ydoc: bytesToPgHex(seedBytes), updated_at: new Date().toISOString() },
        { onConflict: 'document_id', ignoreDuplicates: true },
      )
    if (insErr) console.warn('[collab] seed document_collab failed', insErr)

    const { data: canon } = await supabase
      .from('document_collab')
      .select('ydoc')
      .eq('document_id', this.docId)
      .maybeSingle()
    const canonBlob = (canon as { ydoc: string } | null)?.ydoc
    Y.applyUpdate(this.ydoc, canonBlob ? pgHexToBytes(canonBlob) : seedBytes, this)
    this.resolveSynced()
  }

  // ---- broadcast channel ----
  private subscribe(): void {
    // self:false — don't loop our own messages back to us.
    this.channel = supabase.channel(`doc-collab:${this.docId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    this.channel
      .on('broadcast', { event: 'sync1' }, ({ payload }) => this.onSync1(payload as { d: string }))
      .on('broadcast', { event: 'update' }, ({ payload }) => this.onRemoteUpdate(payload as { d: string }))
      .on('broadcast', { event: 'awareness' }, ({ payload }) => this.onRemoteAwareness(payload as { d: string }))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          this.subscribed = true
          // Observers only listen — sending sync1/awareness/edits requires broadcast (editor RLS), so a
          // viewer's sends would just be rejected. They rely on the canonical blob + received updates.
          if (!this.readOnly) {
            // Ask peers for any edits made between our DB read and now (they answer with `update`), and
            // announce our own cursor/identity straight away so others paint it without waiting.
            this.send('sync1', bytesToBase64(Y.encodeStateVector(this.ydoc)))
            this.send('awareness', bytesToBase64(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])))
            this.flush() // anything buffered during the subscribe handshake
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Most likely the realtime.messages broadcast RLS (migration 0026) isn't applied, or this user
          // lacks EDIT. Surface it rather than silently never syncing.
          console.warn(`[collab] doc-collab:${this.docId} ${status}`, err ?? '')
        }
      })
  }

  private send(event: 'sync1' | 'update' | 'awareness', d: string): void {
    if (!this.subscribed || !this.channel) return
    void this.channel.send({ type: 'broadcast', event, payload: { d } })
  }

  // A joiner sent their state vector → reply with exactly the delta they lack (small: just edits not yet
  // in the DB blob they loaded). Broadcast, so other peers also receive it — applying a delta they already
  // have is a Yjs no-op, so that's harmless.
  private onSync1(payload: { d: string }): void {
    const diff = Y.encodeStateAsUpdate(this.ydoc, base64ToBytes(payload.d))
    this.send('update', bytesToBase64(diff))
  }

  private onRemoteUpdate(payload: { d: string }): void {
    // origin = this ⇒ onLocalUpdate ignores the resulting doc event (no echo).
    Y.applyUpdate(this.ydoc, base64ToBytes(payload.d), this)
  }

  private onRemoteAwareness(payload: { d: string }): void {
    applyAwarenessUpdate(this.awareness, base64ToBytes(payload.d), this)
  }

  // ---- local → wire ----
  private onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return // remote-applied; already on the wire
    this.pending.push(update)
  }

  private flush = (): void => {
    if (!this.subscribed || this.pending.length === 0) return
    const merged = this.pending.length === 1 ? this.pending[0] : Y.mergeUpdates(this.pending)
    this.pending = []
    this.send('update', bytesToBase64(merged))
  }

  private onAwarenessUpdate = ({ added, updated, removed }: AwarenessChange, origin: unknown): void => {
    if (origin !== 'local') return // only OUR cursor/selection gets rebroadcast (remote applies carry `this`)
    for (const c of added) this.awarenessDirty.add(c)
    for (const c of updated) this.awarenessDirty.add(c)
    for (const c of removed) this.awarenessDirty.add(c)
    if (this.awarenessTimer === null) this.awarenessTimer = setTimeout(this.flushAwareness, AWARENESS_FLUSH_MS)
  }

  private flushAwareness = (): void => {
    this.awarenessTimer = null
    if (this.awarenessDirty.size === 0) return
    if (!this.subscribed) {
      this.awarenessTimer = setTimeout(this.flushAwareness, AWARENESS_FLUSH_MS) // re-arm until live
      return
    }
    const clients = [...this.awarenessDirty]
    this.awarenessDirty.clear()
    this.send('awareness', bytesToBase64(encodeAwarenessUpdate(this.awareness, clients)))
  }

  /** Flat text of the merged document — what the leader writes back to documents.content. */
  text(): string {
    return this.ytext.toString()
  }

  /** Leader-only: persist the canonical merged Yjs blob back to the DB (debounced + on teardown by useCollab). */
  async persist(): Promise<void> {
    if (this.destroyed) return
    const bytes = Y.encodeStateAsUpdate(this.ydoc)
    const { error } = await supabase
      .from('document_collab')
      .upsert(
        { document_id: this.docId, ydoc: bytesToPgHex(bytes), updated_at: new Date().toISOString() },
        { onConflict: 'document_id' },
      )
    if (error) console.warn('[collab] persist document_collab failed', error)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.flushTimer !== null) clearInterval(this.flushTimer)
    if (this.awarenessTimer !== null) clearTimeout(this.awarenessTimer)
    this.ydoc.off('update', this.onLocalUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    // Drop our caret and tell peers now, so they don't wait ~30s for the awareness timeout to expire it.
    removeAwarenessStates(this.awareness, [this.awareness.clientID], 'local')
    if (this.channel) {
      // Observers never published a caret (and can't broadcast anyway), so they have nothing to retract.
      if (this.subscribed && !this.readOnly) {
        void this.channel.send({
          type: 'broadcast',
          event: 'awareness',
          payload: { d: bytesToBase64(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])) },
        })
      }
      void supabase.removeChannel(this.channel)
      this.channel = null
    }
    this.awareness.destroy()
    this.ydoc.destroy()
  }
}
