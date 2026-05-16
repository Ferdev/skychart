import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "src" / "main.ts").read_text()
INDEX = (ROOT / "index.html").read_text()
I18N = (ROOT / "src" / "i18n.ts").read_text()


def test_universe_scale_overlay_controls_are_first_class():
    for layer in ["localGroup", "galaxyPoints", "quasars", "cosmicWeb"]:
        assert f'data-layer="{layer}"' in INDEX
        assert re.search(rf"\b{layer}:\s*true", MAIN)


def test_universe_scale_zoom_presets_exist():
    for preset in ["localGroup", "cosmicWeb"]:
        assert f'data-zoom-preset="{preset}"' in INDEX
        assert f'"{preset}"' in MAIN


def test_catalog_point_layers_are_not_capped_at_milky_way_scale():
    assert "POINT_LAYER_DEEP_SKY_MAX_WIDTH_LY" in MAIN
    assert "POINT_LAYER_QUASAR_MAX_WIDTH_LY" in MAIN
    assert "shouldUseCatalogPoints(viewWidthLy, filterParams)" in MAIN
    assert not re.search(r"function shouldUseCatalogPoints\(viewWidthLy: number\)\s*{\s*return Number\.isFinite\(viewWidthLy\).*POINT_LAYER_MAX_WIDTH_LY", MAIN, re.S)


def test_context_renderers_are_wired_into_frame():
    render_body = MAIN[MAIN.index("function render()") : MAIN.index("function requestRender")]
    for fn in ["drawLocalGroupLayer", "drawGalaxyContextLayer", "drawQuasarContextLayer", "drawCosmicWebLayer"]:
        assert f"{fn}();" in render_body


def test_universe_model_documents_procedural_context_not_fake_catalog_objects():
    model = ROOT / "src" / "universeModel.ts"
    assert model.exists()
    text = model.read_text()
    assert "procedural context" in text.lower()
    assert "not selectable catalog objects" in text.lower()
    for exported in ["LOCAL_GROUP_MODEL", "COSMIC_WEB_MODEL"]:
        assert f"export const {exported}" in text


def test_static_tile_builder_has_universe_scale_levels():
    builder = (ROOT / "scripts" / "build_static_point_tiles.py").read_text()
    assert "42:128:12000" in builder
    assert "44:64:12000" in builder
    for level in ["46:48:9000", "48:24:7500", "50:12:6000"]:
        assert level in builder


def test_universe_scale_density_lod_is_performance_safe():
    assert "drawCatalogDensityLodLayer();" in MAIN
    assert "catalogPointDensityCells" in MAIN
    assert "drawCatalogClusterSummaries" in MAIN
    assert "DENSITY_HAZE_MAX_CELLS" in MAIN
    assert "POINT_TILE_MAX_ACTIVE_UNIVERSE" in MAIN
    assert "POINT_TILE_MAX_POINTS_UNIVERSE" in MAIN


def test_cosmic_web_model_has_non_selectable_density_regions():
    text = (ROOT / "src" / "universeModel.ts").read_text()
    assert "UniverseDensityRegion" in text
    assert "densityRegions" in text
    for marker in ["great-wall-haze", "quasar-north-haze", "bootes-void-context"]:
        assert marker in text


def test_tile_builder_preserves_deep_sky_type_color_channels():
    builder = (ROOT / "scripts" / "build_static_point_tiles.py").read_text()
    assert "POINT_RGB_BY_TYPE" in builder
    assert "object_type," in builder
    assert "POINT_RGB_BY_TYPE.get(object_type" in builder


def test_webgl_renderer_caps_points_per_frame():
    renderer = (ROOT / "src" / "webglPointRenderer.ts").read_text()
    assert "MAX_WEBGL_POINTS_PER_FRAME" in renderer
    assert "drawCount" in renderer


def test_universe_i18n_labels_exist():
    for key in [
        "scale.localGroup",
        "scale.cosmicWeb",
        "scale.galaxyPoints",
        "scale.quasars",
        "explore.universe.title",
        "explore.universe.description",
        "universe.shell.currentView",
        "universe.shell.observable",
        "universe.context.lookback",
    ]:
        assert key in I18N
