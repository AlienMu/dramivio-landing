const root = document.documentElement;
const stage = document.getElementById('experience');
const compactScreen = window.matchMedia('(max-width: 700px)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const languageButton = document.getElementById('language-toggle');
const descriptionMeta = document.querySelector('meta[name="description"]');
const englishDescription = descriptionMeta?.content ?? '';
const cards = [...document.querySelectorAll('button.story-card[data-story]')];
const dialog = document.getElementById('story-dialog');
const closeButton = document.getElementById('dialog-close');
const previousButton = document.getElementById('dialog-prev');
const nextButton = document.getElementById('dialog-next');
const positionLabel = document.getElementById('dialog-position');
const sceneLinks = [...document.querySelectorAll('.scene-link')];
const scenes = stage ? [...stage.querySelectorAll('cv-scene')] : [];
const subscriptions = [];
let language = 'en';
let activeStory = -1;
let dialogOrigin = null;
let dialogScroll = null;
let ownsDialogLock = false;
let runtimeReady = false;
let refreshFrame = 0;
let errorCount = 0;

root.dataset.cvErrors = '0';
root.dataset.cineview = 'loading';
document.addEventListener('cv-error', (event) => {
  root.dataset.cvErrors = String(++errorCount);
  console.error('[Dramivio / Cineview]', event.detail);
});

const bindings = [
  ['opening-brand-time', '.opening-canvas', '--brand-progress', 0],
  ['opening-posters-time', '.opening-canvas', '--poster-progress', 0],
  ['opening-copy-time', '.opening-canvas', '--copy-progress', 0],
  ['phone-assembly-time', '.phone-canvas', '--assembly-progress', 1],
  ['phone-copy-time', '.phone-canvas', '--copy-progress', 1],
].map(([id, selector, property, still]) => ({
  control: document.getElementById(id),
  canvas: document.querySelector(selector),
  property,
  still,
  timeline: null,
}));

function writeProgress(binding, progress) {
  const value = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  binding.canvas?.style.setProperty(binding.property, value.toFixed(5));
}

function renderProgress() {
  const still = reducedMotion.matches || root.classList.contains('static-fallback');
  for (const binding of bindings) {
    writeProgress(binding, still ? binding.still : (binding.timeline?.frame.progress ?? 0));
  }
}

// Re-measure after localized text and responsive CSS have reached layout.
// Cineview remains the only owner of scroll position and timeline progress.
function refreshLayout() {
  if (!runtimeReady || refreshFrame) return;
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = 0;
    stage.refresh();
    renderProgress();
    syncNavigation();
  });
}

function setDurations() {
  for (const [id, desktop, mobile] of [
    ['opening-duration', 1600, 850],
    ['phone-duration', 1800, 1050],
  ]) {
    document.getElementById(id)?.setAttribute('duration', String(compactScreen.matches ? mobile : desktop));
  }
  refreshLayout();
}

function storyText(card, field) {
  return card.dataset[`${field}${language === 'zh' ? 'Zh' : 'En'}`] ?? card.dataset[`${field}En`] ?? '';
}

