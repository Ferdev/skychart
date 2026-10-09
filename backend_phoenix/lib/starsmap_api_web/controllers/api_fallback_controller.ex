defmodule StarsmapApiWeb.ApiFallbackController do
  use StarsmapApiWeb, :controller

  @doc """
  An unknown API address. The API answers with JSON for each `Accept` header.
  Other unknown addresses get the page of `StarsmapApiWeb.ErrorHTML`.
  """
  def not_found(conn, _params) do
    conn
    |> put_status(:not_found)
    |> json(StarsmapApiWeb.ErrorJSON.render("404.json", %{}))
  end
end
