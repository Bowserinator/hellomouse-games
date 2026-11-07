declare function createConnection(): WebSocket;

export interface GameConnectionOptions {
    gameType: string;
    onMessage: (message: Record<string, unknown>) => void;
    onOpen?: () => void;
    onClose?: () => void;
    pingIntervalInMilliseconds: number;
    pingLabel?: HTMLElement;
    disconnectBanner?: HTMLElement;
}

export interface GameConnection {
    socket: WebSocket;
    send: (message: Record<string, unknown>) => boolean;
    dispose: () => void;
}

export function connectToGame(options: GameConnectionOptions): GameConnection {
    const socket = createConnection();
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    const send = (message: Record<string, unknown>): boolean => {
        if (socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(message));
        return true;
    };
    socket.onopen = () => {
        const gameIdentifier = location.search.slice(1).split('=')[0];
        send(gameIdentifier ? { type: 'JOIN', gameID: gameIdentifier } : { type: 'CREATE', gameType: options.gameType });
        pingTimer = setInterval(() => send({ type: 'PING', ping: Date.now() }), options.pingIntervalInMilliseconds);
        options.onOpen?.();
    };
    socket.onmessage = event => {
        let message: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(String(event.data));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
            message = parsed as Record<string, unknown>;
        } catch {
            return;
        }
        if (message.type === 'UUID' && typeof message.uuid === 'string')
            history.pushState(null, '', `?${encodeURIComponent(message.uuid)}`);
        if (message.type === 'ERROR' && message.code === 'NO_GAME') {
            location.replace(location.pathname);
            return;
        }
        if (message.type === 'PING' && typeof message.ping === 'number' && options.pingLabel)
            options.pingLabel.textContent = `${Math.max(0, Date.now() - message.ping)} ms`;
        options.onMessage(message);
    };
    socket.onclose = () => {
        clearInterval(pingTimer);
        if (options.disconnectBanner) {
            options.disconnectBanner.hidden = false;
            options.disconnectBanner.textContent = 'Disconnected from server';
            options.disconnectBanner.style.top = '0';
        }
        options.onClose?.();
    };
    return {
        socket, send,
        dispose: () => {
            clearInterval(pingTimer);
            socket.onopen = socket.onmessage = socket.onclose = null;
            socket.close();
        }
    };
}
