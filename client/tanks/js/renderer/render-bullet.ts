import { Bullet } from '../tanks/bullets/bullets.js';
import Camera from './camera.js';
import { getImage } from './img.js';

const BULLET_IMAGES: Record<string, HTMLCanvasElement | CanvasImageSource | null> = {};
const BULLET_IMAGE_PROCESSING: Record<string, boolean> = {};

export default function drawBullet(bullet: Bullet, camera: Camera, rotate = false) {
    if (typeof Image === 'undefined') return; // Server side, Image doesn't exist

    const imageUrl = bullet.imageUrl;
    const size = bullet.config.imageSize || bullet.collider.size;

    if (!BULLET_IMAGES[imageUrl]) {
        // Try to load and return for now
        // If already processing don't load again
        for (let imgUrl of bullet.config.imageUrls) {
            if (BULLET_IMAGE_PROCESSING[imgUrl])
                continue;
            (async () => {
                let image = await getImage(imgUrl, size.x, size.y);
                if (image === undefined) return;
                BULLET_IMAGES[imgUrl] = image;
            })();
            BULLET_IMAGE_PROCESSING[imgUrl] = true;
        }
        return;
    }

    const bulletCenter = bullet.getCenter();

    if (rotate)
        camera.drawImageRotated(BULLET_IMAGES[imageUrl], bulletCenter.x, bulletCenter.y, bullet.rotation);
    else
        camera.drawImage(BULLET_IMAGES[imageUrl],
            bulletCenter.x - size.x / 2,
            bulletCenter.y - size.y / 2);
}
