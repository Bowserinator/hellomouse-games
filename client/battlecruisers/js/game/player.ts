import { ROTATION } from '../types.js';
import { ShipBoard } from './ship_board.js';
import { AbstractShip, AegisShip, BattlecruiserShip, CarrierShip, CounterIntelShip, CruiserShip, DestroyerShip, MineShip, MissileSubmarineShip, SubmarineShip } from './ship.js';
import { MarkerBoard } from './marker_board.js';

export default class Player {
    shipBoard: ShipBoard;
    markerBoard: MarkerBoard;
    ships: Array<AbstractShip>; // Ships to place down

    /** Construct a new player */
    constructor() {
        this.shipBoard = new ShipBoard([50, 50], 25);
        this.markerBoard = new MarkerBoard([50, 50], 25);
        this.reset();
    }

    /** Reset a player for new game */
    reset() {
        this.markerBoard.reset();
        this.shipBoard.reset();
        this.createStartingShips();
    }

    /** Set this.ships to all starting ships */
    createStartingShips() {
        const carrier = () => new CarrierShip([0, 0], ROTATION.R0);
        const bc = () => new BattlecruiserShip([0, 0], ROTATION.R0);
        const cruiser = () => new CruiserShip([0, 0], ROTATION.R0);
        const nsub = () => new MissileSubmarineShip([0, 0], ROTATION.R0);
        const aegis = () => new AegisShip([0, 0], ROTATION.R0);
        const stealth = () => new CounterIntelShip([0, 0], ROTATION.R0);
        const dst = () => new DestroyerShip([0, 0], ROTATION.R0);
        const sub = () => new SubmarineShip([0, 0], ROTATION.R0);
        const mine = () => new MineShip([0, 0], ROTATION.R0);

        this.ships = [
            carrier(),                             // 1x carrier
            bc(), bc(),                            // 2x battleciser
            cruiser(), cruiser(), cruiser(),       // 3x cruiser
            nsub(), aegis(), aegis(), stealth(),   // 1x nuke sub, 2x aegis, 1x counterintel
            dst(), dst(), dst(), dst(), dst(),     // 5x destroyer
            sub(), sub(), sub(), sub(), sub(),     // 5x sub
            mine(), mine(), mine(), mine(), mine() // 5x mines
        ];
    }
}
