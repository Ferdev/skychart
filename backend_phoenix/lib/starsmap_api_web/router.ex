defmodule StarsmapApiWeb.Router do
  use StarsmapApiWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", StarsmapApiWeb do
    pipe_through :browser

    get "/", PageController, :index
  end

  scope "/api", StarsmapApiWeb do
    pipe_through :api

    get "/health", HealthController, :show
    get "/catalog", CatalogController, :summary
    get "/catalog/search", CatalogController, :search
    get "/catalog/density", CatalogController, :density
    get "/catalog/nearest", CatalogController, :nearest
    get "/catalog/points.bin", CatalogController, :points_binary
    get "/catalog/points", CatalogController, :points
    get "/catalog/viewport", CatalogController, :viewport
    get "/ephemeris", PythonProxyController, :ephemeris
    get "/orbits", PythonProxyController, :orbits
    get "/trails", PythonProxyController, :trails
    get "/objects/:key/external-links", ObjectController, :external_links
    get "/objects/:key", ObjectController, :show
  end
end
