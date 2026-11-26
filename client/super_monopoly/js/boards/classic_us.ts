import type { BoardDefinition, Space } from '../types.js';

function street(id: string, name: string, groupId: string, price: number, buildingCost: number,
    rent: ReadonlyArray<number>): Space {
    return { id, name, type: 'street', deed: { groupId, price, mortgageValue: price / 2, buildingCost, rent } };
}

function service(id: string, name: string, type: 'railroad' | 'utility'): Space {
    const price = type === 'railroad' ? 200 : 150;
    const rent = type === 'railroad' ? [25, 50, 100, 200] : [4, 10];
    return { id, name, type, deed: { groupId: type, price, mortgageValue: price / 2, buildingCost: 0, rent } };
}

function draw(type: 'chance' | 'chest', index: number): Space {
    return {
        id: `${type}_${index}`, type, specialAuction: true,
        name: type === 'chance' ? 'Chance' : 'Community Chest'
    };
}

const board: BoardDefinition = {
    id: 'classic_us',
    name: 'Classic US',
    version: 1,
    currency: '$',
    startingBalance: 1500,
    goSalary: 200,
    dimensions: { width: 1200, height: 1200, cornerSize: 160, thickness: 12 },
    colors: {
        surface: '#c8e6da', brown: '#583880', ['light_blue']: '#aee4f6', pink: '#d83878', orange: '#f88820',
        red: '#c82038', yellow: '#f8d828', green: '#00a868', ['dark_blue']: '#0068b0', hell: '#b54242'
    },
    destinations: { go: 'go', gate: 'hell_gate' },
    decks: { chance: 'chance_us', chest: 'community_chest_us' },
    spaces: [
        { id: 'go', name: 'GO', type: 'go', specialAuction: true },
        street('mediterranean_avenue', 'K-Corp', 'brown', 60, 50, [2, 10, 30, 90, 160, 250]),
        draw('chest', 1),
        street('baltic_avenue', 'Riifucordia', 'brown', 60, 50, [4, 20, 60, 180, 320, 450]),
        { id: 'income_tax', name: 'Income Tax', type: 'tax', tax: 200 },
        service('reading_railroad', 'Riifu\'s Yacht', 'railroad'),
        street('oriental_avenue', 'Trinity General School', 'light_blue', 100, 50, [6, 30, 90, 270, 400, 550]),
        draw('chance', 1),
        street('vermont_avenue', 'Millennium Science School', 'light_blue', 100, 50, [6, 30, 90, 270, 400, 550]),
        street('connecticut_avenue', 'Abydos High School', 'light_blue', 120, 50, [8, 40, 100, 300, 450, 600]),
        { id: 'hell_gate', name: 'Hell Gate / Just Visiting', type: 'visiting' },
        street('st_charles_place', 'Cami\'s Cat Cafe', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
        service('electric_company', 'Tonitrus Spear', 'utility'),
        street('states_avenue', 'Richmila Mansion', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
        street('virginia_avenue', 'Everest', 'pink', 160, 100, [12, 60, 180, 500, 700, 900]),
        service('pennsylvania_railroad', 'Catmila\'s Yacht', 'railroad'),
        street('st_james_place', 'Sotoa', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
        draw('chest', 2),
        street('tennessee_avenue', 'Federation of Central Usea', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
        street('new_york_avenue', 'Erusea', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000]),
        { id: 'free_parking', name: 'Chudding Square', type: 'parking', specialAuction: true },
        street('kentucky_avenue', 'Soviet Union', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
        draw('chance', 2),
        street('indiana_avenue', 'East Germany', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
        street('illinois_avenue', 'North Korea', 'red', 240, 150, [20, 100, 300, 750, 925, 1100]),
        service('bo_railroad', 'Xeno\'s Yacht', 'railroad'),
        street('atlantic_avenue', 'Cat Correction Facility', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
        street('ventnor_avenue', 'Piss Square', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
        service('water_works', 'Arsenal Bird', 'utility'),
        street('marvin_gardens', 'The Backrooms', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200]),
        { id: 'go_to_hell', name: 'Go to Hell', type: 'detention' },
        street('pacific_avenue', 'NaoNao Avenue', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
        street('north_carolina_avenue', 'Gaki Aki Avenue', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
        draw('chest', 3),
        street('pennsylvania_avenue', 'Mini Avenue', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
        service('short_line', 'Appi\'s Yacht', 'railroad'),
        draw('chance', 3),
        street('park_place', 'K-chan Academy', 'dark_blue', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
        { id: 'luxury_tax', name: 'Luxury Tax', type: 'tax', tax: 100 },
        street('boardwalk', 'Leafsheep Cafe', 'dark_blue', 400, 200, [50, 200, 600, 1400, 1700, 2000])
    ],
    hell: {
        initialBail: 50, minBail: 20, reductionPerLap: 10, diceCount: 1,
        spaces: [
            { id: 'hell_entry', name: 'Hell Gate', type: 'visiting' },
            street('brimstone_estate', 'art chat 4', 'hell', 180, 100, [14, 70, 200, 550, 750, 950]),
            { id: 'torment', name: 'Sin of Greed', type: 'tax', tax: 10 },
            { id: 'purgatory', name: 'Purgatory', type: 'rest' },
            { id: 'ash_fields', name: 'Sin of Lust', type: 'rest' },
            street('the_abyss', 'Art Hell', 'hell', 200, 100, [16, 80, 220, 600, 800, 1000]),
            { id: 'limbo', name: 'Sin of Pride', type: 'rest' },
            { id: 'ember_path', name: 'Limbo', type: 'rest' }
        ]
    }
};

export default board;
