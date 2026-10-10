# Interface style

This page gives the shared rules of the atlas interface. Use them for each new control, text, and number.

## Tokens

The custom properties are in `src/styles/foundations.css`.

| Token | Use |
|---|---|
| `--font-sans` | The one font stack. There is no serif font. Canvas text uses the same stack from `src/format/fonts.ts`. |
| `--text-xs` (12 px), `--text-sm`, `--text-md`, `--text-lg` | Text sizes. 12 px is the minimum for text that the user reads. |
| `--panel-background` | Background of a dark panel. |
| `--panel-surface`, `--panel-surface-strong` | A card or a row on a panel, and its hover state. |
| `--panel-line`, `--panel-line-strong` | Borders on a panel. |
| `--panel-ink`, `--panel-ink-muted` | Text and secondary text on a panel. |
| `--radius-sm`, `--radius-md`, `--radius-lg` | Corner radius. |
| `--accent-strong` | Gold: the primary action and the active state. |
| `--spectral-teal`, `--focus-ring` | The focus ring. |
| `--link`, `--link-visited` | Link colours. |
| `--danger` | Error text. |

All panels are dark. Do not use the paper colours (`--paper`, `--ink`) for a new component.

## Controls

A `button`, `input`, `select`, or `textarea` in `#app` that has no class gets the base look. The base rule has zero specificity (`:where()`), so a component rule always wins.

There are three button classes:

| Class | Look | Use |
|---|---|---|
| `.primary-action` | Gold fill | The one main action of a group. |
| `.secondary-action` | Outline | Other actions. |
| `.text-action` | Quiet | Actions in a row of tools, and actions of low weight. |

- Hover and the active state are different. Hover is a light surface. Gold is for the active state only.
- A button with an on state has `aria-pressed`. Do not show a state by colour only.
- A touch target is 44 x 44 px minimum on a phone.

## Links

- One rule gives each link in `#app` its colour, its visited colour, and the focus ring.
- A link that opens a new tab uses `NEW_TAB_LINK_ATTRIBUTES` from `src/format/links.ts` (or the same attributes in `index.html`). The style sheet adds the mark, and `#new-tab-hint` gives the hidden text `Opens in a new tab`.

## Numbers

`src/format/quantity.ts` has the one number rule. Do not call `Intl.NumberFormat`, `toLocaleString`, `toFixed`, or `toExponential` for text that the user reads.

1. Numbers use the application locale (the language menu), not the browser locale.
2. Below 1,000,000: all digits with group separators, and 4 significant digits maximum for a measured value. Example: `383,400 km`.
3. From 1,000,000: words, with 3 significant digits maximum. Examples: `1.4 million km`, `2.05 million ly`, `9.46 billion ly`.
4. A count in a small space can use the short form. Example: `2.33M`.
5. Distance units: km below 0.1 AU, AU below 0.1 ly, ly above. There is no `kly`, `Mly`, or `Gly`, and no exponent form.
6. The PNG footer and addresses keep the machine format.

| Function | Example |
|---|---|
| `formatQuantity(value)` | `1.61`, `12,000`, `1.4 million` |
| `formatCount(value)` | `12,000`; with `{ compact: true }`: `2.33M` |
| `formatDistanceKm(km)` | `383,400 km`, `1.61 AU`, `227,500 ly` |
| `formatLightYears(ly)` | `9.46 billion ly` |
| `formatDuration(seconds)` | `5 h`, `259 d`, `12 yr` |
| `formatFixed(value, digits)` | `4.50` |
| `formatDateTime(value, options)` | `Oct 9, 2026` |

In Spanish the same values are `383.400 km`, `1,61 AU`, and `9,46 mil millones ly`.

A missing value is the text `Unknown` in the inspector. Result rows and comparison cards do not show a missing value.

## Object type names

`objectTypeLabel(type, form)` from `src/format/objectTypeLabel.ts` is the one source of type names.

