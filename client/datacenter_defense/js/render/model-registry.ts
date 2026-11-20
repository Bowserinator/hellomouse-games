export interface ModelSpec {
    url: string;
    scale: number;
    yaw: number;
    height: number;
    halfWidth: number;
    halfDepth: number;
    spin?: Record<string, number>;
}
export const MODELS = new Map<string, ModelSpec>([
    ['MG nest', { url: 'mg-nest.glb', scale: 1 / 16, yaw: 0, height: 1.4, halfWidth: 0.9, halfDepth: 0.9 }],
    ['Heli gunship', { url: 'heli-gunship.glb', scale: 1 / 16, yaw: 0, height: 1.7, halfWidth: 2.8, halfDepth: 1.8 }]
]);
