import type { ExecCtx, CustomHandler } from './exec/context.js';
import type { Iid } from './ids.js';
import { makeIdGen, nextIid } from './ids.js';
import type { IdGen } from './ids.js';
import { EventLog } from './events.js';
import type { LoggedEvent } from './events.js';
import type { Registry } from './registry.js';
import { seedFrom, shuffle } from './rng.js';
import type { Rng } from './rng.js';
import { createCard, emptyState } from './state.js';
import type { Binding, GameState, Zone } from './state.js';
import { PlayStack } from './stack.js';
import type { PendingEntry } from './stack.js';
import { restoreInto, snapshot } from './snapshot.js';
import type { Result, Table } from './play.js';
import { neigh, playCard } from './play.js';
import { afterAction, beginTurn, finishBeginTurn, discardCards, drawAction, endTurn, actionsLeft, drawsLeft } from './turn.js';
import { bulkMove, moveCard } from './move.js';
import { respond } from './exec/interpreter.js';
import { resolveLinks } from './chain.js';
import type { ViewModel } from './view.js';
import { viewFor, viewModel, visibleTo } from './view.js';
import { canPlay, playable, whyBlocked, effectlessPlay } from './legality.js';
import { blocksPlay } from './query/modifiers.js';
import { handLimit } from './query/modifiers.js';
import type { LegalityDeps } from './legality.js';
import { handVisible, inertStableCard, unicornCount } from './query/modifiers.js';
import { endByDeckOut } from './win.js';
import { winTarget } from '../vars.js';

export const OPENING_HAND = 5;

export type Action =
    | { type: 'PICK_BABY'; iid: Iid }
    | { type: 'BEGIN_TURN' }
    | { type: 'PLAY_CARD'; iid: Iid; target?: number }
    | { type: 'DRAW_ACTION' }
    | { type: 'END_TURN' }
    | { type: 'DISCARD'; iids: Array<Iid> }
    | { type: 'RESPOND'; promptId: number; selection: Binding }
    | { type: 'CANCEL_PROMPT'; promptId: number }
    | { type: 'NEIGH'; iid: Iid; targetEntryId: number };

export type DispatchResult = { ok: true } | { ok: false; error: string };

interface CancelSnapshot {
    actor: number;
    state: GameState;
    stack: Array<PendingEntry>;
    logLength: number;
    rng: number;
    source: Iid | null;
    nodeIds: Set<string>;
}

export interface EngineOptions {
    registry: Registry;
    playerCount: number;
    seed: string;
    customs?: Record<string, CustomHandler>;
}

function fail(error: string): DispatchResult {
    return { ok: false, error };
}

function settle(result: Result): DispatchResult {
    return result.error ? fail(result.error) : { ok: true };
}

function isIid(value: unknown): value is Iid {
    return typeof value === 'string' && value.length > 0;
}

export class Engine {
    state: GameState;
    stack: PlayStack;
    log: EventLog;
    rng: Rng;
    ids: IdGen;
    registry: Registry;
    prompts = { n: 0 };
    custom: Record<string, CustomHandler>;
    private cancellable: CancelSnapshot | null = null;

    constructor(options: EngineOptions) {
        this.registry = options.registry;
        this.rng = seedFrom(options.seed);
        this.ids = makeIdGen();
        this.log = new EventLog();
        this.custom = options.customs ?? {};
        this.stack = new PlayStack();
        this.state = emptyState(options.playerCount, winTarget(options.playerCount));
        this.state.phase = 'PICK_BABY';
        this.deal();
    }

    get ex(): ExecCtx {
        return {
            state: this.state,
            nodes: this.registry.nodes,
            log: this.log,
            rng: this.rng,
            defOf: iid => this.defOf(iid),
            prompts: this.prompts,
            custom: this.custom,
            queue: pending => {
                this.state.links.next.push(pending);
            },
            deckOut: () => this.deckOutEnd()
        };
    }

    private deckOutEnd(): void {
        const world = { state: this.state, defOf: (iid: Iid) => this.defOf(iid) };
        endByDeckOut(this.state, world, defId => this.registry.names[defId] ?? '', this.log);
        this.stack.clear();
    }

    get table(): Table {
        return { state: this.state, stack: this.stack, ex: this.ex };
    }

    get deps(): LegalityDeps {
        return { catalog: this.registry.byId, nodes: this.registry.nodes, custom: this.custom };
    }

    defOf(iid: Iid) {
        const card = this.state.cards[iid];
        return card ? this.registry.byId[card.defId] : undefined;
    }

    private add(defId: string, zone: Zone) {
        const iid = nextIid(this.ids);
        createCard(this.state, iid, defId, 0, zone);
        return iid;
    }

    private deal() {
        for (const defId of this.registry.deckList)
            if (this.registry.byId[defId].kind === 'baby') this.add(defId, 'nursery');

        const deck = shuffle(this.rng, this.registry.deckList.filter(id => this.registry.byId[id].kind !== 'baby'));
        for (const defId of deck) this.add(defId, 'deck');

        for (const player of this.state.players)
            for (let i = 0; i < OPENING_HAND; i++) {
                const iid = this.state.deck.pop();
                if (!iid) break;
                bulkMove(this.state, [iid], 'hand', player.id);
            }
    }

