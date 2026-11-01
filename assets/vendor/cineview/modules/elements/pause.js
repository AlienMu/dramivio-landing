import { ElementBase } from '../platform.js';
export class CvPause extends ElementBase {
    static observedAttributes = [
        'for'
    ];
    label = null;
    watched = null;
    connectedCallback() {
        if (!this.shadowRoot) {
            const root = this.attachShadow({
                mode: 'open'
            });
            const slot = document.createElement('slot');
            this.label = document.createTextNode('');
            slot.append(this.label);
            root.append(slot);
        }
        if (!this.hasAttribute('role')) this.setAttribute('role', 'button');
        if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
        this.addEventListener('click', this.toggle);
        this.addEventListener('keydown', this.onKey);
        document.addEventListener('cv-ready', this.onReady);
        this.watch();
    }
    disconnectedCallback() {
        this.removeEventListener('click', this.toggle);
        this.removeEventListener('keydown', this.onKey);
        document.removeEventListener('cv-ready', this.onReady);
        this.watch(null);
    }
    onReady = ()=>this.watch();
    attributeChangedCallback() {
        if (this.isConnected) this.watch();
    }
    get stage() {
        const id = this.getAttribute('for');
        const found = id ? document.getElementById(id) : this.closest('cv-stage') ?? document.querySelector('cv-stage');
        return found && found.localName === 'cv-stage' ? found : null;
    }
    watch(stage = this.stage) {
        if (this.watched === stage) return this.sync();
        this.watched?.removeEventListener('cv-pause', this.sync);
        this.watched?.removeEventListener('cv-play', this.sync);
        this.watched = stage;
        stage?.addEventListener('cv-pause', this.sync);
        stage?.addEventListener('cv-play', this.sync);
        this.sync();
    }
    sync = ()=>{
        const paused = this.watched?.hasAttribute('paused') ?? false;
        this.setAttribute('aria-pressed', String(paused));
        if (this.label) this.label.data = paused ? 'Play motion' : 'Pause motion';
    };
    toggle = ()=>{
        const stage = this.stage;
        if (!stage) return;
        this.watch(stage);
        stage.toggleAttribute('paused');
    };
    onKey = (e)=>{
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        this.toggle();
    };
}
