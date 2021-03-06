// Game timings + lag comp

// If tick length is too high tank collision becomes buggy
// Recommended: 30 ms or below
export const UPDATE_EVERY_N_MS = 30; // Game tick length
export const SYNC_BULLETS_EVERY_N_TIMES = 10; // How many iterations to sync bullets

// Max latency (one way, ping = 2x this value) to lag compensate. Essentially
// gives a player free roam within this region of time
export const MAX_LATENCY_COMP_MS = 250;

// Avoid microstutters: don't change location until it differs by at least this amount:
export const SYNC_DISTANCE_THRESHOLD = 6;

// Smoothing rate for lerping server location. Too low makes the arena feel frictionless,
// too high feels too jumpy
export const POS_SMOOTHING_RATE = 0.6;

// Beyond this error don't smoothly move the tank
export const MAX_LERP_DISTANCE_THRESHOLD = 200;

// Transition graphics
export const TRANSITION_DURATION = 150;
export const TRANSITION_RECTS = 5; // How many rectangles to draw

// Game
export const MAX_PLAYERS = 8;
export const MAX_POWERUP_ITEMS = 20;
export const DELAY_POWERUP_SPAWN = 10000; // How often (ms) to spawn a powerup
export const POWERUPS_TO_SPAWN_AT_ONCE = 2;
export const CONTROL_KEYS = ['w', 'a', 's', 'd']; // Up, left, down, right (all lowercase)

export const ROUND_ARRAY = [5, 10, 15, 20]; // Round selection, make sure matches HTML!
export const DELAY_AFTER_WIN_ROUND = 3000; // Delay in ms after a player wins a round to go to next round
export const PRE_ROUND_DELAY = 1000; // Delay to prevent inputs before a round starts
export const SPECTATE_DELAY = 1500; // Delay after dying before spectating

// Keyboard rotation rates (rad / 50ms)
export const ROTATE_FAST = 0.2;
export const ROTATE_SLOW = 0.1;

// Tanks
export const TANK_SIZE = 50; // Visual + collision
export const TANK_TURRET_SIZE = 96; // Only visual
export const TANK_BASE_ROTATION_RATE = 10; // Rad/s, visual only
export const TANK_TURRET_ROTATION_RATE = 10; // Rad/s, visual only

export const TANK_SPEED = 200;
export const TANK_FIRE_DELAY = 200;

// Maze generation
export const CELL_SIZE = 130;
export const WALL_THICKNESS = 10;
export const MIN_MAZE_SIZE = 5;
export const MAX_MAZE_SIZE = 12;

// Graphics
export const WALL_COLOR = '#333';
export const CAMERA_EDGE_MARGIN = 100;

export const SHADOW_COLOR = '#ddd';
export const SHADOW_SIZE_X = 10;
export const SHADOW_SIZE_Y = 10;
export const POWERUP_ITEM_SIZE = 36;

export const TANK_COLORS: Array<[number, number, number]> = [
    '#009688', // Teal
    '#43a047', // Green
    '#9ccc65', // Green 2
    '#c0ca33', // Lime
    '#f44336', // Red
    '#f57f17', // Orange
    '#ffeb3b', // Yellow
    '#42a5f5', // Blue
    '#ba68c8', // Violet
    '#9c27b0', // Purple
    '#546e7a', // Gray
    '#ff4081'  // Pink
].map(color => {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
    if (!result) throw new Error('Invalid color: ' + color);
    return [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ];
});
export const TANK_TEXT_COLORS: Array<string> = [
    'white', 'white', 'black',
    'black', 'white', 'white',
    'black', 'black', 'white',
    'white', 'white', 'white'];
