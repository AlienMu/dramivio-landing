# Dramivio — One more episode.

A bilingual, scroll-driven portfolio presentation for the Dramivio short-drama app concept. Original app artwork and interface details meet oversized typography, an interactive poster collection, and a layered phone assembly.

- **Source:** [AlienMu/dramivio-landing](https://github.com/AlienMu/dramivio-landing)
- **Intended GitHub Pages URL:** [alienmu.github.io/dramivio-landing](https://alienmu.github.io/dramivio-landing/) — **deployment pending verification**.
- **Visual reference:** [Dramivio design](https://dramivio-docs.pages.dev/design/index.html)
- **Creator:** [Alien](https://alienmmm.com/)

This is a portfolio experience. The six story synopses are illustrative demo copy, identified as such in the story dialog. There is no app download, account flow, video playback, or production drama service.

## The four approved scenes

| Scene | Anchor | Experience |
| --- | --- | --- |
| 01 · Opening | `#opening` | Large DRAMIVIO wordmark, original poster artwork, and “One more episode.” copy respond to scroll. |
| 02 · The stories | `#stories` | Six posters form a staggered gallery. Select a poster to open its bilingual story preview; browse previous and next stories inside the dialog. |
| 03 · The details | `#app` | Search, genres, continue-watching, recommendations, and navigation layers assemble into the Dramivio phone interface. |
| 04 · The project | `#finale` | Closing brand statement, source repository, creator portfolio, and Cineview credit. |

## Run, check, and build

Requires **Node.js 18 or newer**. There are no npm dependencies to install.

```sh
npm start
```

Open [localhost:4173](http://localhost:4173). The development server serves the repository root and accepts a `PORT` environment variable.

```sh
npm run check
npm run build
```

`check` validates the four scene elements, unique HTML IDs, local asset references, fragment links, JavaScript syntax, and relative imports throughout the vendored Cineview modules. It is a structural check; responsive layout, keyboard behavior, scroll animation, and the external poster image also need browser verification.

`build` recreates `dist/` with `index.html`, `styles.css`, `app.js`, `.nojekyll`, and `assets/`. For GitHub Pages, this repository can be served directly from `main` / `/ (root)` because all assets use relative paths and `.nojekyll` is included. The generated `dist/` directory can also be deployed to another static host. The social metadata uses the intended Pages URL above; a successful build does not establish that deployment is live.

## Actual Cineview runtime

The site uses **Cineview 2.0.1**, vendored from [AlienMu/cineview](https://github.com/AlienMu/cineview) at commit [`3cd988430539b71ae864bef69dd01136e356ba56`](https://github.com/AlienMu/cineview/commit/3cd988430539b71ae864bef69dd01136e356ba56).

The upstream TypeScript was transpiled with Node 24's `stripTypeScriptTypes` transform, relative module imports received `.js` extensions, and `__DEV__` was set to `false`. The genuine runtime and its lazy feature modules are self-hosted under `assets/vendor/cineview/`. Cineview owns the scroll timelines; `app.js` subscribes to their progress and updates the scene CSS variables.

See [runtime provenance](assets/vendor/cineview/PROVENANCE.md) and the retained [MIT license](assets/vendor/cineview/LICENSE). Node 24 was used to prepare the vendored runtime; it is not required for the normal run/check/build commands.

## Assets and typography

| Asset | Origin and use |
| --- | --- |
| `assets/dramivio-logo.png` | Original Dramivio logo from the existing app/design material; used in the header, phone, footer, and favicon. |
| Poster artwork | Original ten-poster sprite, loaded directly from [the public Dramivio design asset](https://dramivio-docs.pages.dev/design/assets/covers.png). The URL is declared in `.art` in `styles.css` and preloaded in `index.html`. |
| `assets/fonts/display-bold.otf` | Nimbus Sans Narrow Bold, from [URW Base35](https://github.com/ArtifexSoftware/urw-base35-fonts), served locally as “Dramivio Display.” The original font metadata is retained. |
| `assets/social-card.svg` / `assets/social-card.png` | Code-authored brand card and its 1200 × 630 raster export for social sharing. |

The poster sprite remains an external dependency: its host must be reachable for artwork to display. It is a five-column, two-row image rendered at `background-size: 500% 200%`; columns use `0%`, `25%`, `50%`, `75%`, and `100%`, and rows use `0%` and `100%`.

The bundled font's license is **AGPL-3 with Font exception**, as documented in [the retained copyright and license notice](assets/fonts/LICENSE.txt). Cineview's MIT license applies to the vendored runtime; it does not assign a license to the Dramivio brand or poster artwork.

To regenerate the social PNG with Inkscape and Nimbus Sans Narrow installed:

```sh
inkscape assets/social-card.svg --export-type=png --export-filename=assets/social-card.png --export-width=1200 --export-height=630
```

## Language, motion, and keyboard behavior

- English is the default. The `中文` / `en` switch updates scene copy, story previews, relevant accessible labels, the document language, title, and description. The selected language is remembered in local storage when available.
- Responsive layouts and shorter scroll timelines accommodate compact screens. Very short landscape screens show the completed phone in normal document flow so that copy and captions remain reachable.
- `prefers-reduced-motion: reduce` removes decorative movement and shows the phone fully assembled. A runtime failure also activates a readable static presentation; a no-JavaScript notice explains unavailable interactions.
- A skip link, visible focus outlines, semantic buttons, and labeled navigation support keyboard access.
- Story previews use a native modal `<dialog>`. Opening focuses its close button; focus stays within the modal. Escape, the close button, or an intentional backdrop click closes it, restores the originating poster's focus, and preserves the page scroll position. Previous/next buttons and Left/Right arrow keys browse the six previews.
