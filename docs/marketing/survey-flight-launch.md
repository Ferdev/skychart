# Survey flight drafts

Production host: __________. No post or message has been sent.

## r/astronomy

[production host]/tours/sun-to-survey-field

This flight has three stops: the Sun, Andromeda and 3C 273. The distance chips open the catalog records. Andromeda uses the Messier snapshot's estimate of about 3 million light-years. The 3C 273 record uses a SIMBAD redshift-derived comoving distance of about 2.188 billion light-years.

At the last stop, the image comes from Legacy Imaging Surveys DR11. It is an angular field seen from Earth; it does not measure the distance. If that field cannot load, an AllWISE fallback is labeled AllWISE.

[Owner: state the checked public tile condition here.] DESI DR1 spectra points and Legacy Imaging Surveys DR11 images are different data products. The player reports whether DESI points have loaded in the current view. The route still works with the curated landmark set when they have not.

## Note to one writer

[production host]/tours/sun-to-survey-field

I made a short route through the atlas from the Sun to Andromeda and then 3C 273. Each distance opens its source record, and the final stop shows a DR11 cutout with its credit. The page names the catalog snapshots and the distance definition.

[Owner: state the checked public tile condition here.] The point layer uses DESI DR1 spectra when loaded; the cutout uses Legacy Imaging Surveys DR11. The player labels missing tiles and the image fallback.

The route may be useful beside a discussion of the survey releases. It does not claim to show an unimported structure or the full survey.

Owner: select the recipient. Check that the link, source chips and final image work on the public server. Record whether the DESI sentence needed correction. Check posting rules before using the forum draft. No news date or writer identity is assumed.

## Evidence checked

The public Sun, `m31` and `simbad-3c-273` object endpoints returned records on 15 November 2026. The [3C 273 DR11 field](https://skychart.org/api/survey-image?provider=legacy-dr11&ra=187.27791594049&dec=2.05238823055&fov=0.1) returned a nonblank 512 × 320 JPEG. The public manifest listed DESI DR1, and its container answered a bounded byte-range check with an SMPK1 header.

The fixed flight uses Messier snapshot `2026-05-06T22:50:00.840414Z` and SIMBAD snapshot `2026-05-10T11:01:55.035071Z`. The SIMBAD model uses H0=67.8 km/s/Mpc, Ωm=0.308 and ΩΛ=0.692. The comoving distance is not a lookback time. Recheck these facts before publication if the catalog snapshots change.
