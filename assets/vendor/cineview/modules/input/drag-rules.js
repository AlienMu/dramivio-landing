export const DEFAULT_THRESHOLD = {
    slow: 0.3,
    fast: 0.15,
    velocity: 1000
};
export function parseThreshold(text, fallback, report) {
    if (!text?.trim()) return fallback;
    const values = text.trim().split(/\s+/).map(Number);
    const [a, b, c] = values;
    if (values.length > 3 || values.some((n, i)=>!Number.isFinite(n) || n <= 0 || i < 2 && n >= 1)) {
        report?.(`threshold="${text}": expected up to three numbers: slow ratio (0–1), fast ratio (0–1), velocity > 0; invalid fields use their defaults`);
    }
    const ratio = (n, d)=>n !== undefined && Number.isFinite(n) && n > 0 && n < 1 ? n : d;
    const slow = ratio(a, fallback.slow);
    return {
        slow,
        fast: Math.min(ratio(b, Math.min(fallback.fast, slow)), slow),
        velocity: c !== undefined && Number.isFinite(c) && c > 0 ? c : fallback.velocity
    };
}
export function thresholdAt(speed, t) {
    if (!Number.isFinite(speed)) return t.slow;
    const k = Math.min(Math.max(speed, 0), t.velocity) / t.velocity;
    return t.slow - k * (t.slow - t.fast);
}
export const REVERSAL_SPEED = 600;
export function shouldCommit(r, velocity, t, pointerCancel, gesture) {
    if (pointerCancel) return false;
    const travel = Math.abs(r);
    const reversal = travel > 0.001 && r * velocity < 0 && Math.abs(velocity) > REVERSAL_SPEED;
    if (reversal) return false;
    if (t) return travel > thresholdAt(Math.abs(velocity), t);
    if (!gesture || Math.abs(gesture.displacement) <= 5) return false;
    return gesture.duration <= 300 ? Math.abs(gesture.displacement) >= gesture.viewport * 0.08 && r * gesture.displacement > 0 : travel >= 0.5;
}
export const BOUNCE_MAX = 300;
export const EDGE_BOUNCE = 150;
export const slideDuration = (remaining, transition)=>Math.max(0, Math.abs(remaining)) * transition;
export const cancelDuration = (travel, transition)=>Math.min(Math.abs(travel) * transition, BOUNCE_MAX);
export function parseMapping(unit, scale, fallback) {
    if (unit === null && scale === null) return {
        mapping: fallback,
        invalid: false
    };
    let invalid = false;
    let u = 'time';
    if (unit === 'time' || unit === 'percent') u = unit;
    else if (unit !== null) invalid = true;
    const fallbackScale = u === 'time' ? 10 : 1;
    const n = scale === null ? fallbackScale : Number(scale);
    if (!Number.isFinite(n) || n < 0) invalid = true;
    return {
        mapping: {
            unit: u,
            scale: Number.isFinite(n) && n >= 0 ? n : fallbackScale
        },
        invalid
    };
}
export function mapDrag(fraction, total, m) {
    const f = Number.isFinite(fraction) ? Math.max(0, fraction) : 0;
    const t = Math.max(0, total);
    const ms = m.unit === 'time' ? f * 100 * m.scale : f * m.scale * t;
    return Math.min(t, ms);
}
