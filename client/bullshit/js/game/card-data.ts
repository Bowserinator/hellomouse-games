export const GET_SYMBOL = (x: number | string): string => {
    x = +x;
    if (x === 1) return 'A';
    if (x === 11) return 'J';
    if (x === 12) return 'Q';
    if (x === 13) return 'K';
    return x + '';
};

export const RED_SUITS = ['Hearts', 'Diamonds'];

export const SUIT_SYMBOL_MAP: Record<string, string> = {
    'Clubs': '♣',
    'Diamonds': '♦',
    'Hearts': '♥',
    'Spades': '♠'
};

/* Patterns from https://medium.com/@pakastin/javascript-playing-cards-part-2-graphics-cd65d331ad00 */
export const SUIT_POSITIONS: Array<Array<[number, number, boolean?]>> = [
    [
        [0, 0]
    ],
    [
        [0, -1],
        [0, 1, true]
    ],
    [
        [0, -1],
        [0, 0],
        [0, 1, true]
    ],
    [
        [-1, -1], [1, -1],
        [-1, 1, true], [1, 1, true]
    ],
    [
        [-1, -1], [1, -1],
        [0, 0],
        [-1, 1, true], [1, 1, true]
    ],
    [
        [-1, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1, true], [1, 1, true]
    ],
    [
        [-1, -1], [1, -1],
        [0, -0.5],
        [-1, 0], [1, 0],
        [-1, 1, true], [1, 1, true]
    ],
    [
        [-1, -1], [1, -1],
        [0, -0.5],
        [-1, 0], [1, 0],
        [0, 0.5, true],
        [-1, 1, true], [1, 1, true]
    ],
    [
        [-1, -1], [1, -1],
        [-1, -1 / 3], [1, -1 / 3],
        [0, 0],
        [-1, 1 / 3, true], [1, 1 / 3, true],
        [-1, 1, true], [1, 1, true]
    ],
    [
        [-1, -1], [1, -1],
        [0, -2 / 3],
        [-1, -1 / 3], [1, -1 / 3],
        [-1, 1 / 3, true], [1, 1 / 3, true],
        [0, 2 / 3, true],
        [-1, 1, true], [1, 1, true]
    ],
    [
        [0, 0]
    ],
    [
        [0, 0]
    ],
    [
        [0, 0]
    ]
];
