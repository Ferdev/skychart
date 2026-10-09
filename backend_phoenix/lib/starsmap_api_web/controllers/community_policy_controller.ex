defmodule StarsmapApiWeb.CommunityPolicyController do
  use StarsmapApiWeb, :controller

  @pages %{
    "rules" =>
      {"Community rules",
       "Publish your own astronomical photos or images you have permission to use. Credit the photographer and select a licence. Declare composites and substantial processing. Synthetic AI images are not accepted. Do not submit private information about another person. Report incorrect attribution or abusive content from the photo viewer."},
    "terms" =>
      {"Photo publishing terms",
       "You keep your copyright. By publishing, you permit Cosmic Atlas to process, display, and share credited versions of your photo as part of this atlas. The licence you select states the reuse permission for other users. Your first three photos require moderator review. You can remove your photos from your account. Removal stops public display; it cannot remove copies already downloaded by others."},
    "privacy" =>
      {"Community privacy",
       "Your email is used to send sign-in codes. Your public handle, display name, and published photo metadata are visible to visitors. Precise location metadata is removed from published image files. Source uploads are private and are removed seven days after successful processing. Session cookies identify your account. Export or remove your account from the account menu. Moderation records and backup copies follow the operator's published retention policy."},
    "takedown" =>
      {"Reports and removal",
       "Use Report on a photo to identify copyright, attribution, or content concerns. Include the photo URL, the issue, and how the moderator can verify it. A moderator can hide a photo and record the reason. You can use the same report form to request a review of a moderation decision. An author can remove their own photos from their account."}
  }
  def show(conn, %{"page" => page}) do
    case @pages[page] do
      nil ->
        send_resp(conn, 404, "Page not found")

      {title, text} ->
        html(
          conn,
          StarsmapApiWeb.ServerShell.render!(
            title: title <> " — Cosmic Atlas",
            body:
              "<article class=\"object-page\"><a href=\"/\">Cosmic Atlas</a><h1>#{title}</h1><p>#{text}</p></article>"
          )
        )
    end
  end
end