- Names are in sentence case: `Dwarf planet`, `Active galaxy`.
- Use the singular (`"one"`) for one object and the plural (`"many"`) for a group: `Galaxy`, `Galaxies`.
- The keys are `type.*` and `typePlural.*`. Do not show a catalog word such as `active_galaxy`.

## Text

Each text that the user reads has a translation key and a value in all nine locales. New keys go into a module of their area in `src/i18n/` and into the list in `src/i18n/areaTranslations.ts`.

Some text has its English source in a module that node tests import, so that module does not import `i18n.ts`:

- **Media cards** (`src/objectMedia.ts`): `MEDIA_TEXT_EN` has the English text. The functions get a text source (`MediaText`); the default is English. The title and the description of each curated image are in `CURATED_MEDIA_TEXT` of `src/object/curatedSummaries/<locale>.ts`, which the browser loads for the active language only.
- **Uncertainty sentences** (`src/scienceSemantics.ts`): `UNCERTAINTY_TEXT_EN`. `uncertaintySummary(record, t)` gives the sentence in the application language.
- **Labels from data** (`src/i18n/dataLabelTranslations.ts`): the Milky Way labels and the labels of source links come from data modules or from the server in English. `DATA_LABEL_KEYS` gives the key of each known label, and `dataLabelText(label)` gives the text. A label with no key shows as it is.
- **Constellation names** (`src/i18n/constellationNames.ts`): one list of 87 names for each language, in the order of the IAU names. `constellationName(latinName, locale)` gives the name. A search in Settings finds the name of the language and the IAU name.

These texts are not translated, by decision: unit symbols (`km`, `AU`, `ly`, `mag`, `mas`, `Mpc`), names of catalogs, missions, and image libraries, catalog designations of objects, the citation text for the clipboard, the performance panel (`?perf=1`), and text that the server sends (for example the type label of a deep-sky object).

## Labels

`src/labels/labelRank.ts` is the one label rule for the 2D map, Sky view, and the 3D view.

- A label has a class, and a better class gets its label first: the selected object, a major body (the Sun, the planets, the Moon), a named object, a small body or spacecraft, a catalog designation (`HIP 10234`, `bet Oph`, `Gl 725 A`).
- `placeLabels` gives each candidate the first free rectangle of its anchors. A label stays inside the free area of the view and out of the control areas (header, panels, toolbar, scale bar).
- The pointer does not change the rank of a label: a label must not move when the pointer is on it.
- A small body or a catalog designation gets a label only when it is selected, when few of them are in view (2D map), or when the field of view is small (Sky view).
- Label text is 12 px or larger.
- A label is a click target for its object. `pickMapTarget` (`src/rendering/bodyPick.ts`) gives the order: a marker that the pointer is directly on, then the label below the pointer, then a catalog point that is nearer than the marker, then the marker.

## Layout

- The header card (`.atlas-bar`) has the title, the search field, the language, and the time bar. Its width gives way to an open panel (`--workspace-width`).
- Script-set layout tokens: `--atlas-bar-bottom` (bottom edge of the header), `--atlas-toolbar-height`, and `--atlas-toolbar-clearance` (distance from the window bottom to the top of the toolbar). The tour card uses the last one to stay above the toolbar.
- Below 520 px the toolbar has no layer switches. They are in Settings (`Map overlays`).
- A text that can change (for example the zoom text) is one line with an ellipsis, so that it cannot change the height of a toolbar.

## Guard tests

- `tests/ui_consistency_guardrail_test.py`: one number formatter, no exponent form, no text below 12 px (style sheets and canvas), one sans-serif stack, and no style token that is used and not defined.
- `tests/i18nParity.test.ts`: each English key has its own value in each of the eight other locales. `tests/i18n_same_as_english.txt` lists the keys that can be equal to English.
- `src/styles/community.css` (plan 24) is not in the scope of these guards.