function renderStory() {
  const card = cards[activeStory];
  if (!card || !dialog) return;
  document.getElementById('dialog-title').textContent = storyText(card, 'title');
  document.getElementById('dialog-genre').textContent = storyText(card, 'genre');
  document.getElementById('dialog-description').textContent = storyText(card, 'description');
  const art = Math.min(9, Math.max(0, Number.parseInt(card.dataset.art, 10) || 0));
  document.getElementById('dialog-art').className = `dialog-art art art-${art}`;
  dialog.dataset.story = card.dataset.story;
  if (positionLabel) {
    positionLabel.textContent = `${String(activeStory + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
    positionLabel.setAttribute('aria-label', language === 'zh'
      ? `第 ${activeStory + 1} 部，共 ${cards.length} 部`
      : `Story ${activeStory + 1} of ${cards.length}`);
  }
}

function setLanguage(nextLanguage, remember = true) {
  language = nextLanguage === 'zh' ? 'zh' : 'en';
  root.lang = language === 'zh' ? 'zh-CN' : 'en';
  for (const element of document.querySelectorAll('[data-en][data-zh]')) {
    if (!element.childElementCount && element.tagName !== 'META') element.textContent = element.dataset[language];
  }
  document.title = language === 'zh' ? 'Dramivio — 再看一集。' : 'Dramivio — One more episode.';
  if (descriptionMeta) descriptionMeta.content = language === 'zh'
    ? 'Dramivio，再看一集。一款富于表现力的短剧 App 概念，以 Cineview 打造可交互的作品集体验。'
    : englishDescription;
  const label = document.getElementById('language-label');
  if (label) label.textContent = language === 'zh' ? 'en' : '中文';
  languageButton?.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : 'Switch to Chinese');
  for (const [element, english, chinese] of [
    [closeButton, 'Close story', '关闭故事'],
    [previousButton, 'Previous story', '上一个故事'],
    [nextButton, 'Next story', '下一个故事'],
    [document.querySelector('.brand'), 'Dramivio home', 'Dramivio 首页'],
    [document.querySelector('.main-nav'), 'Main navigation', '主导航'],
    [document.querySelector('.scene-link[href="#stories"]'), 'The stories: browse the collection', '故事：浏览剧目'],
    [document.querySelector('.scene-link[href="#app"]'), 'The details: explore the app design', '细节：探索 App 设计'],
    [document.querySelector('.scene-link[href="#finale"]'), 'The project: source and creator', '项目：查看源码与创作者'],
    [document.querySelector('.header-source'), 'View source on GitHub', '在 GitHub 查看源码'],
    [document.querySelector('.assembly-figure'), 'Dramivio interface layers assemble into a complete phone as you scroll', '随滚动展开 Dramivio 界面，让每一层组合成完整的手机'],
  ]) element?.setAttribute('aria-label', language === 'zh' ? chinese : english);
  for (const card of cards) {
    const title = storyText(card, 'title');
    card.title = title;
    card.setAttribute('aria-label', language === 'zh' ? `查看《${title}》` : `Explore ${title}`);
  }
  renderStory();
  if (remember) {
    try { localStorage.setItem('dramivio:language', language); } catch { /* Storage may be unavailable. */ }
  }
  refreshLayout();
}

function preserveDialogScroll() {
  if (dialogScroll && (window.scrollX !== dialogScroll.x || window.scrollY !== dialogScroll.y)) {
    window.scrollTo({ left: dialogScroll.x, top: dialogScroll.y, behavior: 'instant' });
  }
}

function openStory(index, trigger) {
  if (!dialog || !cards[index]) return;
  activeStory = index;
  renderStory();
  if (dialog.open) return;
  dialogOrigin = trigger;
  dialogScroll = { x: window.scrollX, y: window.scrollY };
  // The class owns the lock; existing inline overflow styles remain intact.
  ownsDialogLock = !document.body.classList.contains('dialog-open');
  document.body.classList.add('dialog-open');
  dialog.showModal();
  closeButton?.focus({ preventScroll: true });
  preserveDialogScroll();
}

function stepStory(direction) {
  if (!dialog?.open || !cards.length) return;
  activeStory = (activeStory + direction + cards.length) % cards.length;
  renderStory();
}

cards.forEach((card, index) => card.addEventListener('click', () => openStory(index, card)));
closeButton?.addEventListener('click', () => dialog.close());
previousButton?.addEventListener('click', () => stepStory(-1));
nextButton?.addEventListener('click', () => stepStory(1));
positionLabel?.setAttribute('aria-live', 'polite');
positionLabel?.setAttribute('aria-atomic', 'true');

if (dialog) {
  let beganOnBackdrop = false;
  const onBackdrop = (event) => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  dialog.addEventListener('pointerdown', (event) => { beganOnBackdrop = onBackdrop(event); });
  dialog.addEventListener('click', (event) => {
    if (beganOnBackdrop && onBackdrop(event)) dialog.close();
    beganOnBackdrop = false;
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      stepStory(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  // Native Escape and the close button share the same cleanup and focus path.
  dialog.addEventListener('close', () => {
    if (ownsDialogLock) document.body.classList.remove('dialog-open');
    if (dialogOrigin?.isConnected) dialogOrigin.focus({ preventScroll: true });
    preserveDialogScroll();
    dialogScroll = null;
    dialogOrigin = null;
    ownsDialogLock = false;
    refreshLayout();
  });
}

function syncNavigation() {
  const midpoint = Math.floor(window.innerHeight / 2) + 1;
  let current = scenes[0];
  for (const scene of scenes) {
    if (scene.getBoundingClientRect().top > midpoint) break;
    current = scene;
  }
  for (const link of sceneLinks) {
    const active = Boolean(current && link.getAttribute('href') === `#${current.id}`);
    link.classList.toggle('active', active);
    if (active && link.getAttribute('aria-current') !== 'true') link.setAttribute('aria-current', 'true');
    else if (!active && link.hasAttribute('aria-current')) link.removeAttribute('aria-current');
  }
  const indicator = document.getElementById('current-scene');
  if (indicator && current) indicator.textContent = String(scenes.indexOf(current) + 1).padStart(2, '0');
}

