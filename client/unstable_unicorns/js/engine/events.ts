import type { CardEvent } from './dsl/ast.js';

export interface LoggedEvent extends CardEvent {
    seq: number;
}

export class EventLog {
    private next = 1;
    private queue: Array<LoggedEvent> = [];
    history: Array<LoggedEvent> = [];

    record(event: CardEvent): LoggedEvent {
        const logged: LoggedEvent = { ...event, seq: this.next++ };
        this.history.push(logged);
        return logged;
    }

    emit(event: CardEvent): LoggedEvent {
        const logged = this.record(event);
        this.queue.push(logged);
        return logged;
    }

    drain(): Array<LoggedEvent> {
        const queue = this.queue;
        this.queue = [];
        return queue;
    }

    peek(): Array<LoggedEvent> {
        return [...this.queue];
    }

    truncate(size: number): void {
        const lastSeq = this.history[size - 1]?.seq ?? 0;
        this.history.length = size;
        this.queue = this.queue.filter(event => event.seq <= lastSeq);
    }
}
