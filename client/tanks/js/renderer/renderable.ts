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
    allLoaded: Record<string, boolean>;

    /**
     * Construct a Renderable
     * @param imageUrls Images + sizes
     */
    constructor(imageUrls: Array<[string, Vector]>) {
        if (typeof Image === 'undefined') return; // Server side, Image doesn't exist
        this.imageUrls = imageUrls;
        this.images = GLOBAL_IMAGE_STORE;
        // eslint-disable-next-line @typescript-eslint/naming-convention
        this.allLoaded = { '': false };
        this.loadImages();
    }

    /**
     * Checks if all images are loaded
     * @param {string} prefix Prefix for urls
     * @returns {boolean} Are all images loaded?
     */
    isLoaded(prefix = '') {
        if (this.allLoaded[prefix]) return true;
        let loaded = this.imageUrls.every(url => this.images[prefix + url[0]]);
        this.allLoaded[prefix] = loaded;
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


    // -------------------------
    // Image tinting
    // @see https://web.archive.org/web/20171014203801/http://www.playmycode.com/blog/2011/06/realtime-image-tinting-on-html5-canvas/
    // -------------------------

    /**
     * Generate a tinted variant of this renderable
     * @param tint RGB for int
     */
    loadTintVariants(tint: [number, number, number]) {
        for (let img of this.imageUrls) {
            let [url, size] = img;
            let key = Renderable.rgbToStr(tint) + url;
            if (GLOBAL_IMAGE_STORE[key])
                continue;

            // eslint-disable-next-line @typescript-eslint/no-this-alias
            let render = this;
            (async () => {
                let image = await getImage(url, size.x, size.y);
                if (image === undefined) return;
                const rgbks = Renderable._generateRGBKs(image);
                const tintImg = Renderable._generateTintImage(image, rgbks, tint);
                if (!tintImg) return;
                render.images[key] = tintImg;
            })();
        }
    }

    /**
     * Split an image into RGB components + black
     * @param {HTMLCanvasElement} img Image to parse
     * @returns Array of each layer (R,G,B,black)
     */
    static _generateRGBKs(img: HTMLCanvasElement) {
        const [w, h] = [img.width, img.height];
        let rgbks: Array<HTMLCanvasElement> = [];

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        if (!ctx) return [];
        ctx.drawImage(img, 0, 0);

        let pixels = ctx.getImageData(0, 0, w, h).data;

        // 4 is used to ask for 3 images: red, green, blue and
        // black in that order.
        for (let rgbI = 0; rgbI < 4; rgbI++) {
            /* eslint-disable @typescript-eslint/no-shadow */
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;

            const ctx = canvas.getContext('2d');
            if (!ctx) return [];
            ctx.drawImage(img, 0, 0);
            let to = ctx.getImageData(0, 0, w, h);
            let toData = to.data;

            for (let i = 0; i < pixels.length; i += 4) {
                toData[i] = (rgbI === 0) ? pixels[i] : 0;
                toData[i + 1] = (rgbI === 1) ? pixels[i + 1] : 0;
                toData[i + 2] = (rgbI === 2) ? pixels[i + 2] : 0;
                toData[i + 3] = pixels[i + 3];
            }

            ctx.putImageData(to, 0, 0);
            rgbks.push(canvas);
            /* eslint-enable @typescript-eslint/no-shadow */
        }

        return rgbks;
    }

    /**
     * Tint an image
     * @param img Base image
     * @param rgbks Seperated RGB + black components
     * @param tint RGB color to tint
     * @returns Tinted image
     */
    static _generateTintImage(img: HTMLCanvasElement, rgbks: Array<HTMLCanvasElement>, tint: [number, number, number]) {
        if (!rgbks.length) return;
        const [red, green, blue] = tint;
        const buff = document.createElement('canvas');
        buff.width = img.width;
        buff.height = img.height;

        let ctx = buff.getContext('2d');
        if (!ctx) return;

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(rgbks[3], 0, 0);

        ctx.globalCompositeOperation = 'lighter';
        if (red > 0) {
            ctx.globalAlpha = red / 255.0;
            ctx.drawImage(rgbks[0], 0, 0);
        }
        if (green > 0) {
            ctx.globalAlpha = green / 255.0;
            ctx.drawImage(rgbks[1], 0, 0);
        }
        if (blue > 0) {
            ctx.globalAlpha = blue / 255.0;
            ctx.drawImage(rgbks[2], 0, 0);
        }

        return buff;
    }

    /**
     * Convert to css friendly rgb color
     * @param rgb RGB array
     * @returns String
     */
    static rgbToStr(rgb: [number, number, number]) {
        return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
}
