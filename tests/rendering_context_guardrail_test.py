import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "src" / "main.ts").read_text()
PLANNER = (ROOT / "src" / "catalog" / "catalogPointPlanner.ts").read_text()
STREAM = (ROOT / "src" / "catalog" / "catalogPointStream.ts").read_text()
STATS = (ROOT / "src" / "atlas" / "atlasStatsView.ts").read_text()
MILKY_WAY = (ROOT / "src" / "rendering" / "milkyWayRenderer.ts").read_text()
INSPECTION = (ROOT / "src" / "object" / "objectInspectionView.ts").read_text()
INDEX = (ROOT / "index.html").read_text()
GALACTIC = (ROOT / "src" / "galacticModel.ts").read_text()
RENDERER = (ROOT / "src" / "webglPointRenderer.ts").read_text()


def test_static_tile_requests_are_prioritized_and_diagnostics_track_pressure():
    assert "prioritize(requests" in PLANNER
    assert "priority:" in PLANNER
    assert 'phase: "active"' in PLANNER
    assert 'phase: "prefetch"' in STREAM
    for metric in ["queued", "activeInFlight", "prefetchInFlight", "abortedRequests"]:
        assert metric in STREAM
    assert "Pressure" in STATS


def test_context_and_diagnostics_controls_explain_rendering_modes():
    assert 'id="diagnostics-toggle"' in INDEX
    assert 'id="context-mode-status"' in INDEX
    for text in ["Gaia/catalog points", "Milky Way context", "Extragalactic catalog"]:
        assert text in INDEX
    for layer in ["milkyWayArms", "milkyWayDust", "milkyWayGuides"]:
        assert f'data-layer="{layer}"' in INDEX
        assert re.search(rf"\b{layer}:\s*true", MAIN)


def test_milky_way_components_are_independently_gated():
    assert "layers.milkyWayArms" in MILKY_WAY
    assert "layers.milkyWayDust" in MILKY_WAY
    assert "milkyWayGuides" in MILKY_WAY
    assert "DETAIL_BUDGET_MS" in MILKY_WAY
    assert "previousFrameMs > DETAIL_BUDGET_MS" in MILKY_WAY
    assert "milkyWayMs" in STATS
    assert "simplified" in STATS


def test_models_document_projection_caveats_and_retained_depth():
    assert "GalacticProjectionCaveat" in GALACTIC
    assert "frame: \"galactocentric-j2000-ecliptic\"" in GALACTIC
    assert "retained-depth" in GALACTIC
    assert not (ROOT / "src" / "universeModel.ts").exists()
    assert "desi_dr1" in INSPECTION
    assert "Real DESI DR1 galaxy and quasar point tiles" in INDEX


def test_webgl_renderer_reports_draw_stats_for_diagnostics():
    assert "PointRenderStats" in RENDERER
    assert "pointsDrawn" in RENDERER


def test_invalidation_driven_webgl_canvas_retains_its_drawing_buffer():
    assert "preserveDrawingBuffer: true" in RENDERER
    assert "webglcontextlost" in RENDERER
    assert "point-renderer-unavailable" in RENDERER
    assert "capped" in RENDERER
