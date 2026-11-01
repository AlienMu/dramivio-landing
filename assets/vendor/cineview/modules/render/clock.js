const timelineNow = ()=>{
    const time = typeof document === 'undefined' ? null : document.timeline?.currentTime;
    return typeof time === 'number' ? time : performance.now();
};
export class Clock {
    animations = new Set();
    stopped = false;
    pausedSince = 0;
    pausedTotal = 0;
    ticks = new Set();
    raf = 0;
    subscribe(tick) {
        this.ticks.add(tick);
        tick(this.now());
        this.queue();
        return ()=>{
            this.ticks.delete(tick);
            if (!this.ticks.size) {
                cancelAnimationFrame(this.raf);
                this.raf = 0;
            }
        };
    }
    queue() {
        if (!this.raf && !this.stopped && this.ticks.size) this.raf = requestAnimationFrame(this.tick);
    }
    tick = (at)=>{
        this.raf = 0;
        if (this.stopped) return;
        const time = this.now(at);
        for (const tick of this.ticks)tick(time);
        this.queue();
    };
    get paused() {
        return this.stopped;
    }
    now(at = timelineNow()) {
        return at - this.pausedTotal - (this.stopped ? Math.max(0, at - this.pausedSince) : 0);
    }
    add(animation) {
        this.animations.add(animation);
        if (this.stopped) this.hold(animation);
        else this.resume(animation);
        const forget = ()=>{
            this.animations.delete(animation);
        };
        animation.finished.then(forget, forget);
        return animation;
    }
    hold(animation) {
        const time = animation.currentTime ?? 0;
        animation.pause();
        animation.currentTime = time;
    }
    resume(animation) {
        const time = animation.currentTime ?? 0;
        animation.play();
        if (typeof time === 'number' && animation.playbackRate) animation.startTime = timelineNow() - time / animation.playbackRate;
    }
    pause() {
        if (!this.stopped) this.pausedSince = timelineNow();
        this.stopped = true;
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        for (const a of this.animations)if (a.playState === 'running') this.hold(a);
    }
    play() {
        if (this.stopped) this.pausedTotal += timelineNow() - this.pausedSince;
        this.stopped = false;
        for (const a of this.animations)if (a.playState === 'paused') this.resume(a);
        this.queue();
    }
}
