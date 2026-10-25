interface PlayerPickerOptions {
    handCounts?: () => Array<number>;
    localSeat: number;
}

export function counterclockwiseSeats(seats: Array<number>, localSeat: number, count: number): Array<number> {
    return [...seats].sort((a, b) =>
        (localSeat - a + count) % count - (localSeat - b + count) % count);
}

export function playerPicker(
    seats: Array<number>,
    names: () => Array<string | null>,
    options: PlayerPickerOptions,
    includeCancel = true
): HTMLElement {
    const root = document.createElement('div');
    root.className = 'prompt-player-picker';
    const currentNames = names();
    const counts = options.handCounts?.() ?? [];
    for (const seat of counterclockwiseSeats(seats, options.localSeat, currentNames.length)) {
        const group = document.createElement('section');
        group.className = 'prompt-player-choice';
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.seat = String(seat);
        button.dataset.step = `player:${seat}`;
        const name = currentNames[seat] ?? `Seat ${seat + 1}`;
        button.textContent = `${name}\u00a0\u00a0(${counts[seat] ?? 0} in hand)`;
        group.append(button);
        root.append(group);
    }
    if (includeCancel) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.dataset.seat = 'cancel';
        cancel.className = 'prompt-cancel';
        root.append(cancel);
    }
    return root;
}
