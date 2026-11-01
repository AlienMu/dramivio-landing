import { ElementBase } from '../platform.js';
const STYLE = ':host{display:block;position:absolute;inset:0;overflow:clip;will-change:transform;pointer-events:none}' + '.layer{position:sticky;top:0;height:100svh}' + '::slotted(*){pointer-events:auto}';
export class CvFixed extends ElementBase {
    slotBefore;
    connectedCallback() {
        if (this.parentElement?.localName === 'cv-scene' && !this.getAttribute('slot')) {
            this.slotBefore = this.getAttribute('slot');
            this.slot = 'cv-fixed';
        }
        if (this.shadowRoot) return;
        const root = this.attachShadow({
            mode: 'open'
        });
        const style = document.createElement('style');
        style.textContent = STYLE;
        const layer = document.createElement('div');
        layer.className = 'layer';
        layer.setAttribute('part', 'layer');
        layer.append(document.createElement('slot'));
        root.append(style, layer);
    }
    disconnectedCallback() {
        if (this.slotBefore !== undefined && this.slot === 'cv-fixed') {
            if (this.slotBefore === null) this.removeAttribute('slot');
            else this.setAttribute('slot', this.slotBefore);
        }
        this.slotBefore = undefined;
    }
}
