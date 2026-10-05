# MVC Architecture slide generator

Builds `MVC-Architecture-API.pptx` (slide text in Thai) at the project root — **70 slides** = cover + MVC explainer slide +
table of contents + 8 section dividers + **59 endpoint slides (1 endpoint per slide)**

## Usage

```bash
python docs/mvc-slides/build.py              # build the .pptx + preview images of every slide + layout check
python docs/mvc-slides/build.py --no-png     # build the .pptx only
python docs/mvc-slides/build.py --only 7,29  # render previews for selected slides only
python docs/mvc-slides/verify_pptx.py        # check the output: slide count, Thai fonts and XML structure
```

Requires `python-pptx`, `Pillow`, `lxml`, and must run on Windows (font files are read from `C:\Windows\Fonts`)

## Editing content

Edit [endpoints.py](endpoints.py) and rerun `build.py` — one `Endpoint` is one slide,
with the main fields `view_in` (the screen that sends the request), `controller`, `model`, `db`, `view_out`,
`summary` (5 points in the summary box) and `note` (the red note line)

## Structure

| File | Purpose |
|---|---|
| [endpoints.py](endpoints.py) | Content of all 59 endpoints |
| [content.py](content.py) | Data structure of one endpoint |
| [theme.py](theme.py) | Colors, fonts, font sizes and column coordinates |
| [layout.py](layout.py) | Lays out each slide type |
| [spec.py](spec.py) | Shared primitives + text measuring and line wrapping |
| [render_pptx.py](render_pptx.py) | Writes the .pptx file |
| [render_png.py](render_png.py) | Renders PNGs for visual review |
| [check_fit.py](check_fit.py) | Checks for text overflowing its box and overlapping elements |
| [verify_pptx.py](verify_pptx.py) | Checks the finished .pptx file |

`layout.py` places everything, in inches, into a single set of primitives, and both the `.pptx` writer
and the PNG renderer read that same spec — so the previews in `preview/` reflect the layout of the real file

## Things to know

- **Font**: uses `Leelawadee UI`, which ships with every Windows machine. Opened on macOS, it may be replaced by another font
- **Arrow →**: Leelawadee UI has no glyph for it, so the generator splits the run and uses Arial for the arrow alone
- **Thai text in PowerPoint**: you must write `<a:cs>`, not just `<a:latin>`, and the order must be latin → ea → cs
  (`verify_pptx.py` checks both)
