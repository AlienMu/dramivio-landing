import { watchText } from './watch.js';
const COPIED = [
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-stretch',
    'font-variant',
    'font-feature-settings',
    'font-variation-settings',
    'font-kerning',
    'font-optical-sizing',
    'letter-spacing',
    'word-spacing',
    'text-transform',
    'text-rendering',
    'color',
    '-webkit-text-fill-color',
    '-webkit-text-stroke',
    'background-image',
    'background-clip',
    '-webkit-background-clip',
    'text-shadow'
];
const NOT_TEXT = 'img,svg,video,canvas,iframe,picture,object,embed,input,textarea,select,button,math';
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const OPENING = /^[\p{Ps}\p{Pi}]+$/u;
const SPACE = /^\s+$/;
const union = (frags)=>{
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    for (const f of frags){
        l = Math.min(l, f.left);
        t = Math.min(t, f.top);
        r = Math.max(r, f.right);
        b = Math.max(b, f.bottom);
    }
    return {
        l,
        t,
        r,
        b
    };
};
export class TextSplit {
    host;
    unit;
    rebuild;
    axes;
    pieces = [];
    atRest = true;
    src;
    root;
    lines = [];
    shown = false;
    unwatch = null;
    raf = 0;
    constructor(host, slot, unit, rebuild, axes = []){
        this.host = host;
        this.unit = unit;
        this.rebuild = rebuild;
        this.axes = axes;
        const container = slot.parentNode;
        if (container instanceof HTMLElement) container.style.position = 'relative';
        this.src = document.createElement('div');
        this.src.setAttribute('part', 'split-source');
        slot.replaceWith(this.src);
        this.src.append(slot);
        this.root = document.createElement('div');
        this.root.setAttribute('aria-hidden', 'true');
        this.root.setAttribute('part', 'split');
        this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none';
        container.append(this.root);
    }
    mount() {
        const result = this.measure();
        if (typeof result === 'string') return result;
        if (!result.pieces.length) return 'there is no text to split';
        this.render(result);
        this.show(true);
        this.unwatch = watchText(this.host, ()=>this.schedule());
        return null;
    }
    show(on) {
        if (on === this.shown) return;
        this.shown = on;
        this.root.style.visibility = on ? '' : 'hidden';
        this.src.style.opacity = on ? '0' : '';
    }
    phase(phase) {
        this.show(!(phase === 'entered' || phase === 'exiting' || phase === 'exited') || !this.atRest);
    }
    progress(p) {
        this.show(p < 1 || !this.atRest);
    }
    destroy() {
        cancelAnimationFrame(this.raf);
        this.unwatch?.();
        this.unwatch = null;
    }
    measure() {
        const host = this.host;
        if (host.querySelector(NOT_TEXT)) return 'it contains more than text';
        const scene = host.closest('cv-scene');
        const skipped = scene?.style.contentVisibility ?? '';
        if (scene) scene.style.contentVisibility = 'visible';
        const suspended = this.suspendTransforms();
        try {
            return this.read();
        } finally{
            for (const undo of suspended)undo();
            if (scene) scene.style.contentVisibility = skipped;
        }
    }
    suspendTransforms() {
        const undos = [];
        for(let el = this.src.parentElement; el; el = el.parentElement){
            const style = el.style;
            for (const prop of [
                'transform',
                'translate',
                'rotate',
                'scale'
            ]){
                const value = style.getPropertyValue(prop);
                const priority = style.getPropertyPriority(prop);
                style.setProperty(prop, 'none', 'important');
                undos.push(()=>{
                    if (value) style.setProperty(prop, value, priority);
                    else style.removeProperty(prop);
                });
            }
        }
        return undos;
    }
    read() {
        const host = this.host;
        const source = this.src.getBoundingClientRect();
        const width = this.src.offsetWidth;
        const height = this.src.offsetHeight;
        if (!width || !height) return {
            pieces: [],
            lines: []
        };
        const sx = source.width / width;
        const sy = source.height / height;
        if (Math.abs(sx - sy) > 0.01 * Math.max(sx, sy)) return 'it is rotated or skewed';
        const scale = sx || 1;
        const origin = this.root.getBoundingClientRect();
        const hostStyle = getComputedStyle(host);
        if (hostStyle.writingMode !== 'horizontal-tb') return 'vertical writing is not supported';
        if (hostStyle.direction === 'rtl') return 'right-to-left text is not supported';
        const segmenter = new Intl.Segmenter(host.closest('[lang]')?.getAttribute('lang') || undefined, {
            granularity: 'word'
        });
        const graphemes = new Intl.Segmenter(undefined, {
            granularity: 'grapheme'
        });
        const styles = new Map();
        const styleOf = (el)=>{
            let css = styles.get(el);
            if (css !== undefined) return css;
            const cs = getComputedStyle(el);
            if (cs.visibility !== 'visible') css = null;
            else {
                css = '';
                for (const prop of COPIED)css += `${prop}:${cs.getPropertyValue(prop)};`;
                if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') {
                    const box = el.getBoundingClientRect();
                    css += `--cv-box:${(box.left - origin.left) / scale} ${(box.top - origin.top) / scale} ${box.width / scale} ${box.height / scale};`;
                }
            }
            styles.set(el, css);
            return css;
        };
        const issues = (el)=>{
            const cs = getComputedStyle(el);
            if (cs.writingMode !== 'horizontal-tb') return 'vertical writing is not supported';
            if (cs.direction === 'rtl') return 'right-to-left text is not supported';
            if (cs.textDecorationLine !== 'none') return 'text decoration is not supported';
            return null;
        };
        const checked = new Set();
        const frags = [];
        const range = document.createRange();
        const rectOf = (node, start, end)=>{
            range.setStart(node, start);
            range.setEnd(node, end);
            return [
                ...range.getClientRects()
            ].filter((r)=>r.width >= 0.5 && r.height > 0);
        };
        const box = (r)=>({
                left: (r.left - origin.left) / scale,
                top: (r.top - origin.top) / scale,
                right: (r.right - origin.left) / scale,
                bottom: (r.bottom - origin.top) / scale
            });
        let gap = true;
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        for(let node = walker.nextNode(); node; node = walker.nextNode()){
            const text = node.data;
            const parent = node.parentElement;
            if (!parent || !text.trim()) {
                if (text) gap = true;
                continue;
            }
            if (RTL.test(text)) return 'right-to-left text is not supported';
            if (!checked.has(parent)) {
                checked.add(parent);
                const issue = issues(parent);
                if (issue) return issue;
            }
            const css = styleOf(parent);
            if (css === null) {
                gap = true;
                continue;
            }
            for (const seg of segmenter.segment(text)){
                if (SPACE.test(seg.segment)) {
                    gap = true;
                    continue;
                }
                const end = seg.index + seg.segment.length;
                const rects = rectOf(node, seg.index, end);
                if (!rects.length) continue;
                const word = seg.isWordLike === true;
                const open = !word && OPENING.test(seg.segment);
                if (rects.length === 1) {
                    frags.push({
                        text: seg.segment,
                        ...box(rects[0]),
                        css,
                        word,
                        open,
                        gap
                    });
                } else {
                    let part = null;
                    for (const g of graphemes.segment(seg.segment)){
                        const at = seg.index + g.index;
                        const r = rectOf(node, at, at + g.segment.length)[0];
                        if (!r) continue;
                        const b = box(r);
                        if (part && Math.abs(b.top - part.top) < (part.bottom - part.top) / 2) {
                            part.text += g.segment;
                            part.right = Math.max(part.right, b.right);
                            part.bottom = Math.max(part.bottom, b.bottom);
                        } else {
                            if (part) frags.push(part);
                            part = {
                                text: g.segment,
                                ...b,
                                css,
                                word,
                                open,
                                gap: part ? true : gap
                            };
                        }
                    }
                    if (part) frags.push(part);
                }
                gap = false;
            }
        }
        const lines = [];
        const lineOf = (f)=>{
            const c = (f.top + f.bottom) / 2;
            const h = (f.bottom - f.top) / 2;
            const i = lines.findIndex((l)=>Math.abs(l.centre - c) < h);
            if (i >= 0) {
                const l = lines[i];
                l.top = Math.min(l.top, f.top);
                l.bottom = Math.max(l.bottom, f.bottom);
                return i;
            }
            lines.push({
                top: f.top,
                bottom: f.bottom,
                centre: c
            });
            return lines.length - 1;
        };
        const pieces = [];
        let opening = [];
        let openLine = -1;
        for (const f of frags){
            const line = lineOf(f);
            const last = pieces[pieces.length - 1];
            if (f.open) {
                if (openLine !== line) opening = [];
                opening.push(f);
                openLine = line;
                continue;
            }
            if (!f.word && !f.gap && last && last.line === line && !opening.length) {
                last.frags.push(f);
                continue;
            }
            pieces.push({
                frags: openLine === line ? [
                    ...opening,
                    f
                ] : [
                    f
                ],
                line
            });
            opening = [];
            openLine = -1;
        }
        if (opening.length) pieces.push({
            frags: opening,
            line: openLine
        });
        return {
            pieces,
            lines: lines.map(({ top, bottom })=>({
                    top,
                    bottom
                }))
        };
    }
    count(model) {
        return this.unit === 'lines' ? model.lines.length : model.pieces.length;
    }
    render(model) {
        if (!this.pieces.length) {
            if (this.unit === 'lines') {
                for(let i = 0; i < model.lines.length; i++){
                    const line = document.createElement('div');
                    const inner = document.createElement('div');
                    inner.style.cssText = 'position:absolute;inset:0';
                    line.append(inner);
                    this.root.append(line);
                    this.lines.push(line);
                    this.pieces.push(inner);
                }
            } else {
                for(let i = 0; i < model.pieces.length; i++){
                    const span = document.createElement('span');
                    span.style.position = 'absolute';
                    this.root.append(span);
                    this.pieces.push(span);
                }
            }
        }
        const last = this.pieces.length - 1;
        const slot = (i)=>Math.min(i, last);
        if (this.unit === 'lines') {
            const boxes = this.pieces.map(()=>({
                    top: Infinity,
                    bottom: -Infinity
                }));
            model.lines.forEach((l, i)=>{
                const box = boxes[slot(i)];
                box.top = Math.min(box.top, l.top);
                box.bottom = Math.max(box.bottom, l.bottom);
            });
            boxes.forEach((box, i)=>{
                const empty = box.top === Infinity;
                this.lines[i].style.cssText = `position:absolute;left:0;right:0;top:${empty ? 0 : box.top}px;height:${empty ? 0 : box.bottom - box.top}px;overflow:clip;overflow-clip-margin:.15em`;
                this.pieces[i].textContent = '';
            });
            for (const p of model.pieces){
                const k = slot(p.line);
                for (const f of p.frags)this.pieces[k].append(this.fragment(f, 0, boxes[k].top));
            }
        } else {
            const groups = this.pieces.map(()=>[]);
            model.pieces.forEach((p, i)=>groups[slot(i)].push(...p.frags));
            groups.forEach((frags, i)=>{
                const span = this.pieces[i];
                span.textContent = '';
                const { l, t, r, b } = frags.length ? union(frags) : {
                    l: 0,
                    t: 0,
                    r: 0,
                    b: 0
                };
                span.style.left = `${l}px`;
                span.style.top = `${t}px`;
                span.style.width = `${r - l}px`;
                span.style.height = `${b - t}px`;
                for (const f of frags)span.append(this.fragment(f, l, t));
            });
        }
    }
    fragment(f, left, top) {
        const span = document.createElement('span');
        span.textContent = f.text;
        let css = `position:absolute;white-space:pre;left:${f.left - left}px;top:${f.top - top}px;line-height:${f.bottom - f.top}px;${f.css}`;
        const m = /--cv-box:([^ ]+) ([^ ]+) ([^ ]+) ([^;]+);/.exec(f.css);
        if (m) {
            const [bl, bt, bw, bh] = m.slice(1).map(Number);
            css += `background-size:${bw}px ${bh}px;background-position:${bl - f.left}px ${bt - f.top}px;background-repeat:no-repeat;`;
        }
        span.style.cssText = css;
        if (this.axes.length) {
            const settings = new Map();
            for (const match of span.style.fontVariationSettings.matchAll(/["']([^"']{4})["']\s+(-?[\d.]+)/g)){
                settings.set(match[1], match[2]);
            }
            for (const name of this.axes)settings.set(name.slice('--cv-axis-'.length), `var(${name})`);
            span.style.fontVariationSettings = [
                ...settings
            ].map(([tag, value])=>`"${tag}" ${value}`).join(', ');
        }
        return span;
    }
    schedule() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(()=>{
            this.raf = 0;
            if (!this.host.isConnected) return;
            const result = this.measure();
            if (typeof result === 'string' || !result.pieces.length) return;
            if (this.rebuild && this.count(result) !== this.pieces.length) this.rebuild();
            else this.render(result);
        });
    }
}
