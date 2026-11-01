import { writeLayer } from '../render/layers.js';
export const FULL_SPEED = 80 / (1000 / 60);
const ATTACK_MS = 40;
const RELEASE_MS = 294;
const STILL = 0.0008;
const IDLE_MS = 60;
const JUMP = 40;
export const DEAD_ZONE = 6;
export const TOP = 40;
const TURN_MS = 240;
const MAX_STEP = 100;
export const isSignal = (source)=>source === 'velocity' || source === 'direction';
export class Signals {
    velocity = 0;
    heading = 0;
    turn = 0;
    measured = 0;
    lastY = Number.NaN;
    lastSample = Number.NEGATIVE_INFINITY;
    lastStep = Number.NaN;
    counted = Number.NaN;
    sample(y, now) {
        if (Number.isFinite(this.lastY)) {
            const dt = now - this.lastSample;
            const v = dt > 0 ? (y - this.lastY) / dt : 0;
            this.measured = Math.abs(v) > JUMP ? 0 : v;
        }
        this.lastY = y;
        this.lastSample = now;
        if (!Number.isFinite(this.counted)) this.counted = y;
        const d = y - this.counted;
        if (Math.abs(d) < DEAD_ZONE) return false;
        this.counted = y;
        const heading = d > 0 && y > TOP ? 1 : -1;
        if (heading === this.heading) return false;
        this.heading = heading;
        return true;
    }
    step(now) {
        const dt = Number.isFinite(this.lastStep) ? Math.min(MAX_STEP, now - this.lastStep) : 16;
        this.lastStep = now;
        if (dt <= 0) return;
        const target = now - this.lastSample > IDLE_MS ? 0 : this.measured;
        const rising = Math.abs(target) > Math.abs(this.velocity);
        this.velocity += (target - this.velocity) * (1 - Math.exp(-dt / (rising ? ATTACK_MS : RELEASE_MS)));
        if (target === 0 && Math.abs(this.velocity) < STILL * FULL_SPEED) this.velocity = 0;
        const goal = this.heading === 1 ? 1 : 0;
        if (this.turn < goal) this.turn = Math.min(goal, this.turn + dt / TURN_MS);
        else if (this.turn > goal) this.turn = Math.max(goal, this.turn - dt / TURN_MS);
    }
    get resting() {
        return this.velocity === 0 && this.turn === (this.heading === 1 ? 1 : 0);
    }
    get speed() {
        return Math.max(-1, Math.min(1, this.velocity / FULL_SPEED));
    }
}
export function writeSignal(layer, signals) {
    if (layer.source === 'direction') {
        writeLayer(layer, signals.turn, 0);
        return;
    }
    const s = signals.speed;
    writeLayer(layer, Math.abs(s), 0, s < 0);
}
