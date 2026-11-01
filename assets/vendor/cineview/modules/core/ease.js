const withCss = (fn, css)=>Object.assign(fn, {
        css
    });
export function cubicBezier(x1, y1, x2, y2) {
    return withCss(bezier(x1, y1, x2, y2), `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`);
}
function bezier(x1, y1, x2, y2) {
    const ax = 3 * x1 - 3 * x2 + 1;
    const bx = 3 * x2 - 6 * x1;
    const cx = 3 * x1;
    const ay = 3 * y1 - 3 * y2 + 1;
    const by = 3 * y2 - 6 * y1;
    const cy = 3 * y1;
    const x = (u)=>((ax * u + bx) * u + cx) * u;
    const dx = (u)=>(3 * ax * u + 2 * bx) * u + cx;
    return (t)=>{
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        let u = t;
        for(let i = 0; i < 8; i++){
            const err = x(u) - t;
            if (Math.abs(err) < 1e-6) return ((ay * u + by) * u + cy) * u;
            const d = dx(u);
            if (Math.abs(d) < 1e-6) break;
            u -= err / d;
        }
        let lo = 0;
        let hi = 1;
        u = t;
        for(let i = 0; i < 30; i++){
            const v = x(u);
            if (Math.abs(v - t) < 1e-6) break;
            if (v < t) lo = u;
            else hi = u;
            u = (lo + hi) / 2;
        }
        return ((ay * u + by) * u + cy) * u;
    };
}
export const linear = withCss((t)=>t, 'linear');
export const easeInOut = cubicBezier(0.42, 0, 0.58, 1);
export const settle = cubicBezier(0.16, 0.84, 0.24, 1);
export const pan = cubicBezier(0.37, 0, 0.63, 1);
export const EASES = {
    linear,
    ease: cubicBezier(0.25, 0.1, 0.25, 1),
    'ease-in': cubicBezier(0.42, 0, 1, 1),
    'ease-out': cubicBezier(0, 0, 0.58, 1),
    'ease-in-out': easeInOut,
    settle,
    pan
};
export function parseEase(text) {
    if (!text) return null;
    const name = text.trim();
    const named = EASES[name];
    if (named) return named;
    const m = /^cubic-bezier\(\s*([^)]*)\)$/.exec(name);
    if (!m) return null;
    const n = m[1].split(',').map((s)=>Number(s.trim()));
    if (n.length !== 4 || n.some((v)=>!Number.isFinite(v))) return null;
    if (n[0] < 0 || n[0] > 1 || n[2] < 0 || n[2] > 1) return null;
    return cubicBezier(n[0], n[1], n[2], n[3]);
}
