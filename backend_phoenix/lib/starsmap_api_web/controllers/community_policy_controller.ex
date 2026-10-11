defmodule StarsmapApiWeb.CommunityPolicyController do
  use StarsmapApiWeb, :controller
  alias StarsmapApiWeb.StaticPage

  # Each page: the title, the summary (also the page description), and the sections.
  # A section is {heading, :list | :steps, items} or {heading, :text, paragraph}.
  @pages %{
    "rules" =>
      {"Community rules",
       "Publish your own astronomical photos or images you have permission to use. A moderator examines each photo before it becomes public.",
       [
         {"What you can publish", :list,
          [
            "A photo of an object that is in the atlas: a planet, a moon, a star, a nebula, a cluster, or a galaxy.",
            "A photo that you made, or a photo that you have permission to publish.",
            "A photo with its capture time, and with the equipment and the processing if you know them."
          ]},
         {"What is not accepted", :list,
          [
            "Synthetic images from an AI tool, and artist impressions.",
            "A photo of a different object from the one that you selected.",
            "A photo that shows private information about another person.",
            "Advertisements, and images that have no astronomical subject."
          ]},
         {"Credit and processing", :list,
          [
            "Select a licence. The licence states how other persons can use your photo.",
            "Declare a composite photo and strong processing. The declaration is shown with the photo.",
            "Give the correct photographer. Do not publish the work of another person as your work."
          ]},
         {"How a photo becomes public", :steps,
          [
            "You sign in with your email address and send the photo from an object in the atlas.",
            "The site removes the private metadata from the file and makes the display sizes.",
            "A moderator examines the photo. The photo is not public during this time.",
            "The moderator approves the photo, or rejects it and gives the reason. You can read the status and the reason in your account."
          ]},
         {"Appreciation and rankings", :list,
          [
            "A signed-in person can appreciate a photo one time. You cannot appreciate your own photo.",
            "A new account can appreciate photos 24 hours after its first sign-in.",
            "The rankings use these appreciations. They do not change the scientific data of the atlas."
          ]},
         {"If you see a problem", :text,
          "Use Report in the photo viewer for a wrong credit, a copyright concern, or a photo that does not obey these rules. A moderator examines each report."}
       ]},
    "terms" =>
      {"Photo publishing terms",
       "You keep the copyright of your photos. You permit Cosmic Atlas to process and show them with your credit.",
       [
         {"Your rights", :list,
          [
            "You keep your copyright.",
            "The licence that you select states the reuse permission for other persons.",
            "You can remove your photos from your account at any time."
          ]},
         {"The permission that you give", :list,
          [
            "Cosmic Atlas can process, show, and share credited versions of your photo as part of this atlas.",
            "Cosmic Atlas keeps a full-resolution copy without the private metadata, and makes smaller display copies."
          ]},
         {"Review", :list,
          [
            "A moderator examines each photo before publication.",
            "A moderator can hide a published photo and must record the reason.",
            "A moderator can suspend an account that does not obey the community rules."
          ]},
         {"Removal", :text,
          "Removal stops the public display of a photo. It cannot remove copies that other persons downloaded before the removal."}
       ]},
    "privacy" =>
      {"Community privacy",
       "The community keeps only the data that it needs to show your photos and to sign you in.",
       [
         {"Data that visitors can see", :list,
          [
            "Your public handle and your display name.",
            "The title, the caption, the capture time, the equipment, the processing, and the licence of each published photo."
          ]},
         {"Data that stays private", :list,
          [
            "Your email address. The site uses it only to send sign-in codes.",
            "The file that you sent. The site removes it seven days after successful processing.",
            "The precise location metadata of a photo. The site removes it from each published file."
          ]},
         {"Cookies", :text,
          "One session cookie identifies your account. The community sets no other cookie."},
         {"Your controls", :list,
          [
            "Export your account data from your account.",
            "Remove your account from your account. This hides all your photos.",
            "Moderation records and backup copies follow the retention policy of the operator."
          ]}
       ]},
    "takedown" =>
      {"Reports and removal",
       "Tell a moderator about a copyright, credit, or content concern. An author can always remove their own photos.",
       [
         {"How to report a photo", :steps,
          [
            "Open the photo in the atlas.",
            "Select Report.",
            "Describe the concern, and tell the moderator how to verify it."
          ]},
         {"What a moderator does", :list,
          [
            "A moderator examines each report.",
            "A moderator can hide the photo and record the reason. The photographer can read the reason.",
            "A hidden photo is removed from the galleries and from the map immediately."
          ]},
         {"If you do not agree with a decision", :text,
          "Use the same report form to request a second review of a moderation decision."},
         {"Your own photos", :text,
          "You can remove your own photos from your account. You do not need a report for that."}
       ]}
  }

  @order ~w(rules terms privacy takedown)

  def show(conn, %{"page" => page}) do
    case @pages[page] do
      nil ->
        conn |> put_status(:not_found) |> html(StaticPage.not_found())

      {title, summary, sections} ->
        # A policy page is a standalone static page, with no map below the text.
        html(
          conn,
          StaticPage.document(
            title: title <> " — Cosmic Atlas",
            description: summary,
            canonical: StarsmapApiWeb.Endpoint.url() <> "/community/" <> page,
            body:
              "<nav aria-label=\"Site\">#{StaticPage.back_link()}#{links(page)}</nav>" <>
                "<article><p class=\"eyebrow\">Community photos</p><h1>#{title}</h1><p class=\"lede\">#{summary}</p>" <>
                Enum.map_join(sections, "", &section/1) <> "</article>"
          )
        )
    end
  end

  # The four policy pages link to each other. The current page is bold text, not a link.
  defp links(current) do
    Enum.map_join(@order, "", fn page ->
      {title, _, _} = @pages[page]

      if page == current,
        do: ~s(<strong aria-current="page">#{title}</strong>),
        else: ~s(<a href="/community/#{page}">#{title}</a>)
    end)
  end

  defp section({heading, :text, text}),
    do: ~s(<section class="section"><h2>#{heading}</h2><p>#{text}</p></section>)

  defp section({heading, :list, items}),
    do: ~s(<section class="section"><h2>#{heading}</h2><ul>#{items(items)}</ul></section>)

  defp section({heading, :steps, items}),
    do:
      ~s(<section class="section"><h2>#{heading}</h2><ol class="steps">#{items(items)}</ol></section>)

  defp items(items), do: Enum.map_join(items, "", &"<li>#{&1}</li>")
end
