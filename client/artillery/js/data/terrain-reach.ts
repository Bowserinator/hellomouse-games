import { WeaponDataFiles } from '../sim/weapon-types.js';

export function maximumTerrainReach(profiles: WeaponDataFiles['terrainProfiles']): number {
    return Math.max(0, ...Object.values(profiles).flatMap(profile => profile.operations.map(operation => {
        const radius = 'radiusInVoxels' in operation ? operation.radiusInVoxels ?? 0 : 0;
        const rays = 'rayLengthInVoxels' in operation ? operation.rayLengthInVoxels ?? 0 : 0;
        const irregularity = 'irregularityFraction' in operation ? operation.irregularityFraction ?? 0 : 0;
        const funnel = operation.operation === 'addFunnel'
            ? (operation.heightInVoxels ?? 0) + (operation.thicknessInVoxels ?? 0) : 0;
        return radius * (1 + irregularity) + rays + funnel;
    })));
}
