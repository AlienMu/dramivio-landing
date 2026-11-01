export const IDENTITY = {
    x: 0,
    y: 0,
    xp: 0,
    yp: 0,
    xw: 0,
    scale: 1,
    sx: 1,
    sy: 1,
    rotate: 0,
    rx: 0,
    ry: 0,
    skx: 0,
    sky: 0,
    opacity: 1,
    blur: 0,
    draw: 1,
    count: 1
};
export const NO_CLIP = [
    0,
    0,
    0,
    0
];
export const identityFrame = ()=>({
        ...IDENTITY,
        clip: null,
        vars: new Map()
    });
export function isRest(frame) {
    for(const key in IDENTITY){
        if (frame[key] !== IDENTITY[key]) return false;
    }
    return !frame.clip || frame.clip.every((v)=>v === 0);
}
export function resetFrame(frame) {
    frame.x = frame.y = frame.xp = frame.yp = frame.xw = 0;
    frame.rotate = frame.rx = frame.ry = frame.skx = frame.sky = frame.blur = 0;
    frame.scale = frame.sx = frame.sy = frame.opacity = frame.draw = frame.count = 1;
    frame.clip = null;
    if (frame.vars.size) frame.vars.clear();
}
export function combine(a, b) {
    a.x += b.x;
    a.y += b.y;
    a.xp += b.xp;
    a.yp += b.yp;
    a.xw += b.xw;
    a.rotate += b.rotate;
    a.rx += b.rx;
    a.ry += b.ry;
    a.skx += b.skx;
    a.sky += b.sky;
    a.blur += b.blur;
    a.scale *= b.scale;
    a.sx *= b.sx;
    a.sy *= b.sy;
    a.opacity *= b.opacity;
    a.draw *= b.draw;
    a.count *= b.count;
    if (b.clip) a.clip = b.clip;
    for (const [name, value] of b.vars)a.vars.set(name, value);
}
export function mirrorFrame(frame) {
    frame.x = -frame.x;
    frame.y = -frame.y;
    frame.xp = -frame.xp;
    frame.yp = -frame.yp;
    frame.xw = -frame.xw;
    frame.rotate = -frame.rotate;
    frame.rx = -frame.rx;
    frame.ry = -frame.ry;
    frame.skx = -frame.skx;
    frame.sky = -frame.sky;
}
const lerp = (a, b, t)=>a + (b - a) * t;
export function applyTrack(frame, prop, from, to, t) {
    if (prop === 'clip') {
        const f = from;
        const g = to;
        frame.clip = [
            lerp(f[0], g[0], t),
            lerp(f[1], g[1], t),
            lerp(f[2], g[2], t),
            lerp(f[3], g[3], t)
        ];
        return;
    }
    const v = lerp(from, to, t);
    switch(prop){
        case 'scale':
            frame.scale *= v;
            break;
        case 'sx':
            frame.sx *= v;
            break;
        case 'sy':
            frame.sy *= v;
            break;
        case 'opacity':
            frame.opacity *= v;
            break;
        case 'draw':
            frame.draw *= v;
            break;
        case 'count':
            frame.count *= v;
            break;
        case 'x':
            frame.x += v;
            break;
        case 'y':
            frame.y += v;
            break;
        case 'xp':
            frame.xp += v;
            break;
        case 'yp':
            frame.yp += v;
            break;
        case 'xw':
            frame.xw += v;
            break;
        case 'rotate':
            frame.rotate += v;
            break;
        case 'rx':
            frame.rx += v;
            break;
        case 'ry':
            frame.ry += v;
            break;
        case 'skx':
            frame.skx += v;
            break;
        case 'sky':
            frame.sky += v;
            break;
        case 'blur':
            frame.blur += v;
            break;
    }
}
const MAIN_THREAD = new Set([
    'blur',
    'clip',
    'draw',
    'count'
]);
export const compositorEligible = (used)=>{
    for (const p of used)if (MAIN_THREAD.has(p)) return false;
    return true;
};
const PERSPECTIVE = 1000;
const fmt = (n)=>String(Math.round(n * 1e4) / 1e4);
const UNDRAWN = 1.001;
function length(px, pct, cqw = 0) {
    if (!pct && !cqw) return `${fmt(px)}px`;
    let terms = px ? `${fmt(px)}px` : '';
    if (pct) terms += `${terms ? ' + ' : ''}${fmt(pct)}%`;
    if (cqw) terms += `${terms ? ' + ' : ''}${fmt(cqw)}cqw`;
    return terms.includes(' + ') ? `calc(${terms})` : terms;
}
export function frameCss(frame, used) {
    const css = {};
    if (used.has('x') || used.has('y') || used.has('xp') || used.has('yp') || used.has('xw')) {
        css.translate = `${length(frame.x, frame.xp, frame.xw)} ${length(frame.y, frame.yp)}`;
    }
    if (used.has('scale') || used.has('sx') || used.has('sy')) {
        const sx = frame.scale * frame.sx;
        const sy = frame.scale * frame.sy;
        css.scale = sx === sy ? fmt(sx) : `${fmt(sx)} ${fmt(sy)}`;
    }
    if (used.has('rotate')) css.rotate = `${fmt(frame.rotate)}deg`;
    if (used.has('rx') || used.has('ry') || used.has('skx') || used.has('sky')) {
        const parts = [];
        if (used.has('rx') || used.has('ry')) {
            parts.push(`perspective(${PERSPECTIVE}px)`);
            if (used.has('rx')) parts.push(`rotateX(${fmt(frame.rx)}deg)`);
            if (used.has('ry')) parts.push(`rotateY(${fmt(frame.ry)}deg)`);
        }
        if (used.has('skx') || used.has('sky')) parts.push(`skew(${fmt(frame.skx)}deg, ${fmt(frame.sky)}deg)`);
        css.transform = parts.join(' ');
    }
    if (used.has('opacity')) css.opacity = fmt(frame.opacity);
    if (used.has('blur')) css.filter = `blur(${fmt(frame.blur)}px)`;
    if (used.has('clip')) {
        const [t, r, b, l] = frame.clip ?? NO_CLIP;
        css.clipPath = `inset(${fmt(t)}% ${fmt(r)}% ${fmt(b)}% ${fmt(l)}%)`;
    }
    if (used.has('draw')) css.strokeDashoffset = fmt(UNDRAWN * (1 - frame.draw));
    varsCss(frame.vars, css);
    return css;
}
export const AXIS = '--cv-axis-';
export function varsCss(vars, css) {
    let axes = '';
    for (const [name, value] of vars){
        if (name.startsWith(AXIS)) axes += `${axes ? ', ' : ''}"${name.slice(AXIS.length)}" ${value}`;
        css[name] = value;
    }
    if (axes) css.fontVariationSettings = axes;
}
const NUMBER = /^(-?\d*\.?\d+)([a-z%]*)$/i;
const COLOR = /^(#[\da-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|var)\(.*\)|[a-z]+)$/i;
export function isColor(text) {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
        return CSS.supports('color', text);
    }
    return COLOR.test(text);
}
export function parseVarValue(text) {
    const m = NUMBER.exec(text);
    if (m) return {
        n: Number(m[1]),
        unit: m[2].toLowerCase()
    };
    return isColor(text) ? {
        color: text
    } : null;
}
export const isVarName = (key)=>/^--[\w-]+$/.test(key);
export function parseVars(text, report) {
    const out = {};
    if (!text) return out;
    for (const pair of text.split(';')){
        const colon = pair.indexOf(':');
        const key = colon < 0 ? '' : pair.slice(0, colon).trim();
        if (!key.startsWith('--')) continue;
        const raw = pair.slice(colon + 1).trim();
        const value = isVarName(key) && raw ? parseVarValue(raw) : null;
        if (value) out[key] = value;
        else report(`Cannot read "${pair.trim()}": a custom property takes a number or a colour`);
    }
    return out;
}
export function varsBetween(from, to, report) {
    const tracks = [];
    for (const name of new Set([
        ...Object.keys(from),
        ...Object.keys(to)
    ])){
        const a = from[name];
        const b = to[name];
        if (a && 'color' in a || b && 'color' in b) {
            if (a && b && 'color' in a && 'color' in b) {
                tracks.push({
                    name,
                    from: a.color,
                    to: b.color,
                    unit: null
                });
            } else {
                report(`${name} needs a colour on both sides`);
            }
            continue;
        }
        const x = a ?? {
            n: 0,
            unit: ''
        };
        const y = b ?? {
            n: 0,
            unit: ''
        };
        if (x.unit && y.unit && x.unit !== y.unit) {
            report(`${name} changes unit (${x.unit} to ${y.unit}); use the same unit on both sides`);
            continue;
        }
        tracks.push({
            name,
            from: x.n,
            to: y.n,
            unit: x.unit || y.unit
        });
    }
    return tracks;
}
export function varValue(track, t) {
    if (track.unit !== null) return `${fmt(lerp(track.from, track.to, t))}${track.unit}`;
    if (t <= 0) return track.from;
    if (t >= 1) return track.to;
    return `color-mix(in oklch, ${track.from}, ${track.to} ${fmt(t * 100)}%)`;
}
const KEYS = {
    opacity: 'opacity',
    x: 'x',
    y: 'y',
    scale: 'scale',
    scalex: 'sx',
    scaley: 'sy',
    rotate: 'rotate',
    rotatex: 'rx',
    rotatey: 'ry',
    skewx: 'skx',
    skewy: 'sky',
    blur: 'blur',
    clip: 'clip',
    draw: 'draw'
};
const ANGLE = {
    '': 1,
    deg: 1,
    turn: 360,
    rad: 180 / Math.PI
};
export function parseInset(text) {
    const body = /^inset\((.*)\)$/.exec(text.trim())?.[1] ?? text;
    const values = body.trim().split(/\s+/).map((v)=>/^-?\d*\.?\d+%?$/.test(v) ? Number.parseFloat(v) : Number.NaN);
    if (!values.length || values.length > 4 || values.some((v)=>!Number.isFinite(v))) return null;
    const [t, r = t, b = t, l = r] = values;
    return [
        t,
        r,
        b,
        l
    ];
}
export function parseDeclarations(text, report) {
    const out = {};
    if (!text) return out;
    for (const pair of text.split(';')){
        if (!pair.trim()) continue;
        const colon = pair.indexOf(':');
        const key = colon < 0 ? '' : pair.slice(0, colon).trim().toLowerCase().replace(/-/g, '');
        const raw = colon < 0 ? '' : pair.slice(colon + 1).trim();
        if (pair.trim().startsWith('--')) continue;
        const prop = KEYS[key];
        if (!prop || !raw) {
            report(`Cannot read "${pair.trim()}": expected one of ${Object.keys(KEYS).join(', ')} with a value`);
            continue;
        }
        if (prop === 'clip') {
            const inset = parseInset(raw);
            if (inset) out.clip = inset;
            else report(`Cannot read clip value "${raw}"; use inset(top right bottom left) in %`);
            continue;
        }
        const m = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(raw);
        if (!m) {
            report(`Cannot read ${key} value "${raw}"`);
            continue;
        }
        const n = Number(m[1]);
        const unit = m[2].toLowerCase();
        if (prop === 'x' || prop === 'y') {
            if (unit === '%') out[prop === 'x' ? 'xp' : 'yp'] = n;
            else if (unit === 'cqw' && prop === 'x') out.xw = n;
            else if (unit === '' || unit === 'px') out[prop] = n;
            else report(`${key} accepts px${prop === 'x' ? ', % or cqw' : ' or %'}, not "${unit}"`);
        } else if (prop === 'rotate' || prop === 'rx' || prop === 'ry' || prop === 'skx' || prop === 'sky') {
            const k = ANGLE[unit];
            if (k === undefined) report(`${key} accepts deg, turn or rad, not "${unit}"`);
            else out[prop] = n * k;
        } else if (prop === 'blur') {
            if (unit === '' || unit === 'px') out.blur = Math.max(0, n);
            else report(`blur accepts px, not "${unit}"`);
        } else if (unit === '%') {
            out[prop] = n / 100;
        } else if (unit === '') {
            out[prop] = n;
        } else {
            report(`${key} takes a number, not "${unit}"`);
        }
    }
    return out;
}
export function tracksBetween(from, to) {
    const tracks = {};
    const keys = new Set([
        ...Object.keys(from),
        ...Object.keys(to)
    ]);
    for (const p of keys){
        const identity = p === 'clip' ? NO_CLIP : IDENTITY[p];
        tracks[p] = [
            from[p] ?? identity,
            to[p] ?? identity
        ];
    }
    return tracks;
}
