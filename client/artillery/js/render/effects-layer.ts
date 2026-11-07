import type * as T from 'three';

/** Render layer for transparent effects, which are composited over the water instead of through it. */
export const transparentEffectsLayer = 1;

/** Additive blending that adds colour without contributing coverage to the effects layer's alpha. */
export function additiveEffectBlending(): Pick<T.MaterialParameters,
    'blending' | 'blendEquation' | 'blendSrc' | 'blendDst' | 'blendSrcAlpha' | 'blendDstAlpha'> {
    return { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
}
