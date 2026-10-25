import type { CardEvent } from './dsl/ast.js';

export interface LoggedEvent extends CardEvent {
    seq: number;
}

export class EventLog {
    private next = 1;
    private queue: Array<LoggedEvent> = [];
    history: Array<LoggedEvent> = [];

    emit(event: CardEvent): LoggedEvent {
        const logged: LoggedEvent = { ...event, seq: this.next++ };
        this.history.push(logged);
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
}
