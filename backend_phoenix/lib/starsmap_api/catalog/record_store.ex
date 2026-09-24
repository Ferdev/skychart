defmodule StarsmapApi.Catalog.RecordStore do
  @moduledoc """
  Immutable source-record provenance, independent of public object identities.

  This additive store establishes the ingestion contract. Bulk source adapters
  must pass the capacity gate before choosing their full-volume storage layout.
  Records are never inferred to be the same object merely from their positions.
  """
  import Ecto.Query
  alias StarsmapApi.Repo

  @namespace ~w(provider catalog release source_id)

  def put_record!(record) do
    record = normalize!(record)
    key = record_key(record)

    attrs =
      Map.new(~w(provider catalog release source_id)a, fn field ->
        {field, record[Atom.to_string(field)]}
      end)

    attrs = Map.merge(attrs, %{record_key: key, record: record})

    Repo.insert_all("catalog_record_versions", [attrs], on_conflict: :nothing)

    if get_record(key) != record do
      raise ArgumentError, "source record changed within a pinned release"
    end

    key
  end

  def get_record(key) when is_binary(key) and byte_size(key) == 64 do
    Repo.one(from r in "catalog_record_versions", where: r.record_key == ^key, select: r.record)
  end

  def get_record(_), do: nil

  def record_key(record) do
    @namespace
    |> Enum.map(&Map.fetch!(record, &1))
    |> Jason.encode!()
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end

  def normalize!(record) when is_map(record) do
    Enum.each(@namespace ++ ["name", "documentation"], fn field ->
      value = record[field]

      unless is_binary(value) and String.trim(value) != "" do
        raise ArgumentError,
              "#{field} must be nonempty text (IDs must never pass through floating point)"
      end
    end)

    astrometry = record["astrometry"] || %{}
    ra = coordinate!(astrometry["ra_deg"], 0, 360, false)
    dec = coordinate!(astrometry["dec_deg"], -90, 90, true)
    angular = is_number(ra) and is_number(dec)

    if angular and not is_binary(astrometry["frame"]),
      do: raise(ArgumentError, "angular frame required")

    spatial = record["spatial"]

    if not is_nil(spatial) do
      unless is_map(spatial) and Enum.all?(~w(x_au y_au z_au), &is_number(spatial[&1])) and
               spatial["frame"] == "heliocentric-ecliptic-J2000-v1" and
               spatial["distance_model"] in ~w(parallax_estimate literature cosmological_comoving) and
               is_map(spatial["evidence"]) and map_size(spatial["evidence"]) > 0 do
        raise ArgumentError,
              "spatial position requires declared frame, distance model and evidence"
      end
    end

    ephemeris = record["ephemeris"]

    if not is_nil(ephemeris) do
      unless is_map(ephemeris) and
               Enum.all?(~w(model epoch provenance), &is_binary(ephemeris[&1])) do
        raise ArgumentError, "dynamic position requires dated ephemeris provenance"
      end
    end

    # JSON encoding rejects nonfinite values; arbitrary original scientific
    # measurements, units, flags, component relationships and aliases survive.
    record
    |> Map.put("capabilities", %{
      "searchable_metadata" => true,
      "angular_position" => angular,
      "spatial_position" => not is_nil(spatial),
      "dynamic_ephemeris" => not is_nil(ephemeris)
    })
    |> Jason.encode!()
    |> Jason.decode!()
  end

  defp coordinate!(nil, _, _, _), do: nil

  defp coordinate!(v, lo, hi, inclusive) when is_number(v) do
    if v >= lo and (v < hi or (inclusive and v == hi)),
      do: v,
      else: raise(ArgumentError, "coordinate out of range")
  end

  defp coordinate!(_, _, _, _), do: raise(ArgumentError, "coordinate must be numeric or null")

  def append_evidence!(attrs) do
    unless attrs.status in ~w(candidate confirmed retracted) and
             attrs.method in ~w(published_identifier curated epoch_uncertainty_policy) and
             is_binary(attrs.public_key) and attrs.public_key != "" and
             is_map(attrs.provenance) and map_size(attrs.provenance) > 0 do
      raise ArgumentError, "identification needs explicit status, method and provenance"
    end

    if attrs.method == "epoch_uncertainty_policy" and
         not Enum.all?(
           ~w(policy source_epoch target_epoch uncertainty score),
           &Map.has_key?(attrs.provenance, &1)
         ) do
      raise ArgumentError,
            "positional evidence requires versioned policy, epochs, uncertainty and score"
    end

    attrs = Map.put_new(attrs, :supersedes, nil)

    if attrs.status == "retracted" and is_nil(attrs.supersedes),
      do: raise(ArgumentError, "retraction must identify preceding evidence")

    if attrs.supersedes do
      previous =
        Repo.one(
          from e in "catalog_identification_evidence",
            where: e.evidence_key == ^attrs.supersedes,
            select: %{record_key: e.record_key, public_key: e.public_key}
        )

      unless previous == Map.take(attrs, [:record_key, :public_key]),
        do:
          raise(ArgumentError, "superseded evidence must refer to the same record and public key")
    end

    Repo.insert_all("catalog_identification_evidence", [attrs])
    :ok
  end

  def evidence_for(public_key) do
    Repo.all(
      from e in "catalog_identification_evidence",
        left_join: newer in "catalog_identification_evidence",
        on: newer.supersedes == e.evidence_key,
        where:
          e.public_key == ^public_key and is_nil(newer.evidence_key) and e.status != "retracted",
        order_by: e.evidence_key,
        limit: 101,
        select: %{
          evidence_key: e.evidence_key,
          record_key: e.record_key,
          status: e.status,
          method: e.method,
          provenance: e.provenance
        }
    )
    |> then(fn rows -> %{evidence: Enum.take(rows, 100), has_more: length(rows) > 100} end)
  end
end
