export function parseMs(text, fallback, report) {
    if (text === null) return fallback;
    const m = /^\s*(-?\d*\.?\d+)\s*(ms|s)?\s*$/.exec(text);
    if (!m) {
        report?.(`"${text.trim()}": expected a time such as 600, 600ms or 0.6s; using ${fallback}`);
        return fallback;
    }
    const n = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
    return Number.isFinite(n) ? n : fallback;
}
export function parseAfter(text, report) {
    if (!text?.trim()) return null;
    const m = /^\s*([\w-]+)\s*(?:([+-])\s*(\d*\.?\d+\s*(?:ms|s)?))?\s*$/.exec(text);
    if (!m) {
        report?.(`after="${text}": expected a name with an optional time offset, such as "title -400"`);
        return null;
    }
    const offset = m[3] ? parseMs(m[3], 0, report) * (m[2] === '-' ? -1 : 1) : 0;
    return {
        name: m[1],
        offset
    };
}
export function parseStagger(text, report) {
    if (text === null) return null;
    let each = 40;
    let from = 'first';
    for (const token of text.trim().split(/\s+/)){
        if (!token) continue;
        if (token === 'first' || token === 'last' || token === 'center') from = token;
        else each = Math.max(0, parseMs(token, each, report));
    }
    return {
        each,
        from
    };
}
export function parseAt(text, report) {
    if (!text) return null;
    let bad = false;
    const read = (token)=>{
        if (token === undefined || token === 'auto') return undefined;
        const m = /^(\d*\.?\d+)%$/.exec(token);
        if (!m) {
            bad = true;
            return undefined;
        }
        return Math.min(Math.max(Number(m[1]) / 100, 0), 1);
    };
    const [a, b] = text.trim().split(/\s+/);
    const start = read(a);
    const end = read(b);
    if (bad) {
        report?.(`at="${text.trim()}": expected percentages such as "20% 80%"; the whole \`at\` is ignored`, 'bad-at');
        return null;
    }
    const at = {};
    if (start !== undefined) at.start = start;
    if (end !== undefined) at.end = end;
    return at;
}
const constant = (c)=>[
        {
            f: 0,
            c,
            owner: -1
        }
    ];
const shift = (e, d)=>e.map((t)=>({
            f: t.f,
            c: t.c + d,
            owner: t.owner
        }));
const maximum = (...exprs)=>{
    const byFraction = new Map();
    for (const e of exprs){
        for (const t of e){
            const kept = byFraction.get(t.f);
            if (!kept || kept.c < t.c) byFraction.set(t.f, t);
        }
    }
    return [
        ...byFraction.values()
    ];
};
const valueAt = (e, total)=>e.reduce((m, t)=>{
        const v = t.f * total + t.c;
        return Number.isFinite(v) ? Math.max(m, v) : m;
    }, Number.NEGATIVE_INFINITY);
