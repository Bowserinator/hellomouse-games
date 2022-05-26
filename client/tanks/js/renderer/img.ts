/**
 * Load image at path and scale to width + height
 * @param {string} path Path to img
 * @param {number} width Width in px
 * @param {number} height Height in px
 * @return {HTMLCanvasElement}
 */
export async function getImage(path: string, width: number, height: number) {
    let img = new Image();
    img.src = path;
    await img.decode();

    let canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    let ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
}
