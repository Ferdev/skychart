"""Source guards for the interface rules of docs/ui-style.md: one number formatter, one font stack,
no text below 12 px, and no style token that is used and not defined."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
STYLE_SHEETS = sorted((SRC / "styles").glob("*.css")) + [SRC / "destinationPicker.css", SRC / "styles.css"]

# The export footer is a fixed English provenance line in the image file.
DIRECT_FORMAT_EXEMPT = {SRC / "exportCompositor.ts"}
# The performance panel is a diagnostic tool with fixed-width millisecond values.
SMALL_CANVAS_TEXT_EXEMPT: set[Path] = set()
MINIMUM_TEXT_PX = 12
ROOT_FONT_PX = 16


def typescript_sources():
    for path in sorted(SRC.rglob("*.ts")):
        if (SRC / "format") in path.parents:
            continue
        yield path


def without_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", text)


def test_numbers_and_dates_use_the_application_locale():
    """`src/format/` is the one place that makes an `Intl` formatter with the application locale."""
    problems = []
    for path in typescript_sources():
        if path in DIRECT_FORMAT_EXEMPT:
            continue
        code = without_comments(path.read_text())
        for pattern in [r"Intl\.NumberFormat\(\s*undefined", r"Intl\.DateTimeFormat\(\s*undefined", r"toLocaleString\(\s*(undefined|\))",
                        r"toLocaleDateString\(", r"toLocaleTimeString\(", r"[\"']en-US[\"']"]:
            if re.search(pattern, code):
                problems.append(f"{path.relative_to(ROOT)}: {pattern}")
    assert problems == []


def test_no_exponent_form_in_text_for_the_user():
    problems = [str(path.relative_to(ROOT)) for path in typescript_sources()
                if path not in DIRECT_FORMAT_EXEMPT and "toExponential" in without_comments(path.read_text())]
    assert problems == []


def small_sizes(value: str):
    for number, unit in re.findall(r"(?<![\w.-])(\d*\.?\d+)(px|rem)\b", value):
        pixels = float(number) * (ROOT_FONT_PX if unit == "rem" else 1)
        if 0 < pixels < MINIMUM_TEXT_PX:
            yield f"{number}{unit}"


def test_style_sheets_have_no_text_below_12_px():
    problems = []
    for sheet in STYLE_SHEETS:
        css = re.sub(r"/\*.*?\*/", "", sheet.read_text(), flags=re.S)
        for match in re.finditer(r"(?<![-\w])font-size:\s*([^;}]+)", css):
            problems += [f"{sheet.name}: font-size {size}" for size in small_sizes(match.group(1))]
        for match in re.finditer(r"(?<![-\w])font:\s*([^;}]+)", css):
            # In the shorthand, the size is the length before the family or the line height.
            size_part = match.group(1).split("/")[0]
            problems += [f"{sheet.name}: font {size}" for size in small_sizes(size_part)]
    assert problems == []


def test_canvas_text_is_12_px_or_larger():
    problems = []
    for path in typescript_sources():
        if path in SMALL_CANVAS_TEXT_EXEMPT:
            continue
        code = without_comments(path.read_text())
        for match in re.finditer(r"canvasFont\(\s*(\d+(?:\.\d+)?)", code):
            if float(match.group(1)) < MINIMUM_TEXT_PX:
                problems.append(f"{path.relative_to(ROOT)}: canvasFont({match.group(1)})")
        for match in re.finditer(r"\.font\s*=\s*[`\"']([^`\"']*)", code):
            for size in re.findall(r"(\d+(?:\.\d+)?)px", match.group(1)):
                if float(size) < MINIMUM_TEXT_PX:
                    problems.append(f"{path.relative_to(ROOT)}: font {size}px")
    assert problems == []


def test_one_sans_serif_font_stack():
    problems = []
    for path in [*STYLE_SHEETS, *typescript_sources(), ROOT / "index.html"]:
        text = path.read_text()
        if re.search(r"\bGeorgia\b", text) or re.search(r"(?<![-\w])serif\b", text):
            problems.append(str(path.relative_to(ROOT)))
    assert problems == []


def test_each_used_style_token_is_defined():
    css = "\n".join(sheet.read_text() for sheet in STYLE_SHEETS)
    scripts = "\n".join(path.read_text() for path in SRC.rglob("*.ts"))
    html = (ROOT / "index.html").read_text()
    defined = set(re.findall(r"(--[\w-]+)\s*:", css))
    # Tokens that a script sets on an element.
    defined |= set(re.findall(r"setProperty\(\s*[\"'`](--[\w-]+)", scripts))
    defined |= set(re.findall(r"(--[\w-]+)\s*:", scripts))
    defined |= set(re.findall(r"style=\"[^\"]*?(--[\w-]+)\s*:", html))
    # A token with a fallback value must be defined also: the fallback hides a wrong name.
    used = set(re.findall(r"var\(\s*(--[\w-]+)\s*[,)]", css))
    assert sorted(used - defined) == []


def test_canvas_text_uses_the_font_stack_of_the_style_sheets():
    css_stack = re.search(r"--font-sans:\s*([^;]+);", (SRC / "styles" / "foundations.css").read_text()).group(1)
    canvas_stack = re.search(r"export const FONT_SANS = '([^']+)';", (SRC / "format" / "fonts.ts").read_text()).group(1)
    assert " ".join(canvas_stack.split()) == " ".join(css_stack.split())
