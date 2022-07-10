import drawGrid from '../util/draw_grid.js';
import { BOARD_SIZE } from '../vars.js';
import { Board } from './board.js';
import { AbstractMarker } from './marker.js';

/**
 * Board that shows your hits on the enemy
 * @author Bowserinator
 */
export class MarkerBoard extends Board {
    markers: Array<AbstractMarker>;

    constructor(offset: [number, number], gridSize: number) {
        super(offset, gridSize);
        this.markers = [];
    }

    sync() {
        return this.markers.map(m => m.sync());
    }

    fromSync(data: any) {
        this.markers = data.map((m: [number, [number, number]]) => AbstractMarker.markerFromType(...m));
    }

    /** Reset board for new game */
    reset() {
        this.markers = [];
    }

    /**
     * Add a new marker, will override markers accordingly
     * @param marker Marker to add
     * @return Success? true if placed, false if a higher priority marker prevented placement
     */
    addMarker(marker: AbstractMarker) {
        if (marker.position[0] < 0 || marker.position[0] >= BOARD_SIZE ||
            marker.position[1] < 0 || marker.position[1] >= BOARD_SIZE)
            return;

        let canAdd = true;
        if (marker.overwrite) {
            let newMarkers = [];

            for (let m of this.markers)
                if (!m.overwrite)
                    // Can co-exist
                    newMarkers.push(m);
                else if (m.position[0] !== marker.position[0] || m.position[1] !== marker.position[1])
                    // Different position
                    newMarkers.push(m);
                else if (m.priority > marker.priority) {
                    // A higher priority marker in same spot, don't
                    // add this new marker
                    canAdd = false;
                    newMarkers.push(m);
                }
            this.markers = newMarkers;
        }
        if (canAdd)
            this.markers.push(marker);
        return canAdd;
    }

    draw(ctx: CanvasRenderingContext2D, drawBase = true) {
        if (drawBase)
            drawGrid(ctx, this.offset, this.gridSize);
        this.markers.forEach(marker => marker.draw(ctx, this.offset, this.gridSize));
    }
}