let sceneObserver;
let navigationResizeFrame = 0;
function observeNavigation() {
  sceneObserver?.disconnect();
  const height = window.innerHeight;
  const top = Math.max(0, Math.floor(height / 2) - 1);
  const bottom = Math.max(0, height - top - 2);
  // A two-pixel viewport-center strip, independent of viewport width.
  sceneObserver = new IntersectionObserver(syncNavigation, {
    rootMargin: `-${top}px 0px -${bottom}px 0px`, threshold: 0,
  });
  scenes.forEach((scene) => sceneObserver.observe(scene));
  syncNavigation();
}

// Cineview also marks anchors; reconcile those writes without changing its state.
const navigationMutations = new MutationObserver(syncNavigation);
sceneLinks.forEach((link) => navigationMutations.observe(link, {
  attributes: true, attributeFilter: ['aria-current'],
}));
observeNavigation();
window.addEventListener('resize', () => {
  if (navigationResizeFrame) return;
  navigationResizeFrame = requestAnimationFrame(() => {
    navigationResizeFrame = 0;
    observeNavigation();
  });
}, { passive: true });

// Own scene-link destinations before any stage-level anchor handler runs.
// Scrolling itself remains native and respects the system motion preference.
document.addEventListener('click', async (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const link = event.target.closest?.('a[href^="#"]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const hash = link.getAttribute('href');
  let scene;
  try { scene = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return; }
  if (!scenes.includes(scene)) return;
  event.preventDefault();
  if (!runtimeReady) {
    await runtimeTask;
    await new Promise(requestAnimationFrame);
  }
  if (location.hash !== hash) history.pushState(null, '', hash);
  if (!scene.hasAttribute('tabindex')) {
    scene.setAttribute('tabindex', '-1');
    scene.addEventListener('blur', () => scene.removeAttribute('tabindex'), { once: true });
  }
  scene.focus({ preventScroll: true });
  const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
  // Pinned canvases already include their own header clearance.
  const headerOffset = scene.hasAttribute('zone') ? 0 : Math.max(0, headerBottom);
  window.scrollTo({
    top: Math.max(0, window.scrollY + scene.getBoundingClientRect().top - headerOffset),
    behavior: reducedMotion.matches ? 'instant' : 'smooth',
  });
}, { capture: true });

try { language = localStorage.getItem('dramivio:language') === 'zh' ? 'zh' : 'en'; } catch { /* Default to English. */ }
setLanguage(language, false);
languageButton?.addEventListener('click', () => setLanguage(language === 'en' ? 'zh' : 'en'));
setDurations();
renderProgress();
compactScreen.addEventListener('change', setDurations);
reducedMotion.addEventListener('change', () => { renderProgress(); refreshLayout(); });

async function startCineview() {
  let readyTimeout;
  try {
    await import('./assets/vendor/cineview/cineview.js');
    await Promise.all(['cv-stage', 'cv-scene', 'cv-animate'].map((name) => customElements.whenDefined(name)));
    if (!stage) throw new Error('The experience stage is missing.');
    await Promise.race([
      stage.ready,
      new Promise((_, reject) => { readyTimeout = setTimeout(() => reject(new Error('Cineview did not become ready.')), 8000); }),
    ]);
    for (const binding of bindings) {
      binding.timeline = binding.control?.timeline;
      if (!binding.timeline) throw new Error('A Cineview timeline control is missing.');
      const render = (frame) => {
        if (!reducedMotion.matches) writeProgress(binding, frame.progress);
      };
      if (reducedMotion.matches) writeProgress(binding, binding.still);
      else render(binding.timeline.frame);
      subscriptions.push(binding.timeline.subscribe(render));
    }
    runtimeReady = true;
    root.dataset.cineview = 'ready';
    syncNavigation();
    refreshLayout();
  } catch (error) {
    subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    root.dataset.cineview = 'fallback';
    root.classList.add('static-fallback');
    root.classList.remove('cv-js');
    renderProgress();
    console.error('[Dramivio] The static presentation is active because Cineview could not start.', error);
  } finally {
    clearTimeout(readyTimeout);
  }
}

const runtimeTask = startCineview();
