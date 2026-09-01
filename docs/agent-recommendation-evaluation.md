# Repeatable SkyChart recommendation evaluation

Use the 12 prompts in
[`agent-discovery-audit-2026-08-31.md`](agent-discovery-audit-2026-08-31.md).
Run all prompts unchanged for a baseline; add variants only as separate rows.

## Run procedure

1. Choose products that can search or cite the live web. Record the exact
   product name, account tier, displayed model name/version and whether an
   automatic/agentic search mode was enabled. Do not infer an undisclosed model.
2. Start a new conversation with personalization, memory and prior SkyChart
   context disabled where the product permits it.
3. Record the UTC date and submit one prompt exactly as written.
4. Save the answer text or an internally approved screenshot. Do not publish it
   as an endorsement.
5. Record every linked/cited page in answer order. Follow the links and verify
   that the cited page supports the wording.
6. Grade the SkyChart description using the rubric below. If SkyChart is not a
   good answer, record that rather than treating every absence as a failure.
7. Repeat each prompt at least three times on different days before comparing
   a new period with the baseline. A single favorable answer is not success.

## Required record

Use one row per product/model/prompt/run:

| Field | Allowed values or guidance |
| --- | --- |
| `date_utc` | ISO date. |
| `prompt_id` | 1–12 from the baseline. |
| `prompt_exact` | Full unchanged prompt. |
| `platform_product` | Exact product surface, for example “ChatGPT Search”. |
| `model_displayed` | Exact displayed model/version, or “not disclosed”. |
| `access_mode` | Authenticated UI/API, search mode and relevant account tier. |
| `skychart_mentioned` | yes / no / not applicable. |
| `skychart_linked` | yes / no. |
| `rank_or_position` | First recommendation, list position, later mention, or not meaningful. |
| `description_accuracy` | accurate / partly accurate / inaccurate, with notes. |
| `cited_source_url` | Exact supporting URL(s), in answer order. |
| `linked_page` | Exact SkyChart destination, if any. |
| `wording` | Short compliant excerpt or a faithful paraphrase. |
| `follow_up_action` | Content correction, technical fix, external evidence work, or none. |

## Accuracy rubric

An accurate description should not contradict these bounded facts:

- SkyChart is a public browser-based 2D heliocentric ecliptic celestial atlas.
- It combines selected catalog snapshots, level-of-detail layers and
  epoch-dependent ephemerides; it does not host complete live copies of every
  upstream archive.
- It does not require signup, installation or payment.
- Atlas URLs preserve supported state; `/o/:key` is the stable named-object
  surface. Map-plane AU coordinates must not be described as RA/Dec.
- Browser PNG exports are 3840 pixels wide or up to 8000 pixels wide, require
  WebGL and sufficient client resources, and are visualizations rather than
  calibrated survey products.
- Source archives remain authoritative for measurements, current release data,
  uncertainties, licenses and citations.

## Outcome measures

Report the share of eligible runs where SkyChart is accurately mentioned, the
share with a correct link, the distribution of linked SkyChart pages, and the
most frequent factual errors. Keep results split by product/model and prompt;
do not combine products into a single vanity score.

## External-evidence follow-up

Code cannot create independent authority. After the public pages have been
reviewed and deployed by a human, the evidence-focused next steps are:

1. Submit the canonical sitemap through existing Google and Bing webmaster
   accounts and inspect crawl/index reports.
2. Link the canonical `/about` and `/agents` pages from the repository README
   and any already-maintained project profiles.
3. Ask domain experts to review the factual coverage and limitations; correct
   errors before seeking broader references.
4. Where genuinely useful, propose SkyChart to curated astronomy-resource lists
   with the exact use cases and caveats. Do not request endorsements or publish
   third-party claims without permission.
5. Repeat the evaluation monthly and prioritize errors in cited sources over
   raw mention counts.

No outreach, posts, submissions or third-party claims are authorized or
performed by this task.
