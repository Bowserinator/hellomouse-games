import type { World } from '../mapx.js';

export async function mapPreview(world: World): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    const scale = 512 / Math.max(world.width, world.depth);
    canvas.width = Math.max(1, Math.round(world.width * scale));
    canvas.height = Math.max(1, Math.round(world.depth * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Map preview canvas is unavailable');
    context.scale(scale, scale);
    context.fillStyle = '#b9c8a6';
    context.fillRect(0, 0, world.width, world.depth);
    for (const object of world.objects) {
        context.beginPath();
        if (object.polygon.length) {
            object.polygon.forEach((p, i) => {
                if (i) context.lineTo(p.x, p.z); else context.moveTo(p.x, p.z);
            });
            context.closePath();
        } else context.arc(object.x, object.z, object.kind === 'prop' ? 4 * object.scale : Math.max(4, object.radius), 0, Math.PI * 2);
        context.fillStyle = object.kind === 'spawn' ? '#d43b3b' : object.kind === 'objective' ? '#716282'
            : object.kind === 'building' ? '#cdcdc7' : object.type === 'water' ? '#96becd' : '#6b8d59';
        context.fill();
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
        if (value) resolve(value); else reject(Error('Could not create map preview'));
    }, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}
