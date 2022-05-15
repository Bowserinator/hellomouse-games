enum Powerup {
    NONE, MISSILE, LASER, SHOTGUN, BOMB
}

export class Tank {
    constructor(pos, rotation) {
        this.position = pos;
        this.rotation = rotation;
        this.ammo = 2;
        this.lastFired = 0; // UNIX timestamp last fired a bullet
        this.powerup = Powerup.NONE;
    }

    createCollider() {
        let [x, y] = this.position.l();
        x -= 25;
        y -= 25;
        this.collider = new Collider(new Vector(x, y), new Vector(50, 50)); // TODO
    }

    draw(ctx) {
        drawCenteredSquare(this.position.x, this.position.y, 50, 'red');

        this.collider.draw(ctx);
    }

    update() {
        this.position.x += this.velocity.x;
        this.position.y += this.velocity.y;
        this.createCollider();

        for (let wall of gameState.walls)
            if (wall.collider.collidesWith(this.collider)) {
                this.position = this.collider.getSnapPosition(wall.collider)[0];
                this.position.x += 25;
                this.position.y += 25;
                this.velocity = new Vector(0, 0);
                this.createCollider();
            }
    }
}
