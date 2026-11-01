import { parseEase, settle } from '../core/ease.js';
import { warn } from '../dev/warn.js';
import { parseCovered, writeCardCover } from '../render/covered.js';
import { coverProgress, hides } from '../render/deck.js';
import { progressIn } from '../render/layers.js';
import { CvAnimate } from './animate.js';
const DECK_STYLE = ':host([data-cv-dealt]){display:grid}:host([data-cv-dealt]) ::slotted(*){grid-area:1/1}' + ':host([covered=recede]) ::slotted(*){transform-origin:50% 0}' + ':host([data-cv-veil]) ::slotted(*){position:relative}' + ':host([data-cv-veil]) ::slotted(*)::after{content:"";position:absolute;inset:0;border-radius:inherit;' + 'background:var(--cv-veil);opacity:var(--cv-cover,0);pointer-events:none}';
export class CvStack extends CvAnimate {
    static observedAttributes = [
        ...CvAnimate.observedAttributes,
        'step',
        'covered'
    ];
    dealt = false;
    cards = [];
    look = null;
    veil = '';
    step = 0;
    curve = settle;
    state = [];
    mo = null;
    connectedCallback() {
        super.connectedCallback();
        this.mo ??= new MutationObserver(()=>this.scene?.stage?.invalidate());
        this.mo.observe(this, {
            childList: true
        });
    }
    disconnectedCallback() {
        this.mo?.disconnect();
        super.disconnectedCallback();
    }
    timeSpec() {
        const spec = super.timeSpec();
        return {
            ...spec,
            duration: spec.duration * Math.max(0, this.cards.length - 1),
            exitDuration: 0,
            stagger: null
        };
    }
    plan(context, report) {
        this.dealt = context.timeSource === 'scene';
        const easeText = this.getAttribute('ease');
        const ease = parseEase(easeText);
        if (easeText !== null && !ease) report(`Unknown ease "${easeText}"`);
        this.curve = ease ?? settle;
        this.look = parseCovered(this.getAttribute('covered'), context.reducedMotion, report);
        this.veil = this.look ? getComputedStyle(this).getPropertyValue('--cv-veil').trim() : '';
        if (this.veil && [
            ...this.children
        ].some((card)=>card instanceof SVGElement || card.matches('img,video,canvas,iframe,object,embed,input,textarea,select'))) {
            report('--cv-veil requires HTML container cards, such as <article> or <div>; wrap media inside them. Using the default covered look.');
            this.veil = '';
        }
        const step = this.getAttribute('step');
        this.step = step === null ? 0 : parseFloat(step);
        if (!(this.step >= 0)) {
            report(`step="${step}": expected a distance in px such as 8`);
            this.step = 0;
        }
        return {
            layers: [],
            rules: [],
            fades: [],
            inks: [],
            counts: [],
            develop: null,
            invert: false,
            staggered: null,
            split: null,
            whole: null,
            timed: this.dealt,
            clocked: false,
            duration: 600,
            clockDuration: null,
            clockMaxDuration: Number.POSITIVE_INFINITY,
            maxDuration: Number.POSITIVE_INFINITY,
            hasExit: false,
            loops: []
        };
    }
    build(plan) {
        super.build(plan);
        this.toggleAttribute('data-cv-veil', this.veil !== '');
        const style = document.createElement('style');
        style.textContent = DECK_STYLE;
        this.shadowRoot.append(style);
        this.cards = [
            ...this.children
        ].filter((el)=>el instanceof HTMLElement || el instanceof SVGElement);
        if (false && this.cards.length < 2) {
            warn(this, 'a stack needs two or more cards (its element children) to stack.');
        }
        this.toggleAttribute('data-cv-dealt', this.dealt);
        this.cards.forEach((card, i)=>{
            if (this.dealt) {
                card.style.position = 'relative';
                card.style.top = `${i * this.step}px`;
                if (i > 0) card.style.translate = '0 100vh';
            } else {
                card.style.position = 'sticky';
                card.style.top = `calc(var(--cv-stack-top, 0px) + ${i * this.step}px)`;
            }
        });
    }
    release() {
        super.release();
        for (const card of this.cards){
            for (const p of [
                'position',
                'top',
                'translate',
                'scale',
                'filter',
                '--cv-cover',
                'visibility'
            ]){
                card.style.removeProperty(p);
            }
        }
        this.removeAttribute('data-cv-dealt');
        this.removeAttribute('data-cv-veil');
        this.state = [];
    }
    get followsScroll() {
        return !this.dealt && (this.look !== null || this.state.some((c)=>c.hidden));
    }
    measureDealt(top, vh) {
        this.clearWrites();
        this.state = this.cards.map((card)=>{
            const r = card.getBoundingClientRect();
            const box = {
                rest: r.top - top,
                height: r.height,
                left: r.left,
                width: r.width
            };
            return cardState(box, Math.max(0, vh - box.rest), 0);
        });
        this.link();
    }
    measureFlow(y) {
        this.clearWrites();
        for (const card of this.cards)card.style.position = 'static';
        const rects = this.cards.map((card)=>card.getBoundingClientRect());
        for (const card of this.cards)card.style.position = 'sticky';
        this.state = this.cards.map((card, i)=>{
            const r = rects[i];
            const rest = parseFloat(getComputedStyle(card).top) || 0;
            return cardState({
                rest,
                height: r.height,
                left: r.left,
                width: r.width
            }, 0, r.top + y);
        });
        this.link();
    }
    writeTime(t) {
        const w = this.solved;
        const n = this.state.length;
        if (!w || n < 2 || n !== this.cards.length) return;
        const each = (w.end - w.start) / (n - 1);
        this.place(this.state.map((c, k)=>{
            if (k === 0) return c.box.rest;
            const e = this.curve(progressIn(t, w.start + (k - 1) * each, w.start + k * each));
            return c.box.rest + (1 - e) * c.travel;
        }), true);
    }
    writeScroll(y) {
        if (this.state.length !== this.cards.length) return;
        this.place(this.state.map((c)=>Math.max(c.flow - y, c.box.rest)), false);
    }
    clearWrites() {
        for (const card of this.cards){
            for (const p of [
                'translate',
                'scale',
                'filter',
                '--cv-cover',
                'visibility'
            ])card.style.removeProperty(p);
        }
        for (const c of this.state){
            c.shift = c.cover = Number.NaN;
            c.off = false;
        }
    }
    link() {
        this.state.forEach((c, k)=>{
            const next = this.state[k + 1];
            c.hidden = next ? hides(c.box, next.box) : false;
        });
    }
    place(tops, move) {
        this.state.forEach((c, k)=>{
            const card = this.cards[k];
            if (move) {
                const shift = tops[k] - c.box.rest;
                if (shift !== c.shift) {
                    c.shift = shift;
                    card.style.translate = shift ? `0 ${shift}px` : '';
                }
            }
            const next = this.state[k + 1];
            const nextTop = tops[k + 1] ?? Number.POSITIVE_INFINITY;
            const cover = next ? coverProgress(c.box, next.box.rest, nextTop) : 0;
            if (this.look && cover !== c.cover) {
                c.cover = cover;
                writeCardCover(card, this.look, cover, this.veil !== '');
            }
            const off = !!next && c.hidden && nextTop <= next.box.rest + 0.5;
            if (off !== c.off) {
                c.off = off;
                card.style.visibility = off ? 'hidden' : '';
            }
        });
    }
}
const cardState = (box, travel, flow)=>({
        box,
        travel,
        flow,
        hidden: false,
        shift: Number.NaN,
        cover: Number.NaN,
        off: false
    });
