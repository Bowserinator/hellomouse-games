import { ArtilleryClient } from './client.js';
import { validateWeaponData } from './data/dsl-validator.js';
import { validateEffectProfiles } from './render/particle-emitter.js';
import { parseThemes } from './sim/world/themes.js';
import { ArtilleryUI } from './ui.js';

export async function loadGameData() {
    const names = ['weapons', 'models', 'turrets', 'terrain-profiles', 'damage-profiles', 'effect-profiles', 'themes'];
    const [weapons, models, turrets, terrainProfiles, damageProfiles, effectInput, themeInput] = await Promise.all(
        names.map(async name => {
            const response = await fetch(new URL(`../data/${name}.json`, import.meta.url).href);
            if (!response.ok) throw new Error(`Could not load ${name}: ${response.status}`);
            return await response.json() as unknown;
        }));
    validateEffectProfiles(effectInput);
    const effects = effectInput;
    const data = validateWeaponData({ weapons, models, turrets, terrainProfiles, damageProfiles },
        Object.keys(effects));
    return { data, effects, themes: parseThemes(themeInput) };
}

if (typeof document !== 'undefined') {
    let client: ArtilleryClient | null = null;
    const view = new ArtilleryUI(action => client?.action(action));
    view.setMode('loading');
    view.loading(0, 0, 'Loading game rules');
    void loadGameData().then(({ data, effects, themes }) => {
        view.setMode('lobby'); view.notice('');
        client = new ArtilleryClient(view, data, effects, themes);
    }).catch(error => {
        view.notice('Could not load game data. Reload to retry.');
        console.error('Artillery data loading failed', error);
    });
}
