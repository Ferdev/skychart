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

  # A night plan calculates thousands of altitude curves, so it has a budget of its own.
  pipeline :night_plan do
    plug :accepts, ["json"]
    plug StarsmapApiWeb.Plugs.RateLimit, capacity: 20, refill_per_second: 0.33, scope: :night_plan
  end

  pipeline :sky_card do
    plug StarsmapApiWeb.Plugs.RateLimit, capacity: 30, refill_per_second: 0.25
  end

  scope "/", StarsmapApiWeb do
    pipe_through :sky_card
    get "/sky/:key/card.png", SkyShareController, :card
  end

  # A calendar client sends `Accept: text/calendar`, so this route has no HTML content negotiation.
  pipeline :calendar do
    plug StarsmapApiWeb.Plugs.RateLimit, capacity: 60, refill_per_second: 1.0, scope: :calendar
  end

  scope "/", StarsmapApiWeb do
    pipe_through :calendar
    get "/calendar.ics", NowController, :calendar
  end

  # A tool call can start a database search or an ephemeris calculation, so MCP has
  # its own budget for each client, smaller than the budget of the JSON API.
  pipeline :mcp do
    plug StarsmapApiWeb.Plugs.RateLimit, capacity: 120, refill_per_second: 2.0, scope: :mcp
  end

  scope "/", StarsmapApiWeb do
    pipe_through :mcp
    post "/mcp", McpController, :message
    match :*, "/mcp", McpController, :method_not_allowed
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

  # A list can start hundreds of searches, so a client has a small budget of lists.
  pipeline :catalog_match do
    plug :accepts, ["json"]

    plug StarsmapApiWeb.Plugs.RateLimit,
      capacity: 12,
      refill_per_second: 0.2,
      scope: :catalog_match
  end

  scope "/api", StarsmapApiWeb do
    pipe_through :catalog_match

    post "/catalog/match", CatalogController, :match
  end

  scope "/api", StarsmapApiWeb do
    pipe_through :night_plan

    post "/observe/plan", PythonProxyController, :night_plan
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

  # A class opens one shared tour from one address, so this limit is for each tour reader.
  pipeline :community_shared_tour do
    plug :accepts, ["json"]

    plug StarsmapApiWeb.Plugs.CommunityAccess,
      capacity: 240,
      refill_per_second: 4.0,
      scope: :shared_tour
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
    get "/photos/sky", CommunityController, :sky
    get "/objects/:key/photos", CommunityController, :gallery
    get "/photos/:id", CommunityController, :show
    get "/community/rankings", CommunityController, :rankings
    get "/community/photographers", CommunityController, :photographers
    get "/community/photographers/:handle", CommunityController, :photographer
    get "/community/coverage", CommunityController, :coverage
    post "/community/code", CommunityController, :code
    post "/community/verify", CommunityController, :verify
    post "/photos/:id/report", CommunityController, :report
    post "/community/shared-tours/:token/report", CommunityController, :report_tour
    put "/community/upload/:id", CommunityController, :upload
  end

  scope "/api/community", StarsmapApiWeb do
    pipe_through :community_shared_tour
    get "/shared-tours/:token", CommunityController, :shared_tour
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
    get "/review/tours", CommunityController, :review_tours
    post "/tours/:id/review", CommunityController, :review_tour
    get "/tours", CommunityController, :tours
    post "/tours", CommunityController, :create_tour
    patch "/tours/:id", CommunityController, :update_tour
    delete "/tours/:id", CommunityController, :delete_tour
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
