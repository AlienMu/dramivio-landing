import { evaluate, sampleKeyframes, samplePoints, usedProps, usedVars } from '../core/fx.js';
import { combine, IDENTITY, NO_CLIP, parseVarValue, varValue, compositorEligible, frameCss, identityFrame, mirrorFrame, resetFrame } from '../core/props.js';
import { sameRange } from '../core/view.js';
const KIND_OF = {
    view: 'space',
    page: 'space',
    scene: 'time',
    enter: 'time',
    eye: 'time',
    clock: 'clock',
    velocity: 'signal',
    direction: 'signal'
};
const RANK = {
    keyframes: -1,
    space: 0,
    time: 1,
    clock: 2,
    loop: 3,
    signal: 4,
    clip: 5
};
const SOURCE_RANK = {
    page: 0,
    view: 1,
    scene: 2,
    enter: 3,
    eye: 4,
    clock: 5,
    velocity: 6,
    direction: 7
};
export const kindOf = (source)=>KIND_OF[source];
const LAYER_STYLE = ':host{display:block;position:relative}' + ':host([display=inline]){display:inline-block}' + '.l{display:block;width:100%;height:100%}' + 'slot{display:contents}';
const hasTracks = (effects, clip)=>effects.some((e)=>e.entries.some(([p])=>p === 'clip' === clip) || !clip && e.vars.length > 0);
function byRange(effects) {
    const parts = [];
    for (const e of effects){
        const part = parts.find((p)=>sameRange(p.range, e.viewRange));
        if (part) part.effects.push(e);
        else parts.push({
            range: e.viewRange,
            effects: [
                e
            ]
        });
    }
    return parts;
}
export function planLayers(groups, subject, loop = false) {
    const plans = [];
    if (loop) {
        plans.push({
            kind: 'loop',
            source: 'clock',
            subject,
            range: null,
            effects: [],
            exitEffects: [],
            select: 'rest'
        });
    }
    for (const [source, group] of groups){
        const parts = source === 'view' ? byRange(group.effects) : [
            {
                range: null,
                effects: group.effects
            }
        ];
        for (const { range, effects } of parts){
            const exits = range === null ? group.exits : [];
            const all = [
                ...effects,
                ...exits
            ];
            const plan = {
                source,
                subject,
                range,
                effects,
                exitEffects: exits
            };
            if (hasTracks(all, false)) plans.push({
                ...plan,
                kind: kindOf(source),
                select: 'rest'
            });
            if (hasTracks(all, true)) plans.push({
                ...plan,
                kind: 'clip',
                select: 'clip'
            });
        }
    }
    return plans.sort((a, b)=>RANK[a.kind] - RANK[b.kind] || SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
}
function makeLayer(plan, el, target, item, piece = false, fade = 0) {
    return {
        ...plan,
        shared: null,
        el,
        target,
        piece,
        item,
        watch: null,
        fade,
        adapt: null,
        window: null,
        used: fade ? new Set([
            'opacity'
        ]) : new Set([
            ...usedProps(plan.effects, plan.select),
            ...usedProps(plan.exitEffects, plan.select)
        ]),
        vars: new Set([
            ...usedVars(plan.effects, plan.select),
            ...usedVars(plan.exitEffects, plan.select)
        ]),
        frame: identityFrame(),
        scratch: identityFrame(),
        last: new Map(),
        native: null,
        rule: null,
        seek: null
    };
}
function shareOutputs(layers) {
    const byElement = new Map();
    for (const layer of layers){
        const group = byElement.get(layer.el);
        if (group) group.push(layer);
        else byElement.set(layer.el, [
            layer
        ]);
    }
    for (const members of byElement.values()){
        if (members.length < 2) continue;
        const output = members[0];
        const shared = {
            layers: members,
            frame: identityFrame(),
            output
        };
        output.used = new Set(members.flatMap((l)=>[
                ...l.used
            ]));
        output.vars = new Set(members.flatMap((l)=>[
                ...l.vars
            ]));
        for (const layer of members){
            layer.shared = shared;
            layer.last = output.last;
        }
    }
}
export function buildLayers(host, plans, rules = []) {
    const root = host.shadowRoot ?? host.attachShadow({
        mode: 'open'
    });
    root.textContent = '';
    const style = document.createElement('style');
    style.textContent = LAYER_STYLE;
    root.append(style);
    let parent = root;
    const layers = [];
    for (const { plan, keyframes } of rules){
        const el = document.createElement('div');
        el.className = 'l';
        el.setAttribute('part', 'layer keyframes');
        parent.append(el);
        parent = el;
        const layer = makeLayer(plan, el, false, -1);
        const [a, b] = plan.effects[0]?.range ?? [
            0,
            1
        ];
        layer.rule = placeKeyframes(keyframes, a, b);
        layers.push(layer);
    }
    let previous = null;
    for (const plan of plans){
        if (previous && plan.source === 'view' && plan.kind === 'space' && previous.source === plan.source && previous.kind === plan.kind) {
            const layer = makeLayer(plan, previous.el, false, -1);
            layers.push(layer);
            previous = layer;
            continue;
        }
        const el = document.createElement('div');
        el.className = 'l';
        el.setAttribute('part', `layer ${plan.kind}`);
        const origin = plan.select === 'clip' ? null : plan.effects.find((e)=>e.origin)?.origin;
        if (origin) el.style.transformOrigin = origin;
        parent.append(el);
        parent = el;
        previous = makeLayer(plan, el, false, -1);
        layers.push(previous);
    }
    parent.append(document.createElement('slot'));
    shareOutputs(layers);
    return layers;
}
export function buildTargetLayers(targets, plan) {
    return targets.map((el, item)=>makeLayer({
            ...plan,
            select: 'all'
        }, el, true, item));
}
export function buildPieceLayers(pieces, plans, timed) {
    const n = pieces.length;
    const s = 1 / (n + 4);
    const layers = [];
    for (const plan of plans){
        const origin = plan.effects.find((e)=>e.origin)?.origin;
        pieces.forEach((el, k)=>{
            if (origin) el.style.transformOrigin = origin;
            const [from, to] = timed ? [
                0,
                1
            ] : [
                k * s,
                (k + 5) * s
            ];
            const effects = timed ? plan.effects : plan.effects.map((e)=>({
                    ...e,
                    range: [
                        from + e.range[0] * (to - from),
                        from + e.range[1] * (to - from)
                    ]
                }));
            layers.push(makeLayer({
                ...plan,
                effects,
                select: 'all'
            }, el, false, k, true));
        });
    }
    shareOutputs(layers);
    return layers;
}
export function buildFadeLayer(plan, el, blur) {
    return makeLayer(plan, el, false, -1, false, blur);
}
export function placeKeyframes(frames, a, b) {
    if (a === 0 && b === 1) return frames.slice();
    const placed = frames.map((k)=>({
            ...k,
            offset: a + (k.offset ?? 0) * (b - a)
        }));
    const first = frames[0];
    const last = frames[frames.length - 1];
    if (a > 0 && first?.offset === 0) placed.unshift({
        ...first,
        offset: 0,
        easing: 'linear'
    });
    if (b < 1 && last?.offset === 1) placed.push({
        ...last,
        offset: 1,
        easing: 'linear'
    });
    return placed;
}
export function buildCopyLayer(plan, el) {
    return makeLayer(plan, el, false, -1);
}
export function buildAdaptedLayer(plan, el, adapt, vars) {
    const layer = makeLayer(plan, el, false, -1);
    layer.adapt = adapt;
    layer.vars = new Set(vars);
    return layer;
}
export function assignWindows(layers, solved, source = null) {
    for (const layer of layers){
        if (source && layer.source !== source) continue;
        if (!solved || (source ? layer.kind === 'loop' : kindOf(layer.source) !== 'time')) {
            layer.window = null;
            continue;
        }
        const items = solved.items;
        if (layer.item < 0 || !items) {
            layer.window = solved;
            continue;
        }
        const from = items.from[layer.item] ?? 0;
        const to = items.to[layer.item] ?? 1;
        const length = solved.end - solved.start;
        const exitLength = solved.exitEnd - solved.exitStart;
        layer.window = {
            start: solved.start + from * length,
            end: solved.start + to * length,
            exitStart: solved.exitStart + from * exitLength,
            exitEnd: solved.exitStart + to * exitLength
        };
    }
}
export function evaluateLayer(layer, p, px, mirror = false, beforeP = false, beforePx = false) {
    evaluate(layer.effects, p, layer.frame, layer.select, beforeP);
    if (px > 0 && layer.exitEffects.length) {
        evaluate(layer.exitEffects, px, layer.scratch, layer.select, beforePx);
        combine(layer.frame, layer.scratch);
    }
    if (mirror) mirrorFrame(layer.frame);
    return layer.frame;
}
const TARGET_VARS = {
    filter: '--cv-filter',
    clipPath: '--cv-clip-path',
    transform: '--cv-transform'
};
export function layerCss(layer, frame) {
    if (layer.fade) {
        frame.opacity = Math.min(1, frame.blur / layer.fade);
        frame.blur = 0;
    }
    layer.adapt?.(frame);
    const css = frameCss(frame, layer.used);
    if (!layer.target) return css;
    const out = {};
    for(const key in css)out[TARGET_VARS[key] ?? key] = css[key];
    return out;
}
const SEEK = 1000;
export function writeLayer(layer, p, px, mirror = false) {
    layer.watch?.(p);
    if (layer.rule) {
        if (!layer.seek) {
            layer.seek = layer.el.animate(layer.rule, {
                duration: SEEK,
                fill: 'both'
            });
            layer.seek.pause();
        }
        const t = Math.min(1, Math.max(0, p)) * SEEK;
        if (layer.seek.currentTime !== t) layer.seek.currentTime = t;
        return;
    }
    const frame = evaluateLayer(layer, p, px, mirror);
    if (layer.shared) {
        const group = layer.shared;
        resetFrame(group.frame);
        for (const member of group.layers)combine(group.frame, member.frame);
        writeFrame(group.output, group.frame);
    } else writeFrame(layer, frame);
}
export function writeFrame(layer, frame) {
    const css = layerCss(layer, frame);
    const style = layer.el.style;
    for(const key in css){
        const value = css[key];
        if (layer.last.get(key) === value) continue;
        layer.last.set(key, value);
        if (key.startsWith('--')) style.setProperty(key, value);
        else style[key] = value;
    }
}
export function clearLayer(layer) {
    layer.seek?.cancel();
    layer.seek = null;
    const style = layer.el.style;
    for (const key of layer.last.keys()){
        if (key.startsWith('--')) style.removeProperty(key);
        else style[key] = '';
    }
    layer.last.clear();
}
export const compositorLayer = (layer)=>!layer.piece && !layer.shared && compositorEligible(layer.used) && layer.vars.size === 0;
export const samplesFor = (layer, duration)=>layer.vars.size ? Math.max(12, Math.ceil(duration / (1000 / 60))) : 12;
export function layerKeyframes(layer, samples = 12) {
    if (layer.rule) return layer.rule;
    return sampleKeyframes(layer.effects, layer.select, (f)=>layerCss(layer, f), identityFrame(), samples);
}
export function exitKeyframes(layer, samples = 12, entrance = 1) {
    if (layer.rule) {
        if (entrance < 1) {
            const style = getComputedStyle(layer.el), frame = {};
            const keys = new Set(layer.rule.flatMap((k)=>Object.keys(k)));
            for (const key of keys){
                if (key === 'offset' || key === 'easing' || key === 'composite') continue;
                frame[key] = key.startsWith('--') ? style.getPropertyValue(key) : style[key];
            }
            return [
                {
                    ...frame,
                    offset: 0
                },
                {
                    ...frame,
                    offset: 1
                }
            ];
        }
        const end = layer.rule[layer.rule.length - 1];
        return end?.offset === 1 ? [
            {
                ...end,
                offset: 0
            },
            {
                ...end
            }
        ] : [];
    }
    const from = identityFrame(), base = identityFrame(), end = identityFrame();
    if (entrance < 1) {
        combine(from, evaluateLayer(layer, entrance, 0));
        combine(base, evaluateLayer(layer, 1, 0));
        combine(end, evaluateLayer(layer, 1, 1));
    }
    return samplePoints(layer.exitEffects, samples).map(({ offset, before })=>{
        const frame = evaluateLayer(layer, 1, offset, false, false, before);
        if (entrance < 1) {
            const rest = 1 - offset;
            for (const prop of Object.keys(IDENTITY))frame[prop] += (from[prop] - base[prop]) * rest;
            if (from.clip || base.clip) {
                const a = from.clip ?? NO_CLIP, b = base.clip ?? NO_CLIP, clip = frame.clip ?? NO_CLIP;
                frame.clip = [
                    0,
                    1,
                    2,
                    3
                ].map((i)=>clip[i] + (a[i] - b[i]) * rest);
            }
            for (const [name, value] of from.vars){
                if (value === base.vars.get(name)) continue;
                const a = parseVarValue(value), b = parseVarValue(base.vars.get(name) ?? ''), c = parseVarValue(frame.vars.get(name) ?? '');
                if (a && b && c && 'n' in a && 'n' in b && 'n' in c && a.unit === b.unit && b.unit === c.unit) frame.vars.set(name, `${c.n + (a.n - b.n) * rest}${c.unit}`);
                else if (a && 'color' in a && end.vars.has(name)) frame.vars.set(name, varValue({
                    name,
                    from: a.color,
                    to: end.vars.get(name),
                    unit: null
                }, offset));
            }
        }
        return {
            offset,
            ...layerCss(layer, frame)
        };
    });
}
export function sceneKeyframes(layer, window, total, samplesPerSegment = 8) {
    if (layer.rule) {
        const at = (t)=>total > 0 ? t / total : 0;
        return placeKeyframes(layer.rule, at(window.start), at(window.end));
    }
    const points = new Map([
        [
            0,
            {}
        ],
        [
            total,
            {}
        ]
    ]);
    const addSegment = (effects, a, b, exit)=>{
        if (b <= a) return;
        for (const { offset, before } of samplePoints(effects, samplesPerSegment)){
            const t = offset === 1 ? b : a + (b - a) * offset;
            const step = points.get(t) ?? {};
            step[exit ? 'px' : 'p'] = offset;
            if (before) step[exit ? 'beforePx' : 'beforeP'] = true;
            points.set(t, step);
        }
    };
    addSegment(layer.effects, window.start, window.end, false);
    if (layer.exitEffects.length) addSegment(layer.exitEffects, window.exitStart, window.exitEnd, true);
    const times = [
        ...points.keys()
    ].filter((t)=>t >= 0 && t <= total).sort((a, b)=>a - b);
    const frame = (t, beforeP = false, beforePx = false)=>({
            offset: total > 0 ? t / total : 0,
            ...layerCss(layer, evaluateLayer(layer, points.get(t).p ?? progressIn(t, window.start, window.end), layer.exitEffects.length ? points.get(t).px ?? progressIn(t, window.exitStart, window.exitEnd) : 0, false, beforeP, beforePx))
        });
    return times.flatMap((t)=>{
        const step = points.get(t);
        return step.beforeP || step.beforePx ? [
            frame(t, step.beforeP, step.beforePx),
            frame(t)
        ] : [
            frame(t)
        ];
    });
}
export function progressIn(t, a, b) {
    if (b <= a) return t >= b ? 1 : 0;
    return t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a);
}
