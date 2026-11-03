import type { EffectDef } from '../variants/schema.js';
export interface PlayContext {
    direction: 1 | -1;
    skip: number;
    extraTurn: boolean;
    twoPlayer: boolean;
    targets: Array<number>;
}
export interface EffectHandler {
    apply(ctx: PlayContext, effect: EffectDef): void;
    prompt?: 'chooseNext' | 'steal';
}
export const EFFECTS: Record<EffectDef['type'], EffectHandler> = {
    reverse: { apply(ctx) {
        ctx.direction = ctx.direction === 1 ? -1 : 1;
        if (ctx.twoPlayer) ctx.extraTurn = true;
    } },
    skip: { apply(ctx, effect) {
        ctx.skip += effect.type === 'skip' ? effect.count ?? 1 : 1;
        if (ctx.twoPlayer) ctx.extraTurn = true;
    } },
    chooseNext: { apply() {}, prompt: 'chooseNext' },
    steal: { apply() {}, prompt: 'steal' }
};
