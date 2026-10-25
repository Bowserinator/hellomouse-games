export type Iid = string;

export interface IdGen {
    n: number;
}

export function makeIdGen(): IdGen {
    return { n: 0 };
}

export function nextIid(ids: IdGen): Iid {
    ids.n += 1;
    return `c${ids.n}`;
}

export function hiddenIid(n: number): Iid {
    return `h${n}`;
}
