import { Bullet } from './bullets.js';
import Vector from './vector2d.js';
import Wall from './wall.js';
import Tank from './tank.js';


export default class GameState {
    enemyTanks: Array<Tank>;
    playerTank: Tank;
    walls: Array<Wall>;
    bullets: Array<Bullet>;

    constructor() {
        this.enemyTanks = [];
        this.playerTank = new Tank(new Vector(20, 20), 1);
        this.walls = [];
        this.bullets = [];
    }

    syncFromMessage(message) {
        // TODO use enums
        if (message.action === 'MAP') {
            // Update map from scratch
            this.walls = [];
        }
        else if (message.action === 'POS') {
            // Positions of tanks
        }
        else if (message.action === 'CB') {
            // Create new bullet
        }
        else if (message.action === 'DB') {
            // Destroy existing bullet
        }
    }
}
