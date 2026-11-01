export function watchText(host, again) {
    let first = true;
    const ro = new ResizeObserver(()=>{
        if (first) first = false;
        else again();
    });
    ro.observe(host);
    const text = new MutationObserver(again);
    text.observe(host, {
        childList: true,
        characterData: true,
        subtree: true
    });
    const attrs = new MutationObserver(again);
    attrs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [
            'lang',
            'data-cv-theme'
        ],
        subtree: true
    });
    const media = [
        '(prefers-color-scheme: dark)',
        '(forced-colors: active)',
        '(prefers-contrast: more)'
    ].map((q)=>matchMedia(q)).filter((m)=>typeof m.addEventListener === 'function');
    for (const m of media)m.addEventListener('change', again);
    const fonts = document.fonts;
    if (fonts?.addEventListener) fonts.addEventListener('loadingdone', again);
    return ()=>{
        ro.disconnect();
        text.disconnect();
        attrs.disconnect();
        for (const m of media)m.removeEventListener('change', again);
        fonts?.removeEventListener?.('loadingdone', again);
    };
}
