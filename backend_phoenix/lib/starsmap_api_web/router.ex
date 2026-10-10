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

  pipeline :health do
    plug :accepts, ["json"]
  end

  pipeline :sky_card do
    plug StarsmapApiWeb.Plugs.RateLimit, capacity: 30, refill_per_second: 0.25
  end

  scope "/", StarsmapApiWeb do
    pipe_through :sky_card
    get "/sky/:key/card.png", SkyShareController, :card
  end

  scope "/", StarsmapApiWeb do
    get "/catalog-tiles/v1/*path", CatalogTileProxyController, :show

    pipe_through :browser

    get "/", PageController, :index
    get "/embed", PageController, :embed
    get "/about", PageController, :about
    get "/agents", AgentController, :show
    get "/agents.json", AgentController, :guide_json
    get "/llms.txt", AgentController, :llms
    get "/openapi.json", AgentController, :openapi
    get "/methodology", MethodologyController, :show
    get "/sky/:key", SkyShareController, :show
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
    pipe_through :health

    get "/health", HealthController, :show
  end

  scope "/api", StarsmapApiWeb do
    pipe_through :api

    get "/community/config", CommunityController, :config
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
    get "/catalog/sky", CatalogController, :sky
    get "/catalog/viewport", CatalogController, :viewport
    get "/spacecraft", PythonProxyController, :spacecraft
    get "/ephemeris", PythonProxyController, :ephemeris
    get "/small-body-ephemeris", PythonProxyController, :small_body_ephemeris
    get "/small-body-orbit", PythonProxyController, :small_body_orbit
    get "/orbits", PythonProxyController, :orbits
    get "/trails", PythonProxyController, :trails
    get "/observe", PythonProxyController, :observe
    get "/objects/:key/external-links", ObjectController, :external_links
    get "/objects/:key", ObjectController, :show
    get "/agent/v1/objects/search", AgentApiController, :search
    get "/agent/v1/objects/:key", AgentApiController, :object
    get "/agent/v1/catalogs", AgentApiController, :catalogs
    get "/agent/v1/view-link", AgentApiController, :view_link
  end

  pipeline :community_public do
    plug :accepts, ["json"]
    plug StarsmapApiWeb.Plugs.CommunityAccess
  end

  pipeline :community_html do
    plug StarsmapApiWeb.Plugs.CommunityAccess
    plug StarsmapApiWeb.Plugs.FramePolicy
  end

  scope "/", StarsmapApiWeb do
    pipe_through :community_html
    get "/community/:page", CommunityPolicyController, :show
    get "/photos/:id", CommunityPageController, :photo
    get "/u/:handle", CommunityPageController, :profile
  end

  pipeline :community_session do
    plug StarsmapApiWeb.Plugs.CommunityAccess, session: true, required: true
  end

  pipeline :community_media do
    plug StarsmapApiWeb.Plugs.CommunityAccess, session: true
  end

  scope "/api", StarsmapApiWeb do
    pipe_through :community_public
    get "/photos/index", CommunityController, :index
    get "/objects/:key/photos", CommunityController, :gallery
    get "/photos/:id", CommunityController, :show
    get "/community/rankings", CommunityController, :rankings
    get "/community/photographers", CommunityController, :photographers
    get "/community/photographers/:handle", CommunityController, :photographer
    get "/community/coverage", CommunityController, :coverage
    post "/community/code", CommunityController, :code
    post "/community/verify", CommunityController, :verify
    post "/photos/:id/report", CommunityController, :report
    put "/community/upload/:id", CommunityController, :upload
  end

  scope "/api/community", StarsmapApiWeb do
    pipe_through :community_session
    get "/me", CommunityController, :me
    get "/export", CommunityController, :export
    delete "/account", CommunityController, :erase
    post "/logout", CommunityController, :logout
    patch "/profile", CommunityController, :profile
    post "/uploads", CommunityController, :intent
    post "/photos/:id/solve", CommunityController, :solve
    post "/photos/:id/wcs", CommunityController, :wcs
    post "/photos/:id/complete", CommunityController, :complete
    post "/photos/:id/vote", CommunityController, :vote
    get "/photos/:id/vote", CommunityController, :vote_state
    delete "/photos/:id/vote", CommunityController, :vote
    delete "/photos/:id", CommunityController, :remove
    get "/review", CommunityController, :review_queue
    get "/review/photos", CommunityController, :review_list
    get "/review/log", CommunityController, :review_log
    post "/photos/:id/review", CommunityController, :review
    post "/users/:handle/suspension", CommunityController, :suspend
    post "/users/:handle/cancel-votes", CommunityController, :cancel_votes
  end

  scope "/api/community", StarsmapApiWeb do
    pipe_through :community_media
    get "/session", CommunityController, :session
    get "/media/:id/:size", CommunityController, :media
  end

  # This scope is the last one: an API address that no route above has is not found.
  scope "/api", StarsmapApiWeb do
    match :*, "/*path", ApiFallbackController, :not_found
  end
end
