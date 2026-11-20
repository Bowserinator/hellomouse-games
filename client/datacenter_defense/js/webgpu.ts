type CompatibilityDialog = HTMLDialogElement & { showModal(): void; close(): void };
let checking: Promise<boolean> | undefined;

export function checkWebGPU(): Promise<boolean> {
    if (checking) return checking;
    checking = (async () => {
        let reason = '';
        if (!window.isSecureContext) reason = 'WebGPU requires HTTPS or localhost. Open this page over a secure connection.';
        else if (!navigator.gpu) reason = 'This browser does not expose WebGPU. Your browser, operating system, graphics driver, or browser settings may not support it.';
        else
            try {
                if (!await navigator.gpu.requestAdapter()) reason = 'No WebGPU adapter is available. Check hardware acceleration and update your graphics driver.';
            } catch {
                reason = 'The browser could not initialize WebGPU. Check hardware acceleration and update your graphics driver.';
            }

        const firefox = /Firefox\//.test(navigator.userAgent);
        if (!reason && !firefox) return true;
        const dialog = document.createElement('dialog') as CompatibilityDialog;
        dialog.className = 'webgpu-dialog';
        const heading = document.createElement('h2'), message = document.createElement('p');
        heading.textContent = reason ? 'WebGPU unavailable' : 'Firefox WebGPU';
        heading.id = 'webgpu-heading'; dialog.setAttribute('aria-labelledby', heading.id);
        message.textContent = reason || 'WebGPU is available in this browser.';
        const support = document.createElement('p'), browser = document.createElement('p');
        support.textContent = 'Ensure your browser supports WebGPU and is up to date.';
        browser.textContent = `Browser and version: ${navigator.userAgent}`;
        dialog.append(heading, message, support, browser);
        if (firefox) {
            const help = document.createElement('p');
            help.textContent = 'In Firefox, open about:config, set dom.webgpu.enabled to true, then restart Firefox. Availability still depends on your operating system and GPU. As of November 2026, WebGPU in Firefox may be buggy and slower than Chrome. Try an up-to-date Chrome if the simulation fails or runs slowly.';
            dialog.append(help);
        }
        const close = document.createElement('button');
        close.type = 'button'; close.textContent = 'Close'; close.onclick = () => dialog.close();
        dialog.append(close); document.body.append(dialog);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.showModal();
        return !reason;
    })();
    return checking;
}
