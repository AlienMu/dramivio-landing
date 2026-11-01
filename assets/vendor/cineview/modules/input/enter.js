import { entranceDefinition, forgetDone, isDone, markDone, parseReplay } from '../core/replay.js';
import { clearLayer, progressIn, exitKeyframes, layerKeyframes, samplesFor, writeLayer } from '../render/layers.js';
import { gateAction, gates } from './gates.js';
const NONE = ()=>undefined;
const retainedRuns = new WeakMap();
const definition = (a)=>entranceDefinition(a, a.scene?.id ?? '');
export function forgetRetainedRun(a) {
    retainedRuns.delete(a);
    forgetDone(a);
}
function setPhase(t, phase) {
    t.phase = phase;
    if (t.autonomous) t.a.clockComplete = phase === 'entered';
    if (t.primary) t.a.showPhase(phase);
}
export function parseMargins(text, fallback) {
    if (text === null) return fallback;
    const [a, b] = text.trim().split(/\s+/).map(Number);
    const enter = Number.isFinite(a) ? Math.max(0, a) : fallback[0];
    return [
        enter,
        Number.isFinite(b) ? Math.max(0, b) : enter
    ];
}
export class EnterController {
    clock;
    firstScreen;
    source;
    tracks = [];
    byElement = new Map();
    activeScene = null;
    sceneStartedAt = 0;
    snapshot() {
        return this.activeScene ? {
            scene: this.activeScene,
            start: this.sceneStartedAt
        } : null;
    }
    constructor(clock, firstScreen = {
        held: ()=>false,
        offset: 0
    }, source = 'visibility'){
        this.clock = clock;
        this.firstScreen = firstScreen;
        this.source = source;
    }
    get size() {
        return this.tracks.length;
    }
    add(a, options) {
        const autonomous = this.source === 'clock';
        if (autonomous ? !a.clocked : a.clocked && !a.timed) return;
        const layers = a.layers.filter((l)=>autonomous ? l.source === 'clock' && l.kind !== 'loop' : l.source === 'enter' || l.source === 'eye');
        if (!layers.length && !a.loopItems.length && !a.timed && !autonomous) return;
        const retained = autonomous ? undefined : retainedRuns.get(a);
        retainedRuns.delete(a);
        const track = {
            a,
            solved: autonomous ? a.clockSolved : a.solved,
            primary: !autonomous || !a.timed,
            autonomous,
            onScreen: false,
            layers,
            phase: 'idle',
            origin: 'idle',
            measured: !!retained,
            first: options.first,
            eye: layers.some((l)=>l.source === 'eye'),
            partial: /^enter\(\s*partial\s*\)$/.test(a.getAttribute('on')?.trim() ?? ''),
            hasExit: layers.some((l)=>l.exitEffects.length > 0),
            replay: parseReplay(a.getAttribute('replay')) ?? 'default',
            done: isDone(a, definition(a)),
            margins: parseMargins(a.getAttribute('margin'), options.margins),
            unseen: false,
            startedAt: null,
            predecessor: null,
            lead: 0,
            delay: a.timeSpec().delay,
            running: [],
            token: 0,
            retained
        };
        for (const layer of layers)writeLayer(layer, 0, 0);
        this.tracks.push(track);
        this.byElement.set(a, track);
    }
    link() {
        for (const t of this.tracks){
            const scene = t.a.scene;
            const solved = t.solved;
            if (!scene || !solved || solved.predecessor < 0) continue;
            const leader = (t.autonomous ? scene.clocks : scene.timed)[solved.predecessor];
            const pred = leader ? this.byElement.get(leader) : undefined;
            if (!pred?.solved) continue;
            t.predecessor = pred;
            t.lead = solved.start - pred.solved.start;
        }
        const now = this.clock.now();
        for (const t of this.tracks){
            if (t.retained && !t.predecessor?.retained) this.begin(t, now, now, t.retained.start);
        }
        for (const t of this.tracks){
            if (t.retained) t.unseen = t.retained.unseen;
            t.retained = undefined;
        }
    }
    activateScene(scene, origin) {
        if (this.source !== 'clock' || scene === this.activeScene) return;
        if (scene && this.firstScreen.held() && this.tracks.some((t)=>t.first && t.a.scene === scene)) return;
        const previous = this.activeScene;
        this.activeScene = scene;
        const now = this.clock.now();
        const offset = this.tracks.some((t)=>t.first && t.a.scene === scene) ? this.firstScreen.offset : 0;
        this.sceneStartedAt = origin ?? now - offset;
        if (scene) this.firstScreen.offset = 0;
        for (const t of this.tracks){
            if (t.a.scene !== previous || t.startedAt === null) continue;
            if (t.hasExit) this.exit(t);
            else {
                const elapsed = now - t.startedAt;
                for (const layer of t.layers){
                    const w = layer.window, base = t.solved;
                    writeLayer(layer, w && base ? progressIn(elapsed, w.start - base.start, w.end - base.start) : 1, 0);
                }
                this.cancel(t);
                t.a.stopLoops();
                setPhase(t, 'idle');
            }
        }
        for (const t of this.tracks){
            if (t.a.scene !== scene || t.predecessor) continue;
            if (this.firstScreen.shown?.has(t.a)) this.reveal(t);
            else this.begin(t, now, this.sceneStartedAt);
        }
    }
    event(t, event) {
        if (t.primary) t.a.clockEvent({
            ...event,
            source: this.source
        });
    }
    measure(near) {
        const out = [];
        for (const track of this.tracks){
            if (!near(track.a)) continue;
            const r = track.a.getBoundingClientRect();
            out.push({
                track,
                top: r.top,
                bottom: r.bottom
            });
        }
        return out;
    }
    apply(measurements, vh, unit) {
        const now = this.clock.now();
        const held = this.firstScreen.held();
        for (const { track: t, top, bottom } of measurements){
            if (held && t.first) continue;
            const g = gates({
                top,
                bottom,
                vh,
                enterMargin: t.margins[0] * unit,
                exitMargin: t.margins[1] * unit,
                eye: t.eye,
                partial: t.partial
            });
            t.onScreen = g.onScreen;
            if (g.onScreen && (!t.predecessor || g.enter && !g.exit)) t.unseen = false;
            if (!t.measured) {
                t.measured = true;
                if (g.above && !t.eye) {
                    this.reveal(t);
                    t.unseen = true;
                    this.loops(t, g);
                    continue;
                }
                if (g.onScreen && !t.predecessor && this.firstScreen.shown?.has(t.a)) {
                    this.reveal(t);
                    this.loops(t, g);
                    continue;
                }
                if (t.first && !g.oversized && !t.eye && top >= 0 && bottom <= vh) {
                    this.begin(t, now, now - this.firstScreen.offset);
                    continue;
                }
            }
            this.step(t, g, now);
            this.loops(t, g);
        }
    }
    step(t, g, now) {
        const inGate = g.enter && !g.exit;
        if (t.predecessor) {
            if (t.startedAt !== null && !t.unseen && t.hasExit && (t.phase === 'entered' || t.phase === 'entering' && (t.startedAt ?? now) <= now) && g.exit && !g.enter) this.exit(t);
            else if (t.startedAt !== null && gateAction(t.phase, g.enter, g.exit, {
                hasExit: t.hasExit,
                replay: true
            }) === 'enter') this.begin(t, now, now, t.startedAt);
            return;
        }
        const pending = t.phase === 'waiting' || t.phase === 'entering' && (t.startedAt ?? 0) > now;
        if (pending && !inGate) {
            this.cancel(t);
            this.resetFollowers(t);
            setPhase(t, t.origin);
            for (const layer of t.layers)writeLayer(layer, 0, 0);
            return;
        }
        if (t.replay === 'on' && !t.hasExit && (t.phase === 'entered' || t.phase === 'entering') && !g.onScreen) {
            this.cancel(t);
            setPhase(t, 'idle');
            for (const layer of t.layers)writeLayer(layer, 0, 0);
            return;
        }
        const action = gateAction(t.phase, g.enter, g.exit, {
            hasExit: t.hasExit && !t.unseen,
            replay: true
        });
        if (action === 'enter') this.begin(t, now);
        else if (action === 'exit') this.exit(t);
    }
    loops(t, g) {
        if (!t.a.loopItems.length) return;
        const active = (t.phase === 'entered' || !t.layers.length) && g.onScreen;
        if (active && (!t.a.clocked || t.a.clockComplete)) t.a.startLoops(this.clock);
        else t.a.stopLoops();
    }
    cancel(t) {
        t.token++;
        if (t.running.length || t.startedAt !== null) this.event(t, {
            type: 'reset'
        });
        for (const a of t.running)a.cancel();
        t.running = [];
        t.startedAt = null;
    }
    reveal(t, start) {
        this.cancel(t);
        for (const layer of t.layers){
            clearLayer(layer);
            writeLayer(layer, 1, 0);
        }
        setPhase(t, 'entered');
        t.unseen = start === undefined;
        t.startedAt = start ?? Number.NEGATIVE_INFINITY;
        this.event(t, {
            type: 'reveal'
        });
        if (start !== undefined) this.resetFollowers(t);
        this.release(t, this.clock.now());
    }
    begin(t, now, origin = now, retainedStart) {
        const pred = t.predecessor;
        if (retainedStart === undefined && pred && pred.startedAt === null) {
            setPhase(t, 'waiting');
            return;
        }
        if (retainedStart === Number.NEGATIVE_INFINITY || retainedStart === undefined && pred?.startedAt === Number.NEGATIVE_INFINITY) {
            this.reveal(t);
            return;
        }
        const startAt = retainedStart ?? (pred ? pred.startedAt + t.lead : origin + (t.autonomous ? t.solved?.start ?? t.delay : t.delay));
        if (t.replay === 'once' && t.done) {
            this.reveal(t, startAt);
            if (t.autonomous) this.complete(t);
            return;
        }
        this.cancel(t);
        this.resetFollowers(t);
        t.measured = true;
        t.unseen = t.predecessor ? true : !t.onScreen;
        t.startedAt = startAt;
        setPhase(t, 'entering');
        const base = t.solved;
        const duration = base ? base.end - base.start : 600;
        this.event(t, {
            type: 'enter',
            start: startAt,
            duration
        });
        if (now >= startAt + duration) {
            for (const layer of t.layers){
                clearLayer(layer);
                writeLayer(layer, 1, 0);
            }
            this.complete(t);
            this.release(t, now);
            return;
        }
        if (!t.layers.length) {
            t.running.push(this.clock.add(t.a.animate(null, {
                duration,
                delay: startAt - now
            })));
        } else {
            for (const layer of t.layers){
                const w = layer.window;
                const duration = w ? w.end - w.start : 600;
                clearLayer(layer);
                const animation = layer.el.animate(layerKeyframes(layer, samplesFor(layer, duration)), {
                    duration,
                    delay: startAt - now + (w && base ? w.start - base.start : 0),
                    fill: 'both',
                    easing: 'linear'
                });
                t.running.push(this.clock.add(animation));
            }
        }
        const token = t.token;
        void Promise.all(t.running.map((a)=>a.finished)).then(()=>{
            if (t.token !== token) return;
            this.complete(t);
        }, NONE);
        this.release(t, now);
    }
    complete(t) {
        setPhase(t, 'entered');
        if (!t.done) {
            t.done = true;
            markDone(t.a, definition(t.a));
        }
        if (!t.a.loopItems.length) return;
        if (t.autonomous) {
            if (t.a.scene === this.activeScene && (!t.a.timed || t.a.timeline.phase === 'entered')) t.a.startLoops(this.clock);
        } else {
            const r = t.a.getBoundingClientRect();
            if (r.bottom > 0 && r.top < innerHeight && (!t.a.clocked || t.a.clockComplete)) t.a.startLoops(this.clock);
        }
    }
    release(t, now) {
        for (const f of this.tracks)if (f.predecessor === t) this.begin(f, now);
    }
    resetFollowers(t) {
        for (const f of this.tracks)if (f.predecessor === t) {
            this.cancel(f);
            setPhase(f, f.origin);
            for (const layer of f.layers)writeLayer(layer, 0, 0);
            this.resetFollowers(f);
        }
    }
    exit(t) {
        const base = t.solved;
        const startedAt = t.startedAt;
        const elapsed = startedAt === null ? 0 : this.clock.now() - startedAt;
        const frames = t.layers.map((layer)=>{
            const w = layer.window;
            const duration = w ? w.exitEnd - w.exitStart : base?.exitDuration ?? 0;
            const p = t.phase === 'entered' ? 1 : w && base ? progressIn(elapsed, w.start - base.start, w.end - base.start) : 1;
            return exitKeyframes(layer, samplesFor(layer, duration), p);
        });
        this.cancel(t);
        t.startedAt = startedAt;
        t.a.stopLoops();
        setPhase(t, 'exiting');
        const exitDuration = base?.exitDuration ?? 0;
        this.event(t, {
            type: 'exit',
            start: this.clock.now(),
            duration: exitDuration
        });
        t.origin = 'exited';
        if (!t.layers.length && exitDuration > 0) {
            t.running.push(this.clock.add(t.a.animate(null, {
                duration: exitDuration
            })));
        }
        for (const [index, layer] of t.layers.entries()){
            const w = layer.window;
            const duration = w ? w.exitEnd - w.exitStart : base?.exitDuration ?? 0;
            if (duration <= 0) {
                writeLayer(layer, 1, 1);
                continue;
            }
            clearLayer(layer);
            const animation = layer.el.animate(frames[index], {
                duration,
                delay: w && base ? w.exitStart - base.exitStart : 0,
                fill: 'both',
                easing: 'linear'
            });
            t.running.push(this.clock.add(animation));
        }
        const token = t.token;
        void Promise.all(t.running.map((a)=>a.finished)).then(()=>{
            if (t.token === token) setPhase(t, 'exited');
        }, NONE);
        if (!t.running.length) setPhase(t, 'exited');
    }
    destroy() {
        for (const t of this.tracks){
            if (!t.autonomous && t.startedAt !== null && (t.phase === 'entered' || t.phase === 'entering')) retainedRuns.set(t.a, {
                start: t.startedAt,
                unseen: t.unseen
            });
            this.cancel(t);
            for (const layer of t.layers)clearLayer(layer);
            t.a.stopLoops();
        }
        this.activeScene = null;
        this.tracks = [];
        this.byElement.clear();
    }
}
