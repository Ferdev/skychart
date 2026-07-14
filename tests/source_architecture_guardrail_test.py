"""Prevent the atlas from collapsing back into giant source files."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "src" / "main.ts"
SERVER = ROOT / "backend" / "server.py"


def source_files():
    patterns = {
        ROOT / "src": ("*.ts", "*.css"),
        ROOT / "backend": ("*.py",),
        ROOT / "backend_phoenix" / "lib": ("*.ex",),
        ROOT / "scripts": ("*.py", "*.mjs"),
    }
    for directory, globs in patterns.items():
        for pattern in globs:
            yield from directory.rglob(pattern)


def test_executable_source_files_stay_below_the_monolith_limit():
    oversized = {}
    for path in source_files():
        lines = path.read_text(encoding="utf-8").splitlines()
        executable_lines = sum(bool(line.strip()) for line in lines)
        if executable_lines > 1_000:
            oversized[str(path.relative_to(ROOT))] = executable_lines
    assert not oversized, f"split oversized source modules: {oversized}"


def test_entrypoints_are_composition_roots():
    main = MAIN.read_text(encoding="utf-8")
    server = SERVER.read_text(encoding="utf-8")
    for module_area in ["./atlas/", "./catalog/", "./destination/", "./navigation/", "./object/", "./rendering/"]:
        assert module_area in main
    assert len(server.splitlines()) <= 40
    assert "ThreadingHTTPServer" in server and "Handler" in server


def test_stylesheet_entrypoint_only_composes_named_layers():
    stylesheet = (ROOT / "src" / "styles.css").read_text(encoding="utf-8")
    declarations = [line for line in stylesheet.splitlines() if line.strip() and not line.lstrip().startswith("@import")]
    assert not declarations
    assert stylesheet.count("@import") >= 6
