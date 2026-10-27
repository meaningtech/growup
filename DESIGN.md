# Growup interface design

Growup uses a map-first workspace with a warm paper inspector and a dark forest navigation frame. Preserve the existing botanical, editorial character when extending controls.

## Tokens

The source tokens live in `src/styles.css`.

| Role | Value |
| --- | --- |
| Forest | `#10281e` |
| Soft forest | `#1d3b2e` |
| Paper | `#f5f3e9` |
| Deep paper | `#e9e5d8` |
| Ink | `#173126` |
| Muted text | `#6e776e` |
| Divider | `rgba(27, 54, 42, 0.13)` |
| Lime / primary action | `#c7e36f` |
| Dark lime | `#728c26` |
| Gold | `#eec16a` |
| Water | `#61c5bb` |
| Danger | `#d95f45` |
| Floating shadow | `0 20px 60px rgba(20, 38, 30, 0.16)` |

## Typography

- Manrope is the interface typeface, with weight 600–800 for controls and labels.
- Newsreader is the editorial heading and brand face; headings typically use weight 400–500.
- DM Mono is used for compact quantities, dates and status indicators.
- Existing text tokens are 10 px micro, 11 px caption, 12 px label, 13 px small, 14 px body and 15 px large body. Interactive inputs on mobile must use at least 16 px.
- Common and scientific species names remain paired; scientific names use italic, muted text.

## Layout and spacing

- Desktop uses a 60 px top bar, an 84 px workflow rail, a flexible map and an inspector of at least 390 px (normally 34 vw).
- The workspace collapses at 820 px and below. Preserve the single-row mobile map dock, safe-area navigation spacing and absence of horizontal overflow.
- Existing controls use 4–8 px internal gaps; cards use 12–16 px padding. Inspector content scrolls independently of the map.
- Keep primary section actions outside tab panels. Preserve internal workflow identifiers and project state when switching tabs.

## Components

- Buttons have 9 px corners, 12 px bold labels and a 38 px minimum height. Primary actions use lime, forest text and a 46 px minimum height.
- Secondary actions use white or transparent paper surfaces and subtle dividers. Active options use forest text with lime or pale green backgrounds.
- Inspector configuration cards use white surfaces, subtle borders and 12 px corners. Group related controls with 6–8 px gaps rather than adding nested cards.
- Species mix rows use pale paper (`#f5f5ee`), a fine border, 9 px corners and paired species names. Numeric inputs use white backgrounds and 7 px corners.
- Numeric fields retain visible labels and units. Controls must have accessible names, selected states and keyboard focus.
- Floating map controls use translucent paper, 11 px corners and the shared shadow. Tooltips use dark forest and readable, short guidance.
- Reserve red for actionable errors and gold for attention. Unknown evidence remains explicitly unknown; data shown to users retains its source, date/version and confidence.

## Verification

Render every changed interface in a browser and inspect screenshots at readable sizes. Verify the complete affected interaction, persistence and recovery, including console errors and failed requests. Extend existing components and tokens instead of introducing another visual system.
