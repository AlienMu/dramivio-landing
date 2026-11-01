import { parseMs, solveScene } from '../core/time.js';
import { ElementBase } from '../platform.js';
import { assignWindows } from '../render/layers.js';
import { CvStage } from './stage.js';
export class CvScene extends ElementBase {
    static observedAttributes = [
        'zone',
        'sequence',
        'stack',
        'covered',
        'track',
        'theme'
    ];
    stage = null;
    animates = new Set();
    solution = {
        entranceEnd: 0,
        total: 0,
        byIndex: [],
        errors: []
    };
    timed = [];
    clocks = [];
    ordered = [];
    shell = null;
    track = null;
    travel = 0;
    trackX = Number.NaN;
    trackRo = null;
    zoneHeight = null;
    veil = null;
    cover = null;
    coverProgress = Number.NaN;
    docTop = 0;
    height = 0;
    timeline = null;
    nativeAttached = false;
    active = false;
    zoneTime = Number.NaN;
    frameTime = Number.NaN;
    covered = false;
    inverts = new Set();
    isolation = null;
    nativePending = false;
    nativeGeneration = 0;
    get isZone() {
        return this.hasAttribute('zone') || this.isTrack;
    }
    get isTrack() {
        return this.getAttribute('track') === 'x';
    }
    get isStacked() {
        return this.hasAttribute('stack');
    }
    connectedCallback() {
        if (!this.shadowRoot) {
            const root = this.attachShadow({
                mode: 'open'
            });
            const style = document.createElement('style');
            style.textContent = ':host{display:block;position:relative}' + '.shell{position:relative;height:100%;min-height:inherit}' + ':host([zone]) .shell,:host([track=x]) .shell{position:sticky;top:0;height:100svh;min-height:0}' + '.track{display:contents}' + ':host([track=x]) .shell{overflow-x:clip}' + ':host([track=x]) .track{display:flex;width:max-content;height:100%}' + '.veil{display:none;position:absolute;inset:0;z-index:2147483647;background:var(--cv-veil,#000);opacity:0;pointer-events:none}' + ':host([stack][covered]) .veil{display:block}' + ':host([stack][covered=recede]){transform-origin:50% max(50%,calc(100% - 50svh))}';
            const shell = document.createElement('div');
            shell.className = 'shell';
            shell.setAttribute('part', 'shell');
            const track = document.createElement('div');
            track.className = 'track';
            track.setAttribute('part', 'track');
            track.append(document.createElement('slot'));
            const fixed = document.createElement('slot');
            fixed.name = 'cv-fixed';
            shell.append(track, fixed);
            const veil = document.createElement('div');
            veil.className = 'veil';
            root.append(style, shell, veil);
            this.shell = shell;
            this.track = track;
            this.veil = veil;
        }
        const stage = this.closest('cv-stage');
        if (stage instanceof CvStage) {
            this.stage = stage;
            stage.registerScene(this);
        } else if (stage) {
            void customElements.whenDefined('cv-stage').then(()=>{
                if (this.isConnected && !this.stage) this.connectedCallback();
            });
        }
    }
    attributeChangedCallback(name, before, after) {
        if (before === after) return;
        if (name === 'theme') this.stage?.themeChanged(this);
        else this.stage?.invalidate();
    }
    disconnectedCallback() {
        this.watchTrack(false);
        this.setZoneDuration(null);
        this.stage?.unregisterScene(this);
        this.stage = null;
    }
    setZoneDuration(total) {
        if (total !== null) {
            this.zoneHeight ??= [
                this.style.height,
                this.style.getPropertyPriority('height')
            ];
            this.style.height = `calc(100svh + ${total}px)`;
        } else if (this.zoneHeight) {
            this.style.setProperty('height', ...this.zoneHeight);
            this.zoneHeight = null;
        }
    }
    measureTravel() {
        if (!this.isTrack || !this.track || !this.shell) return 0;
        const skipped = this.style.contentVisibility;
        this.style.contentVisibility = 'visible';
        const travel = Math.max(0, this.track.offsetWidth - this.shell.offsetWidth);
        this.style.contentVisibility = skipped;
        return travel;
    }
    watchTrack(on) {
        if (!on) {
            this.trackRo?.disconnect();
            this.trackRo = null;
            return;
        }
        if (this.trackRo || !this.track || !this.shell) return;
        this.trackRo = new ResizeObserver(()=>{
            if (Math.abs(this.measureTravel() - this.travel) > 0.5) this.stage?.invalidate();
        });
        this.trackRo.observe(this.track);
        this.trackRo.observe(this.shell);
    }
    writeTrack(t) {
        const x = -Math.min(Math.max(t, 0), this.travel);
        if (x === this.trackX) return;
        this.trackX = x;
        this.track.style.translate = x ? `${x}px 0` : '';
    }
    clearTrack() {
        this.trackX = Number.NaN;
        this.track?.style.removeProperty('translate');
    }
    isolate(a, on) {
        if (on) this.inverts.add(a);
        else this.inverts.delete(a);
        if (this.inverts.size && !this.isolation) {
            this.isolation = document.createElement('style');
            this.isolation.textContent = ':host{isolation:isolate}';
            this.shadowRoot?.append(this.isolation);
        } else if (!this.inverts.size && this.isolation) {
            this.isolation.remove();
            this.isolation = null;
        }
    }
    registerAnimate(a) {
        this.animates.add(a);
        this.stage?.invalidate();
    }
    unregisterAnimate(a) {
        this.animates.delete(a);
        this.stage?.invalidate();
    }
    solve(exitsOnTimeline, report) {
        const forElement = (a)=>(message, code)=>report?.(message, a, code);
        this.ordered = [
            ...this.animates
        ].filter((a)=>!a.sourceRejected).sort((a, b)=>a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        this.timed = this.ordered.filter((a)=>a.timed);
        const sequence = this.getAttribute('sequence');
        this.solution = solveScene(this.timed.map((a)=>a.timeSpec('scene', forElement(a))), {
            sequence: sequence === null ? null : parseMs(sequence, 0, (m)=>report?.(m, this)),
            exitsOnTimeline,
            span: this.travel
        });
        for (const a of this.ordered)a.solved = null;
        this.timed.forEach((a, i)=>{
            a.solved = this.solution.byIndex[i] ?? null;
        });
        for (const a of this.ordered)assignWindows(a.layers, a.solved);
        this.clocks = this.ordered.filter((a)=>a.clocked);
        const clockSolution = solveScene(this.clocks.map((a)=>a.timeSpec('clock', forElement(a))), {
            sequence: sequence === null ? null : parseMs(sequence, 0, (m)=>report?.(m, this)),
            exitsOnTimeline: false
        });
        for (const a of this.ordered)a.clockSolved = null;
        this.clocks.forEach((a, i)=>{
            a.clockSolved = clockSolution.byIndex[i] ?? null;
            assignWindows(a.layers, a.clockSolved, 'clock');
        });
        const errors = this.solution.errors.map((error)=>({
                error,
                element: this.timed[error.index] ?? this
            }));
        errors.push(...clockSolution.errors.map((error)=>({
                error,
                element: this.clocks[error.index] ?? this
            })));
        return errors;
    }
}
