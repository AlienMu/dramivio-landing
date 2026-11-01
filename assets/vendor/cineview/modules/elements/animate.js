import { forgetDone, parseReplay } from '../core/replay.js';
import { parseEase, settle } from '../core/ease.js';
import { evaluate, makeEffect, parseExit, parseFromTo, parseFx, turned, withOwnAxes } from '../core/fx.js';
import { evaluateLoops, loopsOverlap, parseLoop } from '../core/loop.js';
import { AXIS, identityFrame, isRest } from '../core/props.js';
import { parseAfter, parseAt, parseMs, parseStagger } from '../core/time.js';
import { warnScopedPositioning, warnUnsafeStagger, warnWideVars } from '../dev/craft.js';
import { warn } from '../dev/warn.js';
import { IDLE_FRAME } from '../core/timeline.js';
import { ElementBase } from '../platform.js';
import { stillsModule } from '../media/load-stills.js';
import { buildAdaptedLayer, buildCopyLayer, buildFadeLayer, buildLayers, buildPieceLayers, buildTargetLayers, clearLayer, writeFrame, planLayers } from '../render/layers.js';
import { keyframesModule } from '../render/load-keyframes.js';
import { splitModule } from '../text/load.js';
import { countModule } from '../text/load-count.js';
import { CvScene } from './scene.js';
const ON_TIMELINE = new Set([
    'scene',
    'enter',
    'eye',
    'clock'
]);
const SIGNALS = new Set([
    'velocity',
    'direction'
]);
const SOURCES = new Set([
    'scene',
    'enter',
    'view',
    'page',
    'clock',
    'eye',
    'velocity',
    'direction'
]);
const TIMING_ATTRIBUTES = [
    'duration',
    'delay',
    'after',
    'at',
    'stagger'
];
const CLOCK_PLAYED = new Set([
    'enter',
    'eye',
    'clock'
]);
const REDUCED_DURATION = 200;
const SPLIT_STEP = {
    words: 40,
    lines: 85
};
const DEVELOP_DURATION = 1200;
const COUNT_STEP = 170;
const SHAPES = 'path, line, polyline, polygon, circle, ellipse, rect';
function opacityOnly(e) {
    const opacity = e.tracks.opacity;
    if (!opacity && !e.vars.length) return null;
    const vars = e.vars.map((v)=>v.name.startsWith(AXIS) ? {
            ...v,
            from: v.to
        } : v);
    return {
        ...makeEffect({
            tracks: opacity ? {
                opacity
            } : {},
            vars,
            ease: e.ease,
            own: e.own
        }),
        range: e.range,
        inks: e.inks
    };
}
function startsLeft(el) {
    const { writingMode, direction } = getComputedStyle(el);
    return writingMode.startsWith('horizontal') ? direction !== 'rtl' : writingMode.endsWith('lr');
}
function ownAxes(el) {
    let style = null;
    return (tag)=>{
        if (!style) {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let text = walker.nextNode();
            while(text && !text.textContent?.trim())text = walker.nextNode();
            style = getComputedStyle(text?.parentElement ?? el);
        }
        const [value, fallback] = tag === 'wght' ? [
            style.fontWeight,
            400
        ] : tag === 'wdth' ? [
            style.fontStretch,
            100
        ] : [
            style.fontSize,
            16
        ];
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : fallback;
    };
}
export function parseOn(text, report) {
    if (text === null) return null;
    const t = text.trim();
    const view = /^view\(\s*(self|#[\w-]+)\s*\)$/.exec(t);
    if (view) return {
        source: 'view',
        subject: view[1]
    };
    if (/^enter\(\s*partial\s*\)$/.test(t)) return {
        source: 'enter',
        subject: 'scene',
        partial: true
    };
    if (SOURCES.has(t)) return {
        source: t,
        subject: 'scene'
    };
    report(`Unknown progress source on="${t}"`);
    return null;
}
export class CvAnimate extends ElementBase {
    static observedAttributes = [
        'fx',
        'from',
        'to',
        'exit',
        'exit-duration',
        'on',
        'ease',
        'name',
        'duration',
        'delay',
        'after',
        'at',
        'stagger',
        'split',
        'target',
        'loop',
        'loop-duration',
        'margin',
        'replay'
    ];
    scene = null;
    sourceRejected = false;
    dragActive = undefined;
    lastFrame = IDLE_FRAME;
    listeners = new Set();
    view = null;
    shownPhase = null;
    run = null;
    runRaf = 0;
    layers = [];
    split = null;
    splitTimed = false;
    stills = [];
    counter = null;
    drawn = [];
    inverted = null;
    timed = true;
    clocked = false;
    clockComplete = false;
    clockSolved = null;
    solved = null;
    natives = [];
    loopLayer = null;
    loopItems = [];
    loopAnimations = [];
    loopFrame = null;
    subjects = new Map();
    presetDuration = null;
    clockPresetDuration = null;
    clockMaxDuration = Number.POSITIVE_INFINITY;
    maxDuration = Number.POSITIVE_INFINITY;
    exitPlanned = false;
    connectedCallback() {
        if (Object.prototype.hasOwnProperty.call(this, 'after')) {
            const value = this.after;
            delete this.after;
            reflect(this, 'after', value);
        }
        const scene = this.closest('cv-scene');
        if (!scene) return;
        if (scene instanceof CvScene) {
            this.scene = scene;
            scene.registerAnimate(this);
        } else {
            void customElements.whenDefined('cv-scene').then(()=>{
                if (this.isConnected && !this.scene) this.connectedCallback();
            });
        }
    }
    attributeChangedCallback(_name, before, after) {
        if (before !== after) this.scene?.stage?.invalidate();
    }
    disconnectedCallback() {
        cancelAnimationFrame(this.runRaf);
        this.run = null;
        forgetDone(this);
        this.release();
        this.scene?.unregisterAnimate(this);
        this.scene = null;
    }
    timeSpec(source = 'scene', report) {
        const clock = source === 'clock';
        const stagger = parseStagger(this.getAttribute('stagger'), report);
        return {
            name: this.getAttribute('name'),
            duration: Math.min(parseMs(this.getAttribute('duration'), (clock ? this.clockPresetDuration : this.presetDuration) ?? 600, report), clock ? this.clockMaxDuration : this.maxDuration),
            delay: Math.max(0, parseMs(this.getAttribute('delay'), 0, report)),
            after: parseAfter(this.getAttribute('after'), report),
            at: parseAt(this.getAttribute('at'), report),
            exitDuration: this.exitPlanned ? parseMs(this.getAttribute('exit-duration'), 600, report) : 0,
            stagger: this.splitStagger(stagger, source) ?? (stagger && this.layers.some((l)=>l.item >= 0 && l.source === 'clock' === clock) ? {
                ...stagger,
                count: this.staggerTargets().length
            } : null)
        };
    }
    splitStagger(stagger, source) {
        const split = this.split;
        if (!split || !this.splitTimed || !this.layers.some((l)=>l.piece && l.source === 'clock' === (source === 'clock'))) return null;
        return {
            ...stagger ?? {
                each: SPLIT_STEP[split.unit],
                from: 'first'
            },
            count: split.pieces.length
        };
    }
    staggerTargets() {
        const target = this.getAttribute('target');
        const children = [
            ...this.children
        ];
        const found = target ? [
            ...this.querySelectorAll(target)
        ] : children.length === 1 ? [
            ...children[0].children
        ] : children;
        return found.filter((el)=>el instanceof HTMLElement || el instanceof SVGElement);
    }
    plan(context, report) {
        const reduced = context.reducedMotion;
        const easeText = this.getAttribute('ease');
        const ease = parseEase(easeText);
        if (easeText !== null && !ease) report(`Unknown ease "${easeText}"`);
        const replay = this.getAttribute('replay');
        if (replay !== null && parseReplay(replay) === null) report(`replay="${replay}": expected replay, replay="true" or replay="false"`);
        let effects = parseFx(this.getAttribute('fx'), report);
        const develop = effects.some((e)=>e.asset === 'develop');
        const invert = effects.some((e)=>e.asset === 'invert');
        effects = effects.filter((e)=>!e.asset);
        if (ease) effects = effects.map((e)=>({
                ...e,
                ease
            }));
        if (effects.some((e)=>e.tracks.count)) {
            const digits = this.textContent?.match(/\d/g)?.length ?? 0;
            effects = effects.map((e)=>e.tracks.count ? {
                    ...e,
                    duration: COUNT_STEP * digits
                } : e);
        }
        const raw = parseFromTo(this.getAttribute('from'), this.getAttribute('to'), ease, report);
        if (raw) effects.push(raw);
        let exits = parseExit(this.getAttribute('exit'), ease, report);
        const own = ownAxes(this);
        effects = effects.map((e)=>withOwnAxes(e, own));
        exits = exits.map((e)=>withOwnAxes(e, own));
        if ([
            ...effects,
            ...exits
        ].some((e)=>e.flow) && startsLeft(this)) {
            effects = effects.map((e)=>e.flow ? turned(e) : e);
            exits = exits.map((e)=>e.flow ? turned(e) : e);
        }
        if (!stillsModule()) {
            effects = effects.filter((e)=>!e.inks);
            exits = exits.filter((e)=>!e.inks);
        }
        const on = parseOn(this.getAttribute('on'), report);
        const loopDuration = this.getAttribute('loop-duration');
        const loops = parseLoop(this.getAttribute('loop'), loopDuration === null ? null : parseMs(loopDuration, 3000, report), ease, report);
        if (reduced) effects = effects.filter((e)=>!e.reducible);
        if (false) {
            const names = [
                ...effects,
                ...exits
            ].flatMap((e)=>e.vars.map((v)=>v.name));
            warnWideVars(this, [
                ...names,
                ...loops.flatMap((l)=>l.vars)
            ]);
        }
        const groups = new Map();
        const group = (source)=>{
            let g = groups.get(source);
            if (!g) groups.set(source, g = {
                effects: [],
                exits: []
            });
            return g;
        };
        const keyframed = [];
        for (const e of effects){
            const source = e.own && SIGNALS.has(e.own) ? e.own : on?.source ?? (e.viewRange ? 'view' : null) ?? e.own ?? context.timeSource;
            if (false && e.viewRange && source !== 'view') {
                warn(this, `a named range needs a view source; it has no effect with on="${source}"`);
            }
            if (reduced && SIGNALS.has(source)) continue;
            if (e.keyframes) {
                keyframed.push({
                    source,
                    effect: e,
                    played: !(reduced && CLOCK_PLAYED.has(source))
                });
                continue;
            }
            const kept = reduced && CLOCK_PLAYED.has(source) ? opacityOnly(e) : e;
            if (kept) group(source).effects.push(kept);
        }
        const timeSource = on && ON_TIMELINE.has(on.source) ? on.source : context.timeSource;
        const clockPlayed = reduced && CLOCK_PLAYED.has(on?.source ?? timeSource);
        if (clockPlayed) exits = exits.map(opacityOnly).filter((e)=>e !== null);
        let hasExit = false;
        if (exits.length) {
            if (on && !ON_TIMELINE.has(on.source)) {
                if (false) warn(this, `exit has no effect with on="${on.source}": exits follow time`);
            } else {
                group(timeSource).exits.push(...exits);
                hasExit = true;
            }
        }
        const splitText = this.getAttribute('split');
        const unit = splitText === 'words' || splitText === 'lines' ? splitText : null;
        if (splitText !== null && !unit) report(`split="${splitText}": expected words or lines`);
        let split = null;
        let whole = null;
        const splitSource = on?.source ?? context.timeSource;
        const splitGroup = unit ? groups.get(splitSource) : undefined;
        if (unit && reduced) {
            if (splitGroup) {
                splitGroup.effects = [];
                if (!splitGroup.exits.length) groups.delete(splitSource);
            }
        } else if (unit && splitGroup?.effects.length && (ON_TIMELINE.has(splitSource) || splitSource === 'view' || splitSource === 'page')) {
            const subject = on?.subject ?? 'scene';
            whole = planLayers(groups, subject, loops.length > 0);
            const timedSplit = ON_TIMELINE.has(splitSource);
            const plans = [];
            const parts = timedSplit ? [
                {
                    kind: 'time',
                    source: splitSource,
                    subject: 'scene',
                    range: null,
                    effects: splitGroup.effects,
                    exitEffects: [],
                    select: 'all'
                }
            ] : planLayers(new Map([
                [
                    splitSource,
                    {
                        effects: splitGroup.effects,
                        exits: []
                    }
                ]
            ]), subject);
            for (const p of parts){
                if (!plans.some((q)=>q.range === p.range)) plans.push({
                    ...p,
                    exitEffects: [],
                    select: 'all'
                });
            }
            split = {
                unit,
                timed: timedSplit,
                plans
            };
            splitGroup.effects = [];
            if (!splitGroup.exits.length) groups.delete(splitSource);
        } else if (unit && false) {
            warn(this, `split needs effects on a time, view or page source; it has no effect here`);
        }
        let staggered = null;
        if (split) {
            if (false && !split.timed && this.hasAttribute('stagger')) {
                warn(this, 'stagger has no effect on split text that follows the viewport: the words overlap instead');
            }
        } else if (this.hasAttribute('stagger')) {
            const g = groups.get(timeSource);
            if (g && ON_TIMELINE.has(timeSource)) {
                staggered = {
                    kind: 'time',
                    source: timeSource,
                    subject: 'scene',
                    range: null,
                    effects: g.effects,
                    exitEffects: g.exits,
                    select: 'all'
                };
                groups.delete(timeSource);
                if (false) warnUnsafeStagger(this, staggered);
            } else if (false && !reduced) {
                warn(this, 'stagger needs time-driven effects (scene or enter); it has no effect here');
            }
        }
        const sources = [
            ...groups.keys(),
            ...keyframed.filter((k)=>k.played).map((k)=>k.source)
        ];
        if (staggered) sources.push(staggered.source);
        if (split) sources.push(splitSource);
        const timed = sources.length ? sources.some((s)=>ON_TIMELINE.has(s) && s !== 'clock') : !this.hasAttribute('loop') && (!on || ON_TIMELINE.has(on.source) && on.source !== 'clock');
        const clocked = sources.includes('clock') || !sources.length && on?.source === 'clock';
        if (false && !timed && !clocked) {
            const ignored = TIMING_ATTRIBUTES.filter((a)=>this.hasAttribute(a));
            if (ignored.length) {
                warn(this, `${ignored.join(', ')} ${ignored.length > 1 ? 'have' : 'has'} no effect: nothing on this element follows time. Use a named view range for view-driven effects.`);
            }
        }
        let duration = null, clockDuration = null;
        for (const source of new Set(sources)){
            if (!ON_TIMELINE.has(source)) continue;
            const effects = [
                ...staggered?.source === source ? staggered.effects : [],
                ...split?.timed ? split.plans.filter((p)=>p.source === source).flatMap((p)=>p.effects) : [],
                ...groups.get(source)?.effects ?? []
            ];
            for (const e of effects)if (e.duration !== null) {
                if (source === 'clock') clockDuration = Math.max(clockDuration ?? 0, e.duration);
                else duration = Math.max(duration ?? 0, e.duration);
            }
        }
        const layers = planLayers(groups, on?.subject ?? 'scene', !reduced && loops.length > 0);
        const fades = stillsModule()?.planFades(layers, this) ?? [];
        const inks = stillsModule()?.planInks(layers) ?? [];
        const counts = countModule()?.planCounts(layers) ?? [];
        const reader = keyframesModule();
        const rules = [];
        for (const { source, effect, played } of reader ? keyframed : []){
            const keyframes = reader.readKeyframes(this, effect.keyframes, effect.ease.css ?? 'linear', report);
            const layer = {
                kind: 'keyframes',
                source,
                subject: on?.subject ?? 'scene',
                range: source === 'view' ? effect.viewRange : null,
                effects: [
                    effect
                ],
                exitEffects: [],
                select: 'rest'
            };
            if (keyframes && played) rules.push({
                plan: layer,
                keyframes
            });
        }
        return {
            layers,
            rules,
            fades,
            inks,
            counts,
            develop: develop ? reduced ? REDUCED_DURATION : DEVELOP_DURATION : null,
            invert,
            staggered,
            split,
            whole,
            timed,
            clocked,
            duration,
            clockDuration,
            clockMaxDuration: reduced ? REDUCED_DURATION : Number.POSITIVE_INFINITY,
            maxDuration: clockPlayed ? REDUCED_DURATION : Number.POSITIVE_INFINITY,
            hasExit,
            loops: reduced ? [] : loops
        };
    }
    build(plan) {
        this.release();
        this.sourceRejected = false;
        this.subjects.clear();
        this.timed = plan.timed;
        this.clocked = plan.clocked;
        this.clockComplete = false;
        this.presetDuration = plan.duration;
        this.clockPresetDuration = plan.clockDuration;
        this.clockMaxDuration = plan.clockMaxDuration;
        this.maxDuration = plan.maxDuration;
        this.exitPlanned = plan.hasExit;
        this.layers = buildLayers(this, plan.layers, plan.rules);
        if (plan.split) {
            const axes = [
                ...new Set([
                    ...[
                        ...plan.layers,
                        ...plan.split.plans
                    ].flatMap((p)=>[
                            ...p.effects,
                            ...p.exitEffects
                        ].flatMap((e)=>e.vars.map((v)=>v.name))),
                    ...plan.loops.flatMap((item)=>item.vars)
                ].filter((name)=>name.startsWith(AXIS)))
            ];
            this.mountSplit(plan.split, plan.whole, plan.rules, axes);
        }
        this.mountStills(plan);
        this.loopLayer = this.layers.find((l)=>l.kind === 'loop') ?? null;
        this.loopItems = plan.loops;
        if (plan.staggered) {
            this.layers.push(...buildTargetLayers(this.staggerTargets(), plan.staggered));
        }
        this.mountCount(plan);
        this.mountDraw();
        if (plan.invert) this.mountInvert();
        if (false && plan.layers.length) warnScopedPositioning(this);
    }
    mountInvert() {
        const style = document.createElement('style');
        style.textContent = ':host{mix-blend-mode:difference;color:#fff}';
        this.shadowRoot.append(style);
        this.inverted = style;
        this.scene?.isolate(this, true);
    }
    mountCount(plan) {
        if (!plan.counts.length) return;
        const slot = this.shadowRoot.querySelector('slot');
        const mod = countModule();
        if (!slot || !mod || this.split) {
            if (false && this.split) warn(this, 'count has no effect on split text');
            return;
        }
        const counter = new mod.Counter(this, slot, ()=>this.scene?.stage?.invalidate());
        this.counter = counter;
        const refused = counter.mount();
        if (refused) {
            if (false) warn(this, `count: ${refused}; the number shows as it is`);
            return;
        }
        for (const p of plan.counts){
            this.layers.push(buildAdaptedLayer(p, counter.el, counter.adapt, counter.vars));
        }
    }
    mountDraw() {
        if (!this.layers.some((l)=>l.used.has('draw'))) return;
        const target = this.getAttribute('target');
        const roots = target ? [
            ...this.querySelectorAll(target)
        ] : [
            this
        ];
        const shapes = roots.flatMap((el)=>el instanceof SVGGeometryElement ? [
                el
            ] : [
                ...el.querySelectorAll(SHAPES)
            ]);
        if (false && !shapes.length) warn(this, `draw has no shapes to draw (${SHAPES})`);
        for (const el of shapes){
            const length = el.getAttribute('pathLength');
            const dash = el.style.strokeDasharray;
            el.setAttribute('pathLength', '1');
            el.style.strokeDasharray = '1 2';
            this.drawn.push(()=>{
                if (length === null) el.removeAttribute('pathLength');
                else el.setAttribute('pathLength', length);
                el.style.strokeDasharray = dash;
            });
        }
    }
    mountSplit(plan, whole, rules, axes) {
        const slot = this.shadowRoot.querySelector('slot');
        const rebuild = plan.timed ? null : ()=>this.scene?.stage?.invalidate();
        const mod = splitModule();
        const split = mod && new mod.TextSplit(this, slot, plan.unit, rebuild, axes);
        const refused = split ? split.mount() : 'it is still loading';
        if (!split || refused) {
            split?.destroy();
            if (false) warn(this, `split="${plan.unit}": ${refused}; the text animates as a whole`);
            this.layers = buildLayers(this, whole, rules);
            return;
        }
        const end = identityFrame();
        split.atRest = axes.length === 0 && plan.plans.every((p)=>{
            evaluate(p.effects, 1, end, 'all');
            return isRest(end) && end.vars.size === 0;
        });
        const pieces = buildPieceLayers(split.pieces, plan.plans, plan.timed);
        if (!plan.timed && pieces[0]) pieces[0].watch = (p)=>split.progress(p);
        this.layers.push(...pieces);
        this.split = split;
        this.splitTimed = plan.timed;
        this.shownPhase = null;
    }
    mountStills(plan) {
        const slot = this.shadowRoot.querySelector('slot');
        const mod = stillsModule();
        if (!slot || !mod) return;
        const { Develop, Duotone, FocusCopy, copyContainer } = mod;
        for (const { layer, inks } of plan.inks){
            if (false && !this.querySelector('img')) warn(this, 'duotone has no images to print');
            const print = new Duotone(this, copyContainer(slot, 'duotone'));
            print.mount(inks);
            this.stills.push(print);
            this.layers.push(buildCopyLayer(layer, print.container));
        }
        for (const { layer, blur } of plan.fades){
            const copy = new FocusCopy(this, copyContainer(slot, 'focus-copy'));
            copy.mount(blur);
            this.stills.push(copy);
            this.layers.push(buildFadeLayer(layer, copy.container, blur));
        }
        if (plan.develop !== null) {
            const develop = new Develop(this, copyContainer(slot, 'develop'));
            develop.mount(plan.develop, settle.css);
            this.stills.push(develop);
        }
    }
    activated(on) {
        if (on) this.split?.schedule();
    }
    viewSubject(layer) {
        const scene = this.scene ?? this;
        if (layer.subject === 'scene') return scene;
        if (layer.subject === 'self') return this;
        const found = this.subjects.get(layer.subject);
        if (found?.isConnected && scene.contains(found)) return found;
        const el = scene.querySelector(`#${CSS.escape(layer.subject.slice(1))}`);
        if (false && !el) {
            warn(this, `on="view(${layer.subject})": no element with that id in this scene`);
        }
        this.subjects.set(layer.subject, el ?? scene);
        return el ?? scene;
    }
    get timeline() {
        if (!this.view) {
            const frame = ()=>this.sourceRejected ? IDLE_FRAME : this.run ? this.clockFrame() : (this.clocked && !this.timed ? null : this.scene?.stage?.engine?.frameOf?.(this)) ?? this.lastFrame;
            this.view = {
                get frame () {
                    return frame();
                },
                get progress () {
                    return frame().progress;
                },
                get signedProgress () {
                    return frame().signedProgress;
                },
                get phase () {
                    return frame().phase;
                },
                get source () {
                    return frame().source;
                },
                subscribe: (listener)=>{
                    this.listeners.add(listener);
                    if (this.run) this.tickRun();
                    return ()=>{
                        this.listeners.delete(listener);
                    };
                }
            };
        }
        return this.view;
    }
    get subscribed() {
        return this.listeners.size > 0;
    }
    sendFrame(frame) {
        this.showPhase(frame.phase);
        this.publish(frame);
    }
    showPhase(phase) {
        if (phase === this.shownPhase) return;
        const splitPhase = phase === 'exiting' && this.shownPhase === 'entering' ? 'entering' : phase;
        this.shownPhase = phase;
        if (this.splitTimed) this.split?.phase(splitPhase);
        this.setAttribute('data-cv-phase', phase);
    }
    clockEvent(event) {
        cancelAnimationFrame(this.runRaf);
        this.runRaf = 0;
        if (event.type !== 'enter' && event.type !== 'exit') {
            this.run = null;
            this.publish(event.type === 'reset' ? IDLE_FRAME : {
                progress: 1,
                signedProgress: 1,
                phase: 'entered',
                source: event.source ?? 'visibility'
            });
            return;
        }
        this.run = {
            kind: event.type,
            start: event.start,
            duration: event.duration,
            source: event.source ?? 'visibility'
        };
        this.tickRun();
    }
    clockFrame() {
        const run = this.run;
        const now = this.scene?.stage?.clock.now() ?? performance.now();
        if (now < run.start) {
            return run.kind === 'enter' ? {
                ...IDLE_FRAME,
                phase: 'entering',
                source: run.source
            } : {
                ...IDLE_FRAME,
                phase: 'exiting',
                source: run.source
            };
        }
        const p = run.duration > 0 ? Math.min(1, (now - run.start) / run.duration) : 1;
        const phase = run.kind === 'enter' ? p >= 1 ? 'entered' : 'entering' : p >= 1 ? 'exited' : 'exiting';
        return {
            progress: p,
            signedProgress: p,
            phase,
            source: run.source
        };
    }
    tickRun = ()=>{
        this.runRaf = 0;
        if (!this.run || !this.listeners.size) return;
        const frame = this.clockFrame();
        this.publish(frame);
        if (frame.phase === 'entered' || frame.phase === 'exited') this.run = null;
        else this.runRaf = requestAnimationFrame(this.tickRun);
    };
    publish(frame) {
        const last = this.lastFrame;
        if (last.phase === frame.phase && last.source === frame.source && Math.abs(last.progress - frame.progress) < 1e-4 && Math.abs(last.signedProgress - frame.signedProgress) < 1e-4) {
            return;
        }
        this.lastFrame = frame;
        for (const listener of this.listeners)listener(frame);
    }
    cancelNatives() {
        for (const a of this.natives)a.cancel();
        this.natives = [];
    }
    get looping() {
        return this.loopAnimations.length > 0 || this.loopFrame !== null;
    }
    startLoops(clock) {
        const layer = this.loopLayer;
        if (!layer || this.looping) return;
        if (loopsOverlap(this.loopItems)) {
            layer.used = new Set(this.loopItems.flatMap((item)=>item.used));
            const start = clock.now();
            this.loopFrame = clock.subscribe((time)=>{
                evaluateLoops(this.loopItems, time - start, layer.frame, layer.scratch);
                writeFrame(layer, layer.frame);
            });
            return;
        }
        for (const item of this.loopItems){
            this.loopAnimations.push(clock.add(layer.el.animate(item.keyframes, {
                duration: item.duration,
                iterations: Infinity
            })));
        }
    }
    stopLoops() {
        this.loopFrame?.();
        this.loopFrame = null;
        if (this.loopLayer) clearLayer(this.loopLayer);
        for (const a of this.loopAnimations)a.cancel();
        this.loopAnimations = [];
    }
    rejectSource() {
        this.sourceRejected = true;
        this.release();
        this.subjects.clear();
        this.dragActive = undefined;
        this.timed = this.clocked = this.clockComplete = false;
        this.solved = this.clockSolved = null;
        this.loopItems = [];
        this.loopLayer = null;
        this.layers = buildLayers(this, []);
        this.clockEvent({
            type: 'reset'
        });
        this.showPhase('idle');
    }
    release() {
        this.stopLoops();
        this.cancelNatives();
        this.split?.destroy();
        this.split = null;
        this.splitTimed = false;
        for (const s of this.stills)s.destroy();
        this.stills = [];
        this.counter?.destroy();
        this.counter = null;
        for (const undo of this.drawn)undo();
        this.drawn = [];
        this.inverted?.remove();
        this.inverted = null;
        this.scene?.isolate(this, false);
        for (const l of this.layers){
            l.native = null;
            if (l.target) clearLayer(l);
        }
    }
}
function reflect(el, name, value) {
    if (value === null || value === undefined || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? '' : String(value));
}
if (typeof Element !== 'undefined') {
    Object.defineProperty(CvAnimate.prototype, 'after', {
        configurable: true,
        get () {
            return Element.prototype.after;
        },
        set (value) {
            reflect(this, 'after', value);
        }
    });
}