    view(seat: number): ViewModel {
        const world = { state: this.state, defOf: (iid: Iid) => this.defOf(iid) };
        const top = this.stack.top();
        const chain = {
            top: top ? { id: top.id, card: top.card, by: top.by, kind: top.kind,
                publicDefId: top.kind === 'play' ? this.defOf(top.card)?.id : undefined } : null,
            canNeigh: top !== null && top.by !== seat && !top.immune &&
                !blocksPlay(world, seat, 'instant')
        };

        const hand = this.state.players[seat].hand;
        const allSeats = this.state.players.map(player => player.id);
        const needsTarget: Array<Iid> = [];
        const targets: Record<Iid, Array<number>> = {};
        const inert: Record<Iid, Array<number>> = {};
        for (const iid of hand) {
            const def = this.defOf(iid);
            if (!def) continue;
            if (def.playTarget !== undefined || def.kind === 'upgrade' || def.kind === 'downgrade') {
                needsTarget.push(iid);
                const spec = def.playTarget ??
                    (def.kind === 'upgrade' || def.kind === 'downgrade' ? 'any' : 'self');
                if (spec === 'self') targets[iid] = [seat];
                else if (spec === 'other') targets[iid] = allSeats.filter(id => id !== seat);
                else targets[iid] = allSeats;
            }
            if (def.kind === 'upgrade' || def.kind === 'downgrade') {
                const seats: Array<number> = [];
                for (const player of this.state.players)
                    if (inertStableCard(world, player.id, def)) seats.push(player.id);
                if (seats.length > 0) inert[iid] = seats;
            }
        }

        const blockers: Record<Iid, string> = {};
        const futile: Record<Iid, boolean> = {};
        if (this.state.phase === 'ACTION' && this.state.turn.player === seat && this.state.prompt === null) {
            const view = viewFor(this.state, seat);
            const left = actionsLeft(this.table, seat);
            for (const iid of hand) {
                const reason = whyBlocked(this.deps, view, seat, iid, left);
                if (reason !== null) blockers[iid] = reason;
                else if (effectlessPlay(this.deps, view, seat, iid, left)) futile[iid] = true;
            }
        }

        const active = this.state.turn.player;
        const model = viewModel(this.state, seat, this.playable(seat), chain, needsTarget,
            owner => handVisible(world, owner), actionsLeft(this.table, active), drawsLeft(this.table, active),
            handLimit(world, seat),
            this.state.players.map(player => unicornCount(world, player.id)),
            iid => !!this.defOf(iid)?.instant?.neigh,
            blockers, targets, inert, futile);
        if (model.prompt) model.prompt.canCancel = this.canCancelPrompt(seat);
        return model;
    }

    playable(seat: number): Array<Iid> {
        if (this.state.prompt) return [];
        return playable(this.deps, viewFor(this.state, seat), seat, actionsLeft(this.table, seat));
    }

    canPlay(seat: number, iid: Iid): boolean {
        if (this.state.prompt) return false;
        return canPlay(this.deps, viewFor(this.state, seat), seat, iid, actionsLeft(this.table, seat));
    }

    eventsSince(seq: number): Array<LoggedEvent> {
        return this.log.history.filter(event => event.seq > seq);
    }

    private identityVisible(state: GameState, iid: Iid, seat: number): boolean {
        const card = state.cards[iid];
        if (!card) return false;
        const world = {
            state,
            defOf: (id: Iid) => this.registry.byId[state.cards[id]?.defId ?? '']
        };
        return visibleTo(state, iid, seat) ||
            (card.zone === 'hand' && handVisible(world, card.owner));
    }

    private canCancelPrompt(seat: number): boolean {
        const before = this.cancellable;
        if (!before || before.actor !== seat || this.state.prompt?.player !== seat) return false;
        for (const iid of Object.keys(this.state.cards)) {
            if (iid === before.source) continue;
            for (const player of this.state.players)
                if (!this.identityVisible(before.state, iid, player.id) &&
                    this.identityVisible(this.state, iid, player.id)) return false;
        }
        return true;
    }

    private promptingAction(seat: number, source: Iid | null, move: () => DispatchResult): DispatchResult {
        const before: CancelSnapshot = {
            actor: seat,
            state: snapshot(this.state),
            stack: structuredClone(this.stack.list()),
            logLength: this.log.history.length,
            rng: this.rng.s,
            source,
            nodeIds: new Set(Object.keys(this.registry.nodes))
        };
        const result = move();
        this.cancellable = result.ok && this.state.prompt?.player === seat ? before : null;
        return result;
    }

