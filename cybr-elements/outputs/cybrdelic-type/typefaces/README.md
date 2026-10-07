# Cybrdelic display fonts — v1.0

Two installable Regular display fonts derived from the approved study 06 marks:

- **Cybrdelic Sigil** — style 01: hooked, tapered, flowing forms.
- **Cybrdelic Cut** — style 02: angular forms, diamond cuts and pointed terminals.

These are expressive display fonts for headlines, artwork, motion and branding. Each includes uppercase, lowercase, numbers, printable Basic Latin and Latin-1 characters, selected additional Latin accents, smart punctuation and currency symbols. They are single-weight Latin fonts, not multilingual body-text families; there are no Cyrillic, Greek or italic sets.

The original artwork supplies key lowercase forms. Connected shapes have been separated or reconstructed for standalone typing; letters absent from the wordmark are newly drawn extensions. Ordinary typed text will therefore differ from the interlocked logo. The complete approved mark is separately included as a traced vector glyph with subpixel outline simplification.

## Desktop use

Open either TTF in `fonts/` and choose Install. Select **Cybrdelic Sigil** or **Cybrdelic Cut** in your design or video application. These files have unrestricted font embedding flags. No system font installation was performed by this build.

## Exact wordmark

Type lowercase `cybrdelic` and enable **Discretionary Ligatures** in applications supporting OpenType features. This substitutes the whole word with its corresponding interlocked artwork. The feature is off by default, preserving normal letter spacing when typing.

Alternatively, use the font's glyph panel to insert **U+E000**. This maps directly to the wordmark and works without ligature support. The standalone SVG masters are in `vector/`.

## Web use

Keep `fonts.css` beside the `fonts/` directory and load it:

```html
<link rel="stylesheet" href="fonts.css">
<h1 class="cybrdelic-sigil">Make something strange</h1>
<div class="cybrdelic-cut cybrdelic-wordmark">cybrdelic</div>
```

Use generous line height (around 1.6) for stacked text to accommodate ascenders, accents and descending flourishes. Default wordmark substitution does not activate for uppercase spelling.

## Files and rebuild

- `fonts/`: installable TTF and compact WOFF2 for each family.
- `specimens/`: rendered font proof sheets.
- `vector/`: vector wordmark masters.
- `source/`: outline JSON, OpenType feature source, approved reference and Python construction scripts.
- `validation.json`: build metrics; `browser-validation.json`: browser font and ligature checks when present.

Rebuild with Python, NumPy, Pillow, Shapely, OpenCV, fontTools and Brotli: `python source/build_families.py`. The specimen captions currently use Windows Arial; change that caption font path on other platforms. Font outlines are constructed independently of Arial.
