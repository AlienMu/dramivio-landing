import { cubicBezier } from '../core/ease.js';
import { viewProgress } from '../core/view.js';
import { blink } from '../platform.js';
import { clearCover, writeCover } from '../render/covered.js';
import { progressIn, writeLayer } from '../render/layers.js';
import { cancelDuration, DEFAULT_THRESHOLD, mapDrag, parseMapping, parseThreshold, shouldCommit, slideDuration } from './drag-rules.js';
import { isSignal, Signals, writeSignal } from './signals.js';
const INTERACTIVE = 'a,button,input,textarea,select,option,summary,[contenteditable=""],[contenteditable="true"],[role=button],cv-pause,[data-cv-ignore-drag],[data-cineview-ignore-drag]';
const TYPING = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';
const VELOCITY_WINDOW_MS = 100;
const easeOut = cubicBezier(0, 0, 0.58, 1);
const linear = (t)=>t;
const tweenAt = (tw, now)=>{
    if (tw.duration <= 0) return tw.to;
    const k = Math.min(1, Math.max(0, (now - tw.t0) / tw.duration));
    return tw.from + (tw.to - tw.from) * tw.ease(k);
};
const tweenDone = (tw, now)=>now - tw.t0 >= tw.duration;
const resumed = (tw, value, now, realTime)=>{
    const span = Math.abs(tw.to - tw.from);
    const left = Math.abs(tw.to - value);
    return {
        ...tw,
        from: value,
        t0: now,
        duration: realTime ? left : span > 0 ? tw.duration * left / span : 0
    };
};
export function createDragEngine(stage, start) {
    return new DragInput(stage, start);
}
class DragInput {
    stage;
    scenes;
    vh;
    index = 0;
    pos = 0;
    times;
    heads;
    frozenHeads = false;
    lane = null;
    press = null;
    session = false;
    suppressClick = false;
    raf = 0;
    destroyed = false;
    transition;
    threshold;
    mapping;
    inWindow = [];
    departed = new Map();
    tickSource = null;
    reported = 0;
    local = new Map();
    signals = new Signals();
    hasSignals;
    restoreScenes = [];
    constructor(stage, resumeAt){
        this.stage = stage;
        this.scenes = stage.ordered;
        this.vh = stage.clientHeight || window.innerHeight;
        this.hasSignals = this.scenes.some((s)=>s.ordered.some((a)=>a.layers.some((l)=>isSignal(l.source))));
        this.times = this.scenes.map(()=>0);
        this.heads = this.scenes.map(()=>null);
        this.transition = Math.max(0, Number(stage.getAttribute('transition-duration') ?? 800) || 0);
        this.threshold = parseThreshold(stage.getAttribute('threshold'), DEFAULT_THRESHOLD, (m)=>stage.report(m, stage));
        const root = parseMapping(stage.getAttribute('unit'), stage.getAttribute('scale'), {
            unit: 'time',
            scale: 10
        });
        this.mapping = root.mapping;
        const invalid = 'unit/scale: expected unit="time|percent" and a scale >= 0';
        if (root.invalid) stage.report(invalid, stage, 'invalid-drag-config');
        for (const s of this.scenes){
            parseThreshold(s.getAttribute('threshold'), this.threshold, (m)=>stage.report(m, s));
            if (parseMapping(s.getAttribute('unit'), s.getAttribute('scale'), this.mapping).invalid) {
                stage.report(invalid, s, 'invalid-drag-config');
            }
        }
        if (!stage.hasAttribute('role')) stage.setAttribute('role', 'region');
        if (!stage.hasAttribute('aria-roledescription')) {
            stage.setAttribute('aria-roledescription', 'carousel');
        }
        if (!stage.hasAttribute('tabindex')) stage.tabIndex = 0;
        for (const s of this.scenes){
            const styles = [
                'position',
                'top',
                'right',
                'bottom',
                'left',
                'height',
                'overflow-x',
                'overflow-y',
                'clip-path',
                'will-change',
                'translate',
                'content-visibility',
                'visibility'
            ].map((p)=>[
                    p,
                    s.style.getPropertyValue(p),
                    s.style.getPropertyPriority(p)
                ]);
            const attrs = [
                'inert',
                'aria-hidden'
            ].map((p)=>[
                    p,
                    s.getAttribute(p)
                ]);
            this.restoreScenes.push(()=>{
                for (const [p, value, priority] of styles)s.style.setProperty(p, value, priority);
                for (const [p, value] of attrs){
                    if (value === null) s.removeAttribute(p);
                    else s.setAttribute(p, value);
                }
            });
            Object.assign(s.style, {
                position: 'absolute',
                inset: '0',
                height: '100%',
                ...blink ? {
                    overflow: 'clip'
                } : {
                    clipPath: 'inset(0)'
                },
                willChange: 'translate'
            });
        }
        const start = resumeAt !== undefined ? Math.min(resumeAt, this.scenes.length - 1) : this.sceneFor(decodeURIComponent(location.hash.slice(1)));
        this.index = this.pos = Math.max(0, start ?? 0);
        this.reported = this.pos;
        stage.setCurrent(this.index);
        stage.addEventListener('pointerdown', this.onDown);
        stage.addEventListener('pointermove', this.onMove);
        stage.addEventListener('click', this.onClick, true);
        window.addEventListener('hashchange', this.onHash);
        stage.addEventListener('keydown', this.onKey);
        window.addEventListener('pointerup', this.onUp);
        window.addEventListener('pointercancel', this.onCancel);
        window.addEventListener('resize', this.onResize, {
            passive: true
        });
        const first = this.index;
        const gate = stage.firstScreen;
        if (resumeAt !== undefined) {
            this.times[first] = this.total(first);
        } else if (gate?.held) {
            gate.whenReleased(()=>{
                if (this.destroyed || this.index !== first || this.press?.owning || this.lane) return;
                if (this.heads[first]) return;
                this.play(first, 0, this.total(first));
                this.loop();
            });
        } else {
            const offset = Math.min(stage.bootOffset, this.total(first));
            this.times[first] = offset;
            this.play(first, offset, this.total(first));
        }
        this.refresh();
        this.loop();
    }
    currentIndex() {
        return this.index;
    }
    refresh() {
        this.vh = this.stage.clientHeight || window.innerHeight;
        this.local.clear();
        for (const s of this.scenes){
            if (!s.cover || s.cover.scale === 1) continue;
            s.style.scale = '';
            s.coverProgress = Number.NaN;
        }
        for (const s of this.scenes){
            const base = s.getBoundingClientRect().top;
            for (const a of s.ordered){
                if (isDeck(a)) a.measureDealt(base, this.vh);
                for (const l of a.layers){
                    if (l.source !== 'view' || l.subject === 'scene') continue;
                    const subject = a.viewSubject(l);
                    if (subject === s || this.local.has(subject)) continue;
                    const r = subject.getBoundingClientRect();
                    this.local.set(subject, {
                        top: r.top - base,
                        height: r.height
                    });
                }
            }
        }
        this.applyWindow();
        this.write();
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        cancelAnimationFrame(this.raf);
        this.stage.removeEventListener('pointerdown', this.onDown);
        this.stage.removeEventListener('pointermove', this.onMove);
        this.stage.removeEventListener('click', this.onClick, true);
        window.removeEventListener('hashchange', this.onHash);
        this.stage.removeEventListener('keydown', this.onKey);
        window.removeEventListener('pointerup', this.onUp);
        window.removeEventListener('pointercancel', this.onCancel);
        window.removeEventListener('resize', this.onResize);
        for (const s of this.scenes){
            for (const a of s.ordered){
                a.stopLoops();
                a.dragActive = undefined;
                if (isDeck(a)) a.clearWrites();
            }
            this.cover(s, false);
            s.removeAttribute('data-cv-stuck');
            if (s.cover) clearCover(s, s.veil);
            s.coverProgress = Number.NaN;
            s.clearTrack();
            s.active = false;
            s.removeAttribute('data-cv-active');
        }
        for (const restore of this.restoreScenes)restore();
        this.endSession('cancel');
    }
    goTo(target, options = {}) {
        target = Math.max(0, Math.min(this.scenes.length - 1, Math.round(target)));
        if (this.press?.owning) return;
        if (target === this.index && !this.lane) return;
        this.endSession('cancel');
        if (this.destroyed) return;
        this.lane = null;
        this.frozenHeads = false;
        const from = this.index;
        if (options.animated === false || this.transition === 0) {
            this.heads = this.heads.map(()=>null);
            this.times = this.times.map((_, i)=>i === target ? this.total(i) : 0);
            this.pos = this.reported = target;
            this.switchTo(target, from);
            this.write();
            return;
        }
        const side = target > this.index ? 1 : -1;
        if (Math.abs(target - this.index) > 1) {
            for(let i = Math.min(from, target) + 1; i < Math.max(from, target); i++){
                this.departed.set(i, side);
                this.times[i] = this.total(i);
                this.heads[i] = null;
            }
            this.index = target - side;
            this.pos = this.reported = this.index;
            this.applyWindow();
        }
        this.times[target] = 0;
        this.play(target, 0, this.total(target));
        this.lane = {
            kind: 'goto',
            page: {
                from: this.pos,
                to: target,
                t0: performance.now(),
                duration: slideDuration(target - this.pos, this.transition),
                ease: easeOut
            },
            target,
            from,
            frozen: false
        };
        this.loop();
    }
    onResize = ()=>this.refresh();
    onDown = (e)=>{
        if (e.button !== 0 || e.isPrimary === false || e.defaultPrevented) return;
        const target = e.target;
        this.suppressClick = false;
        if (target.closest?.(INTERACTIVE)) return;
        if (this.press) this.release(this.press);
        const froze = this.freeze();
        this.press = {
            id: e.pointerId,
            x0: e.clientX,
            startY: e.clientY,
            startTime: e.timeStamp,
            y0: e.clientY,
            y: e.clientY,
            t: e.timeStamp,
            v: 0,
            owning: false,
            rejected: new Set(),
            froze,
            target,
            base: 0,
            baseline: null,
            blocked: new Set(),
            cancelled: false
        };
    };
    onMove = (e)=>{
        const p = this.press;
        if (!p || e.pointerId !== p.id) return;
        if (!p.owning) {
            const dy = e.clientY - p.y0;
            const dx = e.clientX - p.x0;
            if (Math.abs(dy) < 1 || Math.abs(dy) <= Math.abs(dx)) return;
            const side = dy < 0 ? 1 : -1;
            if (p.rejected.has(side)) return;
            if (!this.mayDrag(side, p)) {
                p.rejected.add(side);
                return;
            }
            p.owning = true;
            p.y0 += Math.sign(dy);
            p.y = p.y0;
            this.takeOver(p);
            p.target.setPointerCapture?.(p.id);
            if (!this.session) {
                this.session = true;
                this.emit('cv-dragstart', {
                    index: this.index,
                    direction: side === 1 ? 'forward' : 'backward'
                });
            }
        }
        const dt = Math.max(e.timeStamp - p.t, 1);
        p.v = -(e.clientY - p.y) / dt * 1000;
        p.y = e.clientY;
        p.t = e.timeStamp;
        this.follow(p);
        if (e.cancelable) e.preventDefault();
    };
    onUp = (e)=>{
        const p = this.press;
        if (p && e.pointerId === p.id) this.release(p);
    };
    onCancel = (e)=>{
        const p = this.press;
        if (!p || e.pointerId !== p.id) return;
        p.cancelled = true;
        this.release(p);
    };
    onClick = (e)=>{
        if (this.suppressClick) {
            this.suppressClick = false;
            if (e.detail !== 0) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }
        }
        const link = e.target.closest?.('a[href^="#"]');
        if (!link || e.defaultPrevented) return;
        const href = link.getAttribute('href');
        const scene = this.sceneFor(decodeURIComponent(href.slice(1)));
        if (scene === null) return;
        e.preventDefault();
        history.pushState(null, '', href);
        this.goTo(scene);
    };
    onHash = ()=>{
        let scene = null;
        try {
            scene = this.sceneFor(decodeURIComponent(location.hash.slice(1)));
        } catch  {}
        if (scene !== null && scene !== this.index) this.goTo(scene);
    };
    onKey = (e)=>{
        if (e.defaultPrevented || this.press?.owning) return;
        if (e.target.closest?.(TYPING)) return;
        const last = this.scenes.length - 1;
        const to = e.key === 'ArrowDown' || e.key === 'PageDown' ? this.index + 1 : e.key === 'ArrowUp' || e.key === 'PageUp' ? this.index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
        if (to === null) return;
        e.preventDefault();
        if (to >= 0 && to <= last && to !== this.index) this.goTo(to);
    };
    mayDrag(side, p) {
        const travel = this.pos - this.index;
        if (p.froze && travel !== 0 && Math.sign(travel) === -side) return true;
        const next = this.index + side;
        if (next < 0 || next >= this.scenes.length) return false;
        const scene = this.scenes[next];
        if (scene.getAttribute('drag') === 'off') {
            if (!p.blocked.has(side)) {
                p.blocked.add(side);
                this.emit('cv-dragblocked', {
                    index: this.index,
                    target: next,
                    direction: side === 1 ? 'forward' : 'backward'
                });
            }
            return false;
        }
        const current = this.scenes[this.index];
        for(let el = p.target; el && el !== current; el = el.parentElement){
            if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
            const overflow = getComputedStyle(el).overflowY;
            if (overflow !== 'auto' && overflow !== 'scroll') continue;
            const canScroll = side === 1 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
            if (canScroll) return false;
        }
        return true;
    }
    freeze() {
        const now = performance.now();
        let froze = false;
        if (this.lane && !this.lane.frozen) {
            this.pos = tweenAt(this.lane.page, now);
            this.lane.frozen = true;
            froze = true;
        }
        if (this.heads.some(Boolean) && !this.frozenHeads) {
            this.heads.forEach((h, i)=>{
                if (h) this.times[i] = tweenAt(h, now);
            });
            this.frozenHeads = true;
            froze = true;
        }
        return froze;
    }
    resume() {
        const now = performance.now();
        if (this.lane?.frozen) {
            const lane = this.lane;
            lane.frozen = false;
            lane.page = resumed(lane.page, this.pos, now, false);
        }
        if (this.frozenHeads) {
            this.frozenHeads = false;
            this.heads = this.heads.map((h, i)=>h ? resumed(h, this.times[i] ?? 0, now, h.ease === linear) : null);
        }
        this.loop();
    }
    takeOver(p) {
        this.stage.firstScreen?.preempt();
        p.base = this.pos - this.index;
        this.lane = null;
        this.heads = this.heads.map(()=>null);
        this.frozenHeads = false;
        const side = p.base >= 0 ? 1 : -1;
        const incoming = this.index + side;
        if (p.base !== 0 && incoming >= 0 && incoming < this.scenes.length) {
            p.baseline = {
                scene: incoming,
                time: this.times[incoming] ?? 0,
                ratio: Math.abs(p.base)
            };
        }
        this.loop();
    }
    follow(p) {
        const last = this.scenes.length - 1;
        let r = p.base - (p.y - p.y0) / this.vh;
        if (this.index === 0 && r < 0 || this.index === last && r > 0) r = 0;
        const blocked = (side)=>this.scenes[this.index + side]?.getAttribute('drag') === 'off';
        if (r > 0 && blocked(1) || r < 0 && blocked(-1)) r = 0;
        r = Math.max(-1, Math.min(1, r));
        this.pos = this.index + r;
        for (const side of [
            1,
            -1
        ]){
            const k = this.index + side;
            if (k < 0 || k > last) continue;
            const fraction = Math.sign(r) === side ? Math.abs(r) : 0;
            const b = p.baseline?.scene === k ? p.baseline : null;
            const mapping = this.mappingFor(k);
            const total = this.total(k);
            this.times[k] = b ? Math.min(total, Math.max(0, b.time + mapDrag(fraction, total, mapping) - mapDrag(b.ratio, total, mapping))) : mapDrag(fraction, total, mapping);
        }
        this.loop();
    }
    release(p) {
        this.press = null;
        if (!p.owning) {
            if (p.froze) this.resume();
            return;
        }
        this.suppressClick = true;
        const now = performance.now();
        const v = now - p.t > VELOCITY_WINDOW_MS ? 0 : p.v;
        const r = this.pos - this.index;
        const scene = this.scenes[this.index];
        const authored = scene?.getAttribute('threshold') ?? null;
        const threshold = authored !== null || this.stage.hasAttribute('threshold') ? parseThreshold(authored, this.threshold, (m)=>this.stage.report(m, scene ?? this.stage)) : null;
        if (r !== 0 && shouldCommit(r, v, threshold, p.cancelled, {
            duration: now - p.startTime,
            displacement: p.startY - p.y,
            viewport: this.vh
        })) {
            const target = this.index + (r > 0 ? 1 : -1);
            this.lane = {
                kind: 'commit',
                page: {
                    from: this.pos,
                    to: target,
                    t0: now,
                    duration: slideDuration(target - this.pos, this.transition),
                    ease: easeOut
                },
                target,
                from: this.index,
                frozen: false,
                detail: {
                    progress: Math.abs(r),
                    direction: r > 0 ? 'forward' : 'backward',
                    elapsed: this.times[target] ?? 0,
                    total: this.total(target)
                }
            };
            this.play(target, this.times[target] ?? 0, this.total(target));
        } else {
            const duration = cancelDuration(r, this.transition);
            this.lane = {
                kind: 'cancel',
                page: {
                    from: this.pos,
                    to: this.index,
                    t0: now,
                    duration,
                    ease: easeOut
                },
                target: this.index,
                from: this.index,
                frozen: false,
                detail: {
                    progress: Math.abs(r),
                    direction: r > 0 ? 'forward' : r < 0 ? 'backward' : null
                }
            };
            for (const side of [
                1,
                -1
            ]){
                const k = this.index + side;
                const time = this.times[k] ?? 0;
                if (time > 0) this.heads[k] = {
                    from: time,
                    to: 0,
                    t0: now,
                    duration,
                    ease: easeOut
                };
            }
        }
        this.loop();
    }
    total(i) {
        return this.scenes[i]?.solution.total ?? 0;
    }
    mappingFor(i) {
        const s = this.scenes[i];
        if (!s) return this.mapping;
        return parseMapping(s.getAttribute('unit'), s.getAttribute('scale'), this.mapping).mapping;
    }
    play(i, from, to) {
        this.heads[i] = {
            from,
            to,
            t0: performance.now(),
            duration: Math.abs(to - from),
            ease: linear
        };
    }
    sceneFor(id) {
        return this.stage.sceneIndexOf(id);
    }
    loop = ()=>{
        if (this.destroyed || this.raf) return;
        this.raf = requestAnimationFrame(this.tick);
    };
    tick = ()=>{
        this.raf = 0;
        const now = performance.now();
        this.tickSource = this.source();
        let busy = this.press?.owning ?? false;
        const lane = this.lane;
        if (lane && !lane.frozen) {
            this.pos = tweenAt(lane.page, now);
            if (tweenDone(lane.page, now)) {
                this.pos = lane.target;
                this.lane = null;
                this.reportProgress();
                if (this.destroyed) return;
                this.land(lane);
                if (this.destroyed) return;
                this.reported = this.pos;
            } else busy = true;
        }
        this.reportProgress();
        if (this.destroyed) return;
        if (!this.frozenHeads) {
            for(let i = 0; i < this.heads.length; i++){
                const h = this.heads[i];
                if (!h) continue;
                this.times[i] = tweenAt(h, now);
                if (tweenDone(h, now)) this.heads[i] = null;
                else busy = true;
            }
        }
        if (this.signals.sample(this.pos * this.vh, now)) {
            this.stage.setHeading(this.signals.heading > 0 ? 'forward' : 'backward');
        }
        this.signals.step(now);
        this.write();
        this.tickSource = null;
        if (busy || this.hasSignals && !this.signals.resting) this.loop();
    };
    land(lane) {
        if (lane.kind === 'cancel') {
            this.endSession('cancel', lane.detail);
            return;
        }
        this.switchTo(lane.target, lane.from);
        if (lane.kind === 'commit') {
            this.endSession('end', lane.detail && {
                ...lane.detail,
                from: lane.from,
                to: lane.target
            });
        }
    }
    switchTo(target, from) {
        const previous = this.index;
        this.index = target;
        if (previous !== target) {
            this.times[previous] = 0;
            this.heads[previous] = null;
            this.departed.set(previous, target > previous ? 1 : -1);
        }
        this.departed.delete(target);
        this.applyWindow();
        if (from !== target) {
            this.stage.setCurrent(target);
            this.stage.announceCurrent();
        }
    }
    endSession(kind, detail) {
        if (!this.session) return;
        if (!detail) {
            const travel = this.pos - this.index;
            detail = {
                progress: Math.min(1, Math.abs(travel)),
                direction: travel > 0 ? 'forward' : travel < 0 ? 'backward' : null
            };
        }
        this.session = false;
        this.emit(kind === 'end' ? 'cv-dragend' : 'cv-dragcancel', {
            index: this.index,
            ...detail
        });
    }
    reportProgress() {
        if (this.pos === this.reported) return;
        this.reported = this.pos;
        const travel = this.pos - this.index;
        this.emit('cv-progress', {
            kind: 'page',
            index: this.index,
            progress: Math.min(1, Math.abs(travel)),
            direction: travel > 0 ? 'forward' : travel < 0 ? 'backward' : null
        });
    }
    emit(type, detail) {
        this.stage.dispatchEvent(new CustomEvent(type, {
            bubbles: true,
            detail
        }));
    }
    applyWindow() {
        this.scenes.forEach((s, i)=>{
            const inWindow = Math.abs(i - this.index) <= 1;
            const active = i === this.index;
            s.toggleAttribute('inert', !active);
            if (active) s.removeAttribute('aria-hidden');
            else s.setAttribute('aria-hidden', 'true');
            s.style.contentVisibility = inWindow ? 'visible' : 'hidden';
            if (!inWindow) {
                s.style.translate = `0 ${(i - this.pos) * this.vh}px`;
                const behind = s.isStacked && i < this.index;
                this.cover(s, behind);
                this.coverLook(s, behind ? 1 : 0);
                s.removeAttribute('data-cv-stuck');
            }
            s.toggleAttribute('data-cv-active', inWindow);
            for (const a of s.ordered)a.dragActive = active;
            if (!inWindow) {
                for (const a of s.ordered)a.stopLoops();
                this.times[i] = 0;
                this.heads[i] = null;
            }
            if (this.inWindow[i] !== inWindow) {
                this.inWindow[i] = inWindow;
                if (inWindow) {
                    const top = s.getBoundingClientRect().top;
                    for (const a of s.ordered)if (isDeck(a)) a.measureDealt(top, this.vh);
                }
                s.active = inWindow;
                for (const a of s.ordered)a.activated(inWindow);
                s.dispatchEvent(new CustomEvent(inWindow ? 'cv-activate' : 'cv-deactivate', {
                    bubbles: true
                }));
            }
        });
    }
    write() {
        const vh = this.vh;
        const lo = Math.max(0, Math.floor(this.pos) - 1);
        const hi = Math.min(this.scenes.length - 1, Math.ceil(this.pos) + 1);
        const travel = this.pos - this.index;
        const eye = Math.round(this.pos);
        if (eye !== this.stage.eye) this.stage.showTheme(eye);
        for(let i = lo; i <= hi; i++){
            const s = this.scenes[i];
            const held = s.isStacked && this.pos > i;
            const offset = held ? 0 : (i - this.pos) * vh;
            s.style.translate = `0 ${offset}px`;
            s.toggleAttribute('data-cv-stuck', held && this.pos < i + 1);
            this.cover(s, held && this.pos >= i + 1);
            this.coverLook(s, held ? Math.min(1, this.pos - i) : 0);
            const t = this.times[i] ?? 0;
            if (s.isTrack) s.writeTrack(t);
            const departure = i === this.index && travel !== 0 ? Math.min(1, Math.abs(travel)) * this.transition : 0;
            const side = travel >= 0 ? 1 : -1;
            if (t > 0) this.departed.delete(i);
            for (const a of s.ordered){
                this.writeAnimate(a, t, offset, departure, side);
                if (isDeck(a)) a.writeTime(t);
                if (a.timed) {
                    if (a.subscribed) a.sendFrame(this.frameFor(a, i, t, travel));
                    else a.showPhase(this.phaseFor(a, i, t, travel));
                }
                if (a.loopItems.length && (!a.clocked || a.timed)) {
                    if (!s.covered && (!a.clocked || a.timed && a.clockComplete) && (!a.solved || t >= a.solved.end)) a.startLoops(this.stage.clock);
                    else a.stopLoops();
                }
            }
        }
    }
    cover(s, on) {
        if (s.covered === on) return;
        s.covered = on;
        s.toggleAttribute('data-cv-covered', on);
        s.style.visibility = on ? 'hidden' : '';
        if (on) for (const a of s.ordered)a.stopLoops();
    }
    coverLook(s, p) {
        if (!s.cover || p === s.coverProgress) return;
        s.coverProgress = p;
        writeCover(s, s.veil, s.cover, p);
    }
    source() {
        if (this.tickSource) return this.tickSource;
        if (this.press?.owning) return 'gesture';
        if (this.lane) return this.lane.kind === 'goto' ? 'programmatic' : 'continuation';
        return this.heads.some(Boolean) ? 'continuation' : 'idle';
    }
    frameFor(a, i, t, travel) {
        const source = this.source();
        const phase = this.phaseFor(a, i, t, travel);
        if (phase === 'exiting') {
            const progress = Math.min(1, Math.abs(travel));
            return {
                progress,
                signedProgress: Math.sign(travel) * progress,
                phase,
                source
            };
        }
        if (phase === 'exited') {
            return {
                progress: 1,
                signedProgress: this.departed.get(i),
                phase,
                source
            };
        }
        const w = a.solved;
        const p = w ? progressIn(t, w.start, w.end) : t > 0 ? 1 : 0;
        return {
            progress: p,
            signedProgress: p,
            phase,
            source
        };
    }
    phaseFor(a, i, t, travel) {
        if (i === this.index && travel !== 0) return 'exiting';
        if (t === 0 && this.departed.has(i)) return 'exited';
        const w = a.solved;
        const p = w ? progressIn(t, w.start, w.end) : t > 0 ? 1 : 0;
        if (p >= 1) return 'entered';
        return p > 0 || i === this.index || Math.abs(this.pos - i) < 1 ? 'entering' : 'idle';
    }
    frameOf(a) {
        const i = a.scene ? this.scenes.indexOf(a.scene) : -1;
        if (i < 0 || this.destroyed || !a.timed) return null;
        return this.frameFor(a, i, this.times[i] ?? 0, this.pos - this.index);
    }
    writeAnimate(a, t, offset, departure, side) {
        const base = a.solved;
        const exitDuration = base?.exitDuration ?? 0;
        for (const layer of a.layers){
            if (layer.source === 'clock') continue;
            if (isSignal(layer.source)) {
                writeSignal(layer, this.signals);
                continue;
            }
            if (layer.source === 'page') {
                const last = this.scenes.length - 1;
                writeLayer(layer, last > 0 ? Math.min(1, Math.max(0, this.pos / last)) : 0, 0);
                continue;
            }
            if (layer.source === 'view') {
                const g = layer.subject === 'scene' ? undefined : this.local.get(a.viewSubject(layer));
                const top = offset + (g?.top ?? 0);
                writeLayer(layer, viewProgress(top, g?.height ?? this.vh, this.vh, layer.range), 0);
                continue;
            }
            const w = layer.window;
            if (!w || !base) continue;
            let p = progressIn(t, w.start, w.end);
            let px = 0;
            if (departure > 0 && exitDuration > 0) {
                if (side === 1) {
                    px = layer.exitEffects.length ? progressIn(departure, w.exitStart - base.exitStart, w.exitEnd - base.exitStart) : 0;
                } else {
                    p *= 1 - Math.min(1, departure / exitDuration);
                }
            }
            writeLayer(layer, p, px);
        }
    }
}
const isDeck = (a)=>a.localName === 'cv-stack';
