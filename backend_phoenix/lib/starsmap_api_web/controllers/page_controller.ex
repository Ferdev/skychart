defmodule StarsmapApiWeb.PageController do
  use StarsmapApiWeb, :controller

  def index(conn, _params) do
    send_shell(conn, :atlas)
  end

  def embed(conn, _params) do
    send_shell(conn, :embed)
  end

  defp send_shell(conn, mode) do
    head =
      case catalog_tile_manifest_url() do
        "" ->
          ""

        _manifest_url ->
          ~s(<meta name="catalog-tile-manifest-url" content="/catalog-tiles/v1/manifest.json">)
      end

    case StarsmapApiWeb.ServerShell.render(mode: mode, head: head) do
      {:ok, document} ->
        conn |> put_resp_content_type("text/html") |> send_resp(200, document)

      {:error, :not_built} ->
        conn
        |> put_status(:service_unavailable)
        |> html("""
        <!doctype html>
        <html lang="en">
          <head><meta charset="utf-8"><title>Starsmap atlas not built</title></head>
          <body>
            <h1>Starsmap atlas is not built yet</h1>
            <p>Build the Vite atlas and copy it into backend_phoenix/priv/static before using Phoenix as the browser entrypoint.</p>
          </body>
        </html>
        """)
    end
  end

  def about(conn, _params) do
    html(conn, """
    <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>About and data credits — Cosmic Atlas</title><meta name="description" content="Data sources, acknowledgments, and licensing information for Cosmic Atlas.">
    <link rel="canonical" href="https://skychart.org/about"><link rel="icon" href="/favicon.svg"><style>#{about_css()}</style></head><body><main><a href="/">← Return to the atlas</a>
    <p class="eyebrow">Cosmic Atlas / field notes</p><h1>About the atlas</h1><p class="lede">Cosmic Atlas places public scientific catalogs into one continuous, physically scaled map. It is an orientation and discovery companion; source catalogs and specialist tools remain authoritative for quantitative work.</p>
    <h2>Data credits and acknowledgments</h2><div class="ledger">
    <section><h3>ESA / Gaia / DPAC</h3><p>This work has made use of data from the European Space Agency mission <a href="https://www.cosmos.esa.int/gaia">Gaia</a>, processed by the Gaia Data Processing and Analysis Consortium (DPAC). Funding for DPAC has been provided by national institutions participating in the Gaia Multilateral Agreement.</p></section>
    <section><h3>DESI DR1</h3><p>This research uses data from the <a href="https://data.desi.lbl.gov/doc/acknowledgments/">Dark Energy Spectroscopic Instrument</a>, supported by the U.S. Department of Energy and participating institutions.</p></section>
    <section><h3>NASA Exoplanet Archive</h3><p>Exoplanet data come from the <a href="https://exoplanetarchive.ipac.caltech.edu/">NASA Exoplanet Archive</a>, operated by Caltech under contract with NASA.</p></section>
    <section><h3>SIMBAD / CDS</h3><p>Selected object records use <a href="https://simbad.cds.unistra.fr/">SIMBAD</a>, operated at CDS, Strasbourg, France.</p></section>
    <section><h3>OpenNGC</h3><p>NGC and IC records use the community-maintained <a href="https://github.com/mattiaverga/OpenNGC">OpenNGC</a> database under its published license.</p></section>
    <section><h3>JPL SSD / Horizons</h3><p>Solar-system object and ephemeris data use NASA Jet Propulsion Laboratory <a href="https://ssd.jpl.nasa.gov/">Solar System Dynamics</a> resources and <a href="https://ssd.jpl.nasa.gov/horizons/">Horizons</a>.</p></section>
    <section><h3>NAIF</h3><p>Reference frames and kernels use resources from NASA's <a href="https://naif.jpl.nasa.gov/naif/">Navigation and Ancillary Information Facility</a> (NAIF/SPICE).</p></section></div>
    <h2>Use with care</h2><p>Displayed density reflects catalog selection, measurement quality, and rendering level of detail. Missing uncertainty, epoch, completeness, or distance semantics means not supplied, never zero.</p></main></body></html>
    """)
  end

  def sentry_test(conn, _params) do
    Sentry.capture_message("Cosmic Atlas forced server test", level: :error)
    json(conn, %{ok: true})
  end

  defp about_css do
    ":root{color-scheme:dark;background:#080a09;color:#e9eee8;font:16px/1.65 system-ui,sans-serif}body{margin:0;background:#080a09}main{max-width:900px;margin:auto;padding:5rem 1.5rem 8rem}a{color:#b9d9c9}.eyebrow{color:#82a593;text-transform:uppercase;letter-spacing:.18em;font-size:.72rem}h1{font:clamp(3rem,8vw,6rem)/.95 Georgia,serif}.lede{font-size:1.25rem;color:#bac5be}.ledger{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1px;background:#39443e}.ledger section{background:#101512;padding:1.4rem}h2{margin-top:4rem}h3{font:1.3rem Georgia,serif}p{color:#c8d0cb}"
  end

  defp catalog_tile_manifest_url do
    "CATALOG_TILE_MANIFEST_URL"
    |> System.get_env("")
    |> String.trim()
  end
end
