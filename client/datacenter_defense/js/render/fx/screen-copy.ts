import type * as T from 'three';

export class ScreenCopy {
    // RGB, not RGBA: the default framebuffer (WebGLRenderer alpha:false) has no alpha channel, and
    // copyTexImage2D from an RGB framebuffer into an RGBA texture is GL_INVALID_OPERATION.
    readonly texture = new THREE.DataTexture(new Uint8Array(3), 1, 1, THREE.RGBFormat);
    readonly size = new THREE.Vector2();
    private origin = new THREE.Vector2();
    constructor() {
        this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = false; this.texture.flipY = false;
        this.texture.needsUpdate = true;
    }
    capture(renderer: T.WebGLRenderer) {
        renderer.getDrawingBufferSize(this.size);
        if (this.texture.image.width !== this.size.x || this.texture.image.height !== this.size.y) {
            this.texture.dispose();
            // Allocate GPU storage without a second screen-sized CPU pixel buffer.
            Object.assign(this.texture.image, { width: this.size.x, height: this.size.y, data: null });
            this.texture.needsUpdate = true;
        }
        renderer.copyFramebufferToTexture(this.origin, this.texture);
    }
    destroy() {
        this.texture.dispose();
    }
}
