export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
export const platform = isBrowser ? window : {};
export const blink = isBrowser && /Chrom(e|ium)\//.test(navigator.userAgent);
export const ElementBase = typeof HTMLElement === 'undefined' ? class {
} : HTMLElement;
export function whenIdle(step, timeout = 200) {
    const idle = platform.requestIdleCallback;
    if (idle) idle.call(window, step, {
        timeout
    });
    else setTimeout(step, 0);
}
const reduceQuery = isBrowser && typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const prefersReducedMotion = ()=>reduceQuery?.matches ?? false;
export function onReducedMotionChange(listener) {
    reduceQuery?.addEventListener('change', listener);
    return ()=>reduceQuery?.removeEventListener('change', listener);
}
