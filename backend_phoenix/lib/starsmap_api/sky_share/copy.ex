defmodule StarsmapApi.SkyShare.Copy do
  @moduledoc false

  @copy %{
    "en" =>
      {"The sky from {name}",
       "Replay the catalog-based sky from {name} at the shared UTC epoch and viewpoint.",
       "Catalog-based geometric reconstruction; observer hidden; no atmosphere, surface, or light-time correction."},
    "es" =>
      {"El cielo desde {name}",
       "Reproduce el cielo basado en catálogos desde {name} en la época UTC y el punto de vista compartidos.",
       "Reconstrucción geométrica basada en catálogos; observador oculto; sin corrección de atmósfera, superficie ni tiempo de luz."},
    "fr" =>
      {"Le ciel depuis {name}",
       "Rejouez le ciel issu des catalogues depuis {name}, à l’époque UTC et au point de vue partagés.",
       "Reconstruction géométrique issue des catalogues ; observateur masqué ; sans correction d’atmosphère, de surface ou de temps de lumière."},
    "de" =>
      {"Der Himmel von {name}",
       "Rufen Sie den katalogbasierten Himmel von {name} zum geteilten UTC-Zeitpunkt und Blickwinkel auf.",
       "Katalogbasierte geometrische Rekonstruktion; Beobachter ausgeblendet; keine Atmosphären-, Oberflächen- oder Lichtzeitkorrektur."},
    "pt-BR" =>
      {"O céu visto de {name}",
       "Reproduza o céu baseado em catálogos visto de {name}, na época UTC e no ponto de vista compartilhados.",
       "Reconstrução geométrica baseada em catálogos; observador oculto; sem correção de atmosfera, superfície ou tempo de luz."},
    "it" =>
      {"Il cielo da {name}",
       "Riproduci il cielo basato sui cataloghi da {name}, all’epoca UTC e dal punto di vista condivisi.",
       "Ricostruzione geometrica basata su cataloghi; osservatore nascosto; nessuna correzione per atmosfera, superficie o tempo-luce."},
    "zh-Hans" =>
      {"从{name}看到的天空", "按分享的 UTC 历元和视点重现从{name}看到的星表天空。", "基于星表的几何重建；隐藏观测者；未进行大气、表面或光行时修正。"},
    "ja" =>
      {"{name}から見た空", "共有されたUTC時刻と視点で、{name}から見たカタログベースの空を再現します。",
       "カタログに基づく幾何学的再構成。観測者は非表示。大気・表面・光行時間の補正なし。"},
    "ko" =>
      {"{name}에서 본 하늘", "공유된 UTC 시각과 시점에서 {name}의 카탈로그 기반 하늘을 재현합니다.",
       "카탈로그 기반 기하학적 재구성; 관측자 숨김; 대기, 표면 또는 광행시간 보정 없음."}
  }

  def title(locale, name), do: phrase(locale, 0) |> replace_name(name)
  def description(locale, name), do: phrase(locale, 1) |> replace_name(name)
  def disclosure(locale), do: phrase(locale, 2)
  def image_alt(locale, name), do: title(locale, name) <> " — Cosmic Atlas Sky share card"

  defp phrase(locale, index) do
    tuple = Map.get(@copy, locale, Map.fetch!(@copy, "en"))
    elem(tuple, index)
  end

  defp replace_name(value, name), do: String.replace(value, "{name}", name)
end
