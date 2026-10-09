defmodule StarsmapApi.Community.Subjects do
  @moduledoc "Source-backed photo identity without foreign keys into catalog views."
  import Ecto.Query
  alias StarsmapApi.Community.{Subject, CoreObjects}
  alias StarsmapApi.CommunityRepo, as: Repo
  @data Path.expand("../../../priv/community/identity.json", __DIR__)
  @external_resource @data
  @identity Jason.decode!(File.read!(@data))
  @groups @identity["groups"]
  @bulk ~w(gaia_500pc_stars gaia_10kpc_bright_stars desi_dr1_galaxies desi_dr1_quasars quaia_g20_quasars erosita_dr2_xray erosita_dr2_extended sdss_spiders_dr20)

  def keys(key) do
    case Enum.find(@groups, &(key in &1["keys"])) do
      nil -> [key]
      group -> group["keys"]
    end
  end

  def find(key) when is_binary(key) do
    key = String.downcase(key)

    Repo.one(
      from k in "subject_keys",
        join: s in Subject,
        on: s.id == k.subject_id,
        where: k.key == ^key,
        select: s
    )
  end

  def find(_), do: nil

  def ensure(key) when is_binary(key) and byte_size(key) <= 180 do
    key = String.downcase(String.trim(key))

    case find(key) do
      %Subject{} = subject ->
        {:ok, subject}

      nil ->
        with false <- String.starts_with?(key, "catalog-tile-preview:"),
             {:ok, object} <- lookup(key),
             false <- object.catalog_group in @bulk do
          StarsmapApi.Community.transaction(fn ->
            case find(key) do
              nil ->
                subject =
                  Repo.insert!(%Subject{
                    name: object.name,
                    object_type: object.object_type,
                    snapshot:
                      Map.take(object, [
                        :key,
                        :name,
                        :astrometry,
                        :position_model,
                        :position,
                        :source
                      ])
                  })

                Repo.insert_all(
                  "subject_keys",
                  Enum.map(keys(key), &%{key: &1, subject_id: Ecto.UUID.dump!(subject.id)})
                )

                subject

              subject ->
                subject
            end
          end)
        else
          _ -> {:error, :invalid_subject}
        end
    end
  end

  def ensure(_), do: {:error, :invalid_subject}

  def lookup(key) do
    case CoreObjects.get(key) do
      {:ok, object} -> {:ok, object}
      _ -> StarsmapApi.Catalog.PublicObjects.public_object(key)
    end
  end

  def subject_keys(id),
    do:
      Repo.all(
        from k in "subject_keys", where: k.subject_id == ^Ecto.UUID.dump!(id), select: k.key
      )
end