    private cancelPrompt(seat: number, promptId: number): DispatchResult {
        if (this.state.prompt?.id !== promptId || !this.canCancelPrompt(seat))
            return fail('That prompt cannot be canceled');
        const before = this.cancellable as CancelSnapshot;
        const exposed: Array<number> = [];
        if (before.source !== null)
            for (const player of this.state.players)
                if (this.identityVisible(this.state, before.source, player.id)) exposed.push(player.id);
        restoreInto(this.state, before.state);
        this.stack.restore(before.stack);
        this.log.truncate(before.logLength);
        this.rng.s = before.rng;
        for (const id of Object.keys(this.registry.nodes))
            if (!before.nodeIds.has(id)) delete this.registry.nodes[id];
        if (before.source !== null) {
            const card = this.state.cards[before.source];
            if (card) card.revealedTo = [...new Set([...card.revealedTo, ...exposed])];
        }
        this.cancellable = null;
        this.log.emit({ type: 'cancel', player: seat });
        return { ok: true };
    }

    dispatch(seat: number, action: unknown): DispatchResult {
        if (typeof seat !== 'number' || !this.state.players[seat]) return fail('No such seat');
        if (!action || typeof action !== 'object') return fail('Malformed action');
        const body = action as Record<string, unknown>;
        if (typeof body.type !== 'string') return fail('Malformed action');
        if (this.state.prompt && body.type !== 'RESPOND' && body.type !== 'NEIGH' &&
            body.type !== 'CANCEL_PROMPT')
            return fail('Wait for the open prompt to be answered');

        switch (body.type) {
            case 'PICK_BABY':
                if (!isIid(body.iid)) return fail('PICK_BABY needs iid');
                return this.pickBaby(seat, body.iid);
            case 'BEGIN_TURN':
                return this.promptingAction(seat, null, () => settle(beginTurn(this.table, seat)));
            case 'PLAY_CARD':
                if (!isIid(body.iid)) return fail('PLAY_CARD needs iid');
                if (body.target !== undefined && !Number.isInteger(body.target))
                    return fail('PLAY_CARD target must be a seat');
                return this.promptingAction(seat, body.iid, () => {
                    const result = playCard(this.table, seat, body.iid as Iid, body.target as number | undefined);
                    if (!result.error) afterAction(this.table);
                    return settle(result);
                });
            case 'DRAW_ACTION':
                return this.promptingAction(seat, null, () => settle(drawAction(this.table, seat)));
            case 'END_TURN':
                return this.promptingAction(seat, null, () => settle(endTurn(this.table, seat)));
            case 'DISCARD':
                if (!Array.isArray(body.iids) || !body.iids.every(isIid))
                    return fail('DISCARD needs iids');
                return this.promptingAction(seat, null, () =>
                    settle(discardCards(this.table, seat, body.iids as Array<Iid>)));
            case 'RESPOND': {
                if (typeof body.promptId !== 'number') return fail('RESPOND needs promptId');
                if (this.state.prompt?.id !== body.promptId) return fail('That prompt is out of date');
                if (this.state.prompt.player !== seat) return fail('That prompt belongs to another player');
                const selection = body.selection;
                const listed = Array.isArray(selection) &&
                    selection.every(item => isIid(item) || typeof item === 'number');
                if (!listed && typeof selection !== 'string' &&
                    typeof selection !== 'number' && typeof selection !== 'boolean')
                    return fail('RESPOND needs a selection');
                const answer = respond(this.ex, selection as Binding);
                if ('error' in answer) return fail(answer.error);
                resolveLinks(this.ex);
                if (this.state.phase === 'TURN_START' && this.state.prompt === null)
                    finishBeginTurn(this.table);
                if (this.cancellable && (this.cancellable.actor !== seat ||
                    this.state.prompt?.player !== seat)) this.cancellable = null;
                return { ok: true };
            }
            case 'CANCEL_PROMPT':
                if (typeof body.promptId !== 'number') return fail('CANCEL_PROMPT needs promptId');
                return this.cancelPrompt(seat, body.promptId);
            case 'NEIGH': {
                if (!isIid(body.iid)) return fail('NEIGH needs iid');
                if (typeof body.targetEntryId !== 'number') return fail('NEIGH needs targetEntryId');
                const result = settle(neigh(this.table, seat, body.iid, body.targetEntryId));
                if (result.ok) this.cancellable = null;
                return result;
            }
            default:
                return fail(`Unknown action ${String(body.type)}`);
        }
    }

    private pickBaby(seat: number, iid: Iid): DispatchResult {
        const state = this.state;
        if (state.phase !== 'PICK_BABY') return fail('Not picking babies');
        const player = state.players[seat];
        if (player.babyChosen) return fail('Baby already chosen');
        const card = state.cards[iid];
        if (!card || card.zone !== 'nursery') return fail('That baby is not in the nursery');
        if (this.registry.byId[card.defId].kind !== 'baby') return fail('That card is not a baby');

        const world = { state, defOf: (id: Iid) => this.defOf(id) };
        moveCard({ ...world, log: this.log, runReplacement: () => undefined },
            iid, { zone: 'stable', owner: seat }, 'enterStable');
        player.babyChosen = true;
        if (state.players.every(other => other.babyChosen)) state.phase = 'AWAIT_BEGIN';
        return { ok: true };
    }
}
