import { catalogFor, packNames } from './catalog/index.js';
import { cardFace } from './ui/card.js';

const gallery = document.getElementById('gallery');
if (!gallery) throw new Error('Gallery element is missing');

for (const pack of packNames()) {
    const heading = document.createElement('h2');
    heading.className = 'gallery-pack-title';
    heading.textContent = pack;
    gallery.append(heading);
    for (const entry of catalogFor([pack]))
        for (let copy = 0; copy < entry.copies; copy++) gallery.append(cardFace(entry.id));
}