const nonNegative = (n)=>Number.isFinite(n) ? Math.max(0, n) : 0;
function staggerItems(spec) {
    const s = spec.stagger;
    if (!s || s.count < 1) return {
        tail: 0,
        items: null
    };
    const order = (k)=>s.from === 'last' ? s.count - 1 - k : s.from === 'center' ? Math.abs(k - (s.count - 1) / 2) : k;
    let last = 0;
    for(let k = 0; k < s.count; k++)last = Math.max(last, order(k));
    const tail = last * nonNegative(s.each);
    const item = Math.max(nonNegative(spec.duration), 1);
    const span = tail + item;
    const from = [];
    const to = [];
    for(let k = 0; k < s.count; k++){
        const begin = order(k) * nonNegative(s.each);
        from.push(begin / span);
        to.push((begin + item) / span);
    }
    return {
        tail,
        items: {
            from,
            to
        }
    };
}
export function solveScene(specs, options = {}) {
    const exitsOnTimeline = options.exitsOnTimeline ?? true;
    const errors = [];
    const n = specs.length;
    const byName = new Map();
    specs.forEach((s, i)=>{
        if (!s.name) return;
        if (byName.has(s.name)) {
            errors.push({
                code: 'duplicate-name',
                index: i,
                message: `Duplicate name "${s.name}" in scene`
            });
        } else byName.set(s.name, i);
    });
    const predecessor = new Array(n).fill(-1);
    const lead = new Array(n).fill(0);
    specs.forEach((s, i)=>{
        if (s.after) {
            const dep = byName.get(s.after.name);
            if (dep === undefined) {
                errors.push({
                    code: 'missing-after',
                    index: i,
                    message: `after="${s.after.name}" does not match a name in this scene`
                });
            } else {
                predecessor[i] = dep;
                lead[i] = Number.isFinite(s.after.offset) ? s.after.offset : 0;
            }
        } else if (options.sequence !== undefined && options.sequence !== null && i > 0) {
            predecessor[i] = i - 1;
            lead[i] = options.sequence;
        }
    });
    const state = new Array(n).fill(0);
    for(let i = 0; i < n; i++){
        const path = [];
        let j = i;
        while(j !== -1 && state[j] === 0){
            state[j] = 1;
            path.push(j);
            j = predecessor[j];
        }
        if (j !== -1 && state[j] === 1) {
            const cycle = path.slice(path.indexOf(j));
            for (const k of cycle){
                errors.push({
                    code: 'cycle',
                    index: k,
                    message: `Circular after dependency at "${specs[k].name ?? k}"`
                });
                predecessor[k] = -1;
            }
        }
        for (const k of path)state[k] = 2;
    }
    const stagger = specs.map(staggerItems);
    const invalidAt = new Set();
    let starts = [];
    let completions = [];
    let total = 0;
    for(;;){
        starts = new Array(n);
        completions = new Array(n);
        const extents = [];
        const resolve = (i)=>{
            const done = completions[i];
            if (done) return done;
            const spec = specs[i];
            const dep = predecessor[i];
            const base = dep === -1 ? constant(0) : shift(resolve(dep), lead[i]);
            const chainStart = maximum(shift(base, nonNegative(spec.delay)), constant(0));
            const length = Math.max(nonNegative(spec.duration), 1) + stagger[i].tail;
            const nominalEnd = shift(chainStart, length);
            const exit = exitsOnTimeline ? nonNegative(spec.exitDuration) : 0;
            extents.push(shift(nominalEnd, exit));
            let start = chainStart;
            let completion = nominalEnd;
            const at = invalidAt.has(i) ? null : spec.at;
            if (at && (at.start !== undefined || at.end !== undefined)) {
                if (at.start !== undefined) {
                    start = maximum([
                        {
                            f: at.start,
                            c: 0,
                            owner: i
                        }
                    ], dep === -1 ? [] : chainStart);
                }
                completion = maximum(at.end === undefined ? nominalEnd : [
                    {
                        f: at.end,
                        c: 0,
                        owner: i
                    }
                ], shift(start, 1));
                extents.push(shift(completion, exit > 0 ? 1 : 0));
            }
            starts[i] = start;
            completions[i] = completion;
            return completion;
        };
        for(let i = 0; i < n; i++)resolve(i);
        total = nonNegative(options.span ?? 0);
        const before = invalidAt.size;
        for (const e of extents){
            for (const t of e){
                const required = !Number.isFinite(t.f) ? Number.POSITIVE_INFINITY : t.f < 1 ? t.c / (1 - t.f) : t.c <= 0 ? 0 : Number.POSITIVE_INFINITY;
                if (Number.isFinite(required)) total = Math.max(total, required);
                else if (t.owner !== -1) invalidAt.add(t.owner);
            }
        }
        if (invalidAt.size === before) break;
    }
    for (const i of invalidAt){
        errors.push({
            code: 'unbounded-at',
            index: i,
            message: `at="${formatAt(specs[i].at)}" leaves no room for what follows; ignored`
        });
    }
    const byIndex = specs.map((spec, i)=>{
        const start = valueAt(starts[i], total);
        const end = valueAt(completions[i], total);
        const exitDuration = nonNegative(spec.exitDuration);
        const pinned = spec.at !== null && !invalidAt.has(i) && Number.isFinite(spec.at.start ?? 0) && Number.isFinite(spec.at.end ?? 1) && exitsOnTimeline;
        let exitStart = end;
        let exitEnd = end + exitDuration;
        if (exitDuration > 0 && pinned) {
            exitEnd = total;
            exitStart = Math.max(end, total - exitDuration);
        }
        return {
            start,
            end,
            exitStart,
            exitEnd: exitDuration > 0 ? exitEnd : end,
            exitDuration,
            items: stagger[i].items,
            predecessor: predecessor[i]
        };
    });
    let entranceEnd = 0;
    for (const s of byIndex)entranceEnd = Math.max(entranceEnd, s.end);
    if (!Number.isFinite(entranceEnd) || !Number.isFinite(total)) {
        let safe = 0;
        for (const s of byIndex)if (Number.isFinite(s.end)) safe = Math.max(safe, s.end);
        errors.push({
            code: 'bad-at',
            index: -1,
            message: 'scene time did not solve to a finite total; timing restarts from entrances'
        });
        return {
            entranceEnd: safe,
            total: safe,
            byIndex,
            errors
        };
    }
    return {
        entranceEnd,
        total: Math.max(total, entranceEnd),
        byIndex,
        errors
    };
}
function formatAt(at) {
    const pct = (v)=>v === undefined ? 'auto' : `${v * 100}%`;
    return at ? `${pct(at.start)} ${pct(at.end)}` : '';
}
