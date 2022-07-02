

class AbstractMarker {
    position: [number, number];
    priority: number;
    color: string;

    constructor(color: string, position: [number, number], priority: number) {
        this.color = color;
        this.position = position;
        this.priority = priority;
    }

    draw() {}
}

export class HitMarker extends AbstractMarker {

}

export class MissMarker extends AbstractMarker {

}

export class NumberMarker extends AbstractMarker {

}

export class ShotDownmarker extends AbstractMarker {

}
