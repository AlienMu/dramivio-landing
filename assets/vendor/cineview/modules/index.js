import * as elements from './elements/define.js';
import { bootCss, captureBoot, HEAD_SNIPPET } from './boot.js';
import { isBrowser } from './platform.js';
const { define } = elements;
export const CvStage = elements.CvStage;
export const CvScene = elements.CvScene;
export const CvAnimate = elements.CvAnimate;
export const CvStack = elements.CvStack;
export const CvFixed = elements.CvFixed;
export const CvVideo = elements.CvVideo;
export const CvPause = elements.CvPause;
export { defineEffect, presetNames } from './core/fx.js';
export { bootCss, HEAD_SNIPPET };
if (isBrowser && !document.getElementById('cv-boot-style') && !hasBootSheet()) {
    const style = document.createElement('style');
    style.id = 'cv-boot-style';
    style.textContent = bootCss();
    document.head.append(style);
}
function hasBootSheet() {
    return getComputedStyle(document.documentElement).getPropertyValue('--cv-boot').trim() === '1';
}
if (isBrowser) {
    const restore = captureBoot();
    define();
    restore();
} else {
    define();
}
