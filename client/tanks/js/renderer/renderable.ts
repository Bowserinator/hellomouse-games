import { getImage } from './img.js';
import Vector from '../tanks/vector2d.js';

const GLOBAL_IMAGE_STORE: Record<string, HTMLCanvasElement> = {};

/**
 * A renderable object that uses image sprites
 * This class handles preloading images
 * @author Bowserinator
 */
export default class Renderable {
    imageUrls: Array<[string, Vector]>;
    images: Record<string, HTMLCanvasElement>; // Reference to GLOBAL_IMAGE_STORE
    allLoaded: boolean;

    /**
     * Construct a Renderable
     * @param imageUrls Images + sizes
     */
    constructor(imageUrls: Array<[string, Vector]>) {
        if (typeof Image === 'undefined') return; // Server side, Image doesn't exist
        this.imageUrls = imageUrls;
        this.images = GLOBAL_IMAGE_STORE;
        this.allLoaded = false;
        this.loadImages();
    }

    /**
     * Checks if all images are loaded
     * @returns {boolean} Are all images loaded?
     */
    isLoaded() {
        if (this.allLoaded) return true;
        let loaded = this.imageUrls.every(url => this.images[url[0]]);
        this.allLoaded = loaded;
        return loaded;
    }

    /**
     * Loads images. Recommended to only call once.
     */
    async loadImages() {
        for (let img of this.imageUrls) {
            let [url, size] = img;
            if (GLOBAL_IMAGE_STORE[url])
                continue;

            // eslint-disable-next-line @typescript-eslint/no-this-alias
            let render = this;

            (async () => {
                let image = await getImage(url, size.x, size.y);
                if (image === undefined) return;
                render.images[url] = image;
            })();
        }
    }
}
