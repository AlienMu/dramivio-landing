import { CvAnimate } from './animate.js';
import { CvFixed } from './fixed.js';
import { CvPause } from './pause.js';
import { CvScene } from './scene.js';
import { CvStack } from './stack.js';
import { CvStage } from './stage.js';
import { CvVideo } from './video.js';
export function define() {
    if (typeof customElements === 'undefined') return;
    if (!customElements.get('cv-stage')) customElements.define('cv-stage', CvStage);
    if (!customElements.get('cv-scene')) customElements.define('cv-scene', CvScene);
    if (!customElements.get('cv-animate')) customElements.define('cv-animate', CvAnimate);
    if (!customElements.get('cv-stack')) customElements.define('cv-stack', CvStack);
    if (!customElements.get('cv-fixed')) customElements.define('cv-fixed', CvFixed);
    if (!customElements.get('cv-pause')) customElements.define('cv-pause', CvPause);
    if (!customElements.get('cv-video')) customElements.define('cv-video', CvVideo);
}
export { CvAnimate, CvFixed, CvPause, CvScene, CvStack, CvStage, CvVideo };
