import { easeInOut, parseEase } from './ease.js';
import { parseFx, parseItem, splitTop, withoutKeyframes } from './fx.js';
import { applyTrack, combine, frameCss, IDENTITY, identityFrame, NO_CLIP, parseDeclarations, parseVarValue, resetFrame, varsCss, varValue } from './props.js';
const level = (arg, values, report, name)=>{
    if (arg === undefined || arg === '') return values[1];
    if (arg === 'soft') return values[0];
    if (arg === 'strong') return values[2];
    const n = Number.parseFloat(arg);
    if (Number.isFinite(n)) return n;
    report(`${name}(${arg}): expected soft, strong or a number`);
    return values[1];
};
const LOOPS = {
    float: (args, report)=>{
        const a = level(args[0], [
            4,
            8,
            16
        ], report, 'float');
        return {
            props: {
                y: [
                    0,
                    -a,
                    0
                ]
            },
            custom: {},
            duration: 4000
        };
    },
    sway: (args, report)=>{
        const a = level(args[0], [
            1.5,
            3,
            6
        ], report, 'sway');
        return {
            props: {
                rotate: [
                    0,
                    a,
                    0,
                    -a,
                    0
                ]
            },
            custom: {},
            duration: 5000
        };
    },
    pulse: (args, report)=>{
        const a = level(args[0], [
            0.02,
            0.04,
            0.08
        ], report, 'pulse');
        return {
            props: {
                scale: [
                    1,
                    1 + a,
                    1
                ]
            },
            custom: {},
            duration: 2000
        };
    },
    breathe: (args, report)=>{
        const a = level(args[0], [
            0.2,
            0.4,
            0.6
        ], report, 'breathe');
        return {
            props: {
                opacity: [
                    1,
                    1 - a,
                    1
                ]
            },
            custom: {},
            duration: 3000
        };
    },
    spin: (args)=>{
        const turn = args[0] === 'left' || args[0] === 'ccw' ? -360 : 360;
        return {
            props: {
                rotate: [
                    0,
                    turn
                ]
            },
            custom: {},
            duration: 8000,
            easing: 'linear'
        };
    }
};
export const loopNames = ()=>Object.keys(LOOPS);
function words(text) {
    const out = [];
    let depth = 0;
    let word = '';
    for (const c of text){
        if (c === '(') depth++;
        else if (c === ')') depth = Math.max(0, depth - 1);
        if (/\s/.test(c) && depth === 0) {
            if (word) out.push(word);
            word = '';
        } else {
            word += c;
        }
    }
    if (word) out.push(word);
    return out;
}
function interpolable(values) {
    const parsed = values.map(parseVarValue);
    if (parsed.some((v)=>v === null)) return null;
    const list = parsed;
    if (list.every((v)=>'color' in v)) return list;
    if (list.some((v)=>'color' in v)) return null;
    const units = new Set(list.map((v)=>'unit' in v ? v.unit : '').filter(Boolean));
    if (units.size > 1) return null;
    const unit = [
        ...units
    ][0] ?? '';
    return list.map((v)=>({
            n: 'n' in v ? v.n : 0,
            unit
        }));
}
function parseRaw(text, report) {
    const props = {};
    const custom = {};
    const vars = {};
    for (const pair of text.split(';')){
        if (!pair.trim()) continue;
        const colon = pair.indexOf(':');
        const key = pair.slice(0, colon).trim();
        const values = words(pair.slice(colon + 1).trim());
        if (colon < 0 || !values.length) {
            report(`Cannot read loop "${pair.trim()}"`);
            continue;
        }
        if (key.startsWith('--')) {
            const list = interpolable(values);
            if (list) vars[key] = list;
            else custom[key] = values;
            continue;
        }
        const records = values.map((v)=>parseDeclarations(`${key}:${v}`, report));
        const touched = new Set(records.flatMap((r)=>Object.keys(r)));
        for (const p of touched){
            props[p] = records.map((r)=>r[p] ?? (p === 'clip' ? NO_CLIP : IDENTITY[p]));
        }
    }
    return {
        props,
        custom,
        vars
    };
}
function varFrames(lists, ease, duration) {
    const n = Math.max(2, ...Object.values(lists).map((v)=>v.length));
    const per = Math.max(2, Math.ceil(duration / (n - 1) / (1000 / 60)));
    const at = (values, i)=>values[Math.min(i, values.length - 1)];
    const track = (name, a, b)=>'color' in a ? {
            name,
            from: a.color,
            to: b.color,
            unit: null
        } : {
            name,
            from: a.n,
            to: b.n,
            unit: a.unit
        };
    const out = [];
    for(let i = 0; i < n - 1; i++){
        for(let k = 0; k < per; k++){
            const t = ease(k / per);
            const frame = {
                offset: (i + k / per) / (n - 1),
                easing: 'linear'
            };
            varsCss(Object.entries(lists).map(([name, values])=>[
                    name,
                    varValue(track(name, at(values, i), at(values, i + 1)), t)
                ]), frame);
            out.push(frame);
        }
    }
    const last = {
        offset: 1
    };
    varsCss(Object.entries(lists).map(([name, values])=>{
        const v = at(values, n - 1);
        return [
            name,
            'color' in v ? v.color : `${v.n}${v.unit}`
        ];
    }), last);
    out.push(last);
    return out;
}
function frames(lists) {
    const lengths = [
        ...Object.values(lists.props).map((v)=>v.length),
        ...Object.values(lists.custom).map((v)=>v.length)
    ];
    const n = Math.max(2, ...lengths);
    const used = new Set(Object.keys(lists.props));
    const frame = identityFrame();
    const out = [];
    for(let i = 0; i < n; i++){
        resetFrame(frame);
        for (const [p, values] of Object.entries(lists.props)){
            const v = values[Math.min(i, values.length - 1)];
            if (p === 'clip') frame.clip = v;
            else frame[p] = v;
        }
        const k = {
            offset: i / (n - 1),
            ...frameCss(frame, used)
        };
        for (const [name, values] of Object.entries(lists.custom)){
            k[name] = values[Math.min(i, values.length - 1)];
        }
        if (i < n - 1) k.easing = lists.easing;
        out.push(k);
    }
    return out;
}
function makeItem(lists, values, curve, keyframes) {
    const numeric = Object.entries(lists.props);
    const custom = Object.entries(lists.custom);
    const n = Math.max(2, ...numeric.map(([, v])=>v.length), ...custom.map(([, v])=>v.length), ...Object.values(values).map((v)=>v.length));
    const variables = Object.entries(values).map(([name, list])=>{
        const tracks = [];
        for(let i = 0; i < n - 1; i++){
            const a = list[Math.min(i, list.length - 1)], b = list[Math.min(i + 1, list.length - 1)];
            tracks.push('color' in a ? {
                name,
                from: a.color,
                to: b.color,
                unit: null
            } : {
                name,
                from: a.n,
                to: b.n,
                unit: a.unit
            });
        }
        return {
            name,
            tracks
        };
    });
    return {
        keyframes,
        duration: lists.duration,
        vars: [
            ...custom.map(([name])=>name),
            ...variables.map(({ name })=>name)
        ],
        used: numeric.map(([prop])=>prop),
        sample (progress, frame) {
            resetFrame(frame);
            const at = Math.min(1, Math.max(0, progress)) * (n - 1);
            const i = Math.min(n - 2, Math.floor(at)), t = curve(at - i);
            for (const [prop, list] of numeric)applyTrack(frame, prop, list[Math.min(i, list.length - 1)], list[Math.min(i + 1, list.length - 1)], t);
            for (const { name, tracks } of variables)frame.vars.set(name, varValue(tracks[i], t));
            for (const [name, list] of custom)frame.vars.set(name, list[Math.min(t < 0.5 ? i : i + 1, list.length - 1)]);
        }
    };
}
export function loopsOverlap(items) {
    const seen = new Set();
    for (const item of items){
        for (const key of Object.keys(item.keyframes[0] ?? {})){
            if (key === 'offset' || key === 'easing') continue;
            if (seen.has(key)) return true;
            seen.add(key);
        }
    }
    return false;
}
export function evaluateLoops(items, elapsed, frame, scratch) {
    resetFrame(frame);
    for (const item of items){
        item.sample(Math.max(0, elapsed) % item.duration / item.duration, scratch);
        combine(frame, scratch);
    }
    return frame;
}
export function parseLoop(text, duration, ease, report) {
    if (!text || !text.trim()) return [];
    if (duration !== null && duration <= 0) {
        report('loop-duration must be greater than 0');
        return [];
    }
    const easing = ease?.css ?? easeInOut.css ?? 'ease-in-out';
    const items = [];
    const addVars = (lists, cycle)=>{
        if (!Object.keys(lists).length) return;
        const keyframes = varFrames(lists, ease ?? easeInOut, cycle);
        items.push(makeItem({
            props: {},
            custom: {},
            easing: 'linear',
            duration: cycle
        }, lists, ease ?? easeInOut, keyframes));
    };
    if (text.includes(':')) {
        const { vars, ...raw } = parseRaw(text, report);
        const cycle = duration ?? 3000;
        if (Object.keys(raw.props).length || Object.keys(raw.custom).length || !Object.keys(vars).length) {
            const lists = {
                ...raw,
                easing,
                duration: cycle
            };
            items.push(makeItem(lists, {}, ease ?? easeInOut, frames(lists)));
        }
        addVars(vars, cycle);
        return items;
    }
    for (const part of splitTop(text)){
        if (!part.trim()) continue;
        const item = parseItem(part.trim());
        if (!item) {
            report(`Cannot parse loop item "${part.trim()}"`);
            continue;
        }
        const loop = LOOPS[item.name];
        if (loop) {
            const lists = loop(item.args, report);
            const cycle = {
                ...lists,
                easing: ease ? easing : lists.easing ?? easing,
                duration: duration ?? lists.duration
            };
            items.push(makeItem(cycle, {}, ease ?? parseEase(cycle.easing) ?? easeInOut, frames(cycle)));
            continue;
        }
        const effects = withoutKeyframes(parseFx(part.trim(), report), 'loop', report);
        if (!effects.length) continue;
        const props = {};
        const vars = {};
        for (const e of effects){
            for (const [p, from, to] of e.entries)props[p] = [
                from,
                to,
                from
            ];
            for (const v of e.vars){
                if (v.unit !== null && (Number.isNaN(v.from) || Number.isNaN(v.to))) {
                    report(`${part.trim()}: a loop needs both values of each axis`);
                    continue;
                }
                const [a, b] = v.unit === null ? [
                    {
                        color: v.from
                    },
                    {
                        color: v.to
                    }
                ] : [
                    {
                        n: v.from,
                        unit: v.unit
                    },
                    {
                        n: v.to,
                        unit: v.unit
                    }
                ];
                vars[v.name] = [
                    a,
                    b,
                    a
                ];
            }
        }
        const own = effects.reduce((m, e)=>Math.max(m, e.duration ?? 0), 0) || 1500;
        const cycle = duration ?? own * 2;
        if (Object.keys(props).length) {
            const lists = {
                props,
                custom: {},
                easing,
                duration: cycle
            };
            items.push(makeItem(lists, {}, ease ?? easeInOut, frames(lists)));
        }
        addVars(vars, cycle);
    }
    return items;
}
