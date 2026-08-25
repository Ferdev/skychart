defmodule StarsmapApiWeb.Router do
  use StarsmapApiWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug StarsmapApiWeb.Plugs.RateLimit, capacity: 240, refill_per_second: 4.0
    plug StarsmapApiWeb.Plugs.FramePolicy
  end

  pipeline :api do
    plug :accepts, ["json"]
    plug StarsmapApiWeb.Plugs.RateLimit, capacity: 180, refill_per_second: 3.0
  end

  scope "/", StarsmapApiWeb do
    get "/catalog-tiles/v1/*path", CatalogTileProxyController, :show

    pipe_through :browser

    get "/", PageController, :index
    get "/embed", PageController, :embed
    get "/about", PageController, :about
    get "/methodology", MethodologyController, :show
    get "/o/:key", ObjectPageController, :show
    get "/object-types/:type", ObjectPageController, :type_image
    get "/sitemap.xml", SitemapController, :index
    get "/feed.xml", NowController, :feed
    get "/sitemaps/:catalog", SitemapController, :catalog
    get "/tours", TourPageController, :index
    get "/tours/:slug", TourPageController, :show

    if Application.compile_env(:starsmap_api, :dev_routes, false),
      do: get("/__dev__/sentry-test", PageController, :sentry_test)
  end

  scope "/api", StarsmapApiWeb do
    pipe_through :api

    get "/health", HealthController, :show
    get "/survey-image", SurveyImageController, :show
    get "/now", NowController, :index
    post "/events", EventController, :create
    get "/catalog", CatalogController, :summary
    get "/catalog/search", CatalogController, :search
    get "/catalog/density", CatalogController, :density
    get "/catalog/nearest", CatalogController, :nearest
    get "/objects/gaia/:source_id", CatalogController, :gaia
    get "/catalog/points.bin", CatalogController, :points_binary
    get "/catalog/points", CatalogController, :points
    get "/catalog/viewport", CatalogController, :viewport
    get "/ephemeris", PythonProxyController, :ephemeris
    get "/small-body-ephemeris", PythonProxyController, :small_body_ephemeris
    get "/small-body-orbit", PythonProxyController, :small_body_orbit
    get "/orbits", PythonProxyController, :orbits
    get "/trails", PythonProxyController, :trails
    get "/observe", PythonProxyController, :observe
    get "/objects/:key/external-links", ObjectController, :external_links
    get "/objects/:key", ObjectController, :show
  end
end
