/** Builds the image used wherever a company is shown. */
import type { CompanyTheme } from './types.js';

export function companyIcon(theme: CompanyTheme): HTMLImageElement {
    const image = document.createElement('img');
    image.className = 'company-icon';
    image.src = theme.icon;
    image.alt = '';
    image.style.background = theme.primary;
    return image;
}
