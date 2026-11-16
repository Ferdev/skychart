# Spacecraft page drafts

Production host: __________. Replace every bracketed field after a live comparison. These drafts have not been posted.

| Page | Search title | Description |
| --- | --- | --- |
| `/spacecraft/voyager-1` | Voyager 1: distance, light time and speed | Check Voyager 1's epoch, Earth and Sun distances, one-way light time and relative speeds. |
| `/spacecraft/voyager-2` | Voyager 2: distance, light time and speed | Check Voyager 2's geometric position and light time at a stated UTC epoch. |
| `/spacecraft/jwst` | JWST: distance, light time and speed | Read JWST's Earth and Sun distances with Horizons sources and explicit coverage gaps. |
| `/spacecraft/juno` | Juno: distance, light time and speed | See Juno's geometric distances and relative speeds at the loaded epoch. |
| `/spacecraft/new-horizons` | New Horizons: distance, light time and speed | Check New Horizons' epoch, geometric distance and one-way light-time estimate. |

Voyager query variants: Where is Voyager 1 now? How far is Voyager 1 from Earth? How long does light take to reach Voyager 1? How fast is Voyager 1 relative to the Sun? Use the same terms for Voyager 2. Do not describe an old fixed value as current.

## Milestone note

At [UTC epoch], Voyager 1 was [Earth distance in km] from Earth in the atlas's Horizons calculation. That gives an estimated one-way light time of [seconds or hours], using distance divided by the speed of light.

The page is [production host]/spacecraft/voyager-1. It shows the epoch and both reference frames for speed. You can open the same spacecraft at that epoch in the atlas. I checked this row against [Horizons result reference].

## r/space draft

At [UTC epoch], [craft] was [distance] km from Earth, giving [light time] of estimated one-way light travel. The checkable row is at [production host]/spacecraft/[slug].

I added a fleet page at [production host]/spacecraft. It includes the admitted Horizons spacecraft and the records the atlas does not place, with the reasons from its inventory. Some rows have no position at the selected epoch. They stay visible with a coverage or availability message.

Each available row opens the craft in the atlas at the same epoch. Light time is distance divided by c. This is a geometric calculation, not a statement that a mission is operating or in contact.

## NASASpaceflight draft

At [UTC epoch], [craft] was [distance] km from Earth; distance divided by c gives [light time]. I compared that row with Horizons using [center, frame, units and correction settings]. The row is at [production host]/spacecraft/[slug].

The fleet list, [production host]/spacecraft, also shows the excluded records and their recorded reasons. The five-minute epoch is printed on each available result. A gap in coverage has no position or speed. Provider notes are linked beside the record.

A daily-sample ticker can differ because it interpolates between samples. This page uses the requested epoch rounded down to five minutes.

## Owner checks

Before posting, choose a row with coverage and compare the identical epoch, centers, frame, units and geometric correction settings in [Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html). Set tolerances from the fixture precision and settings before comparing. Record the expected value, actual value, tolerance and discrepancy. Investigate a failure. Do not widen tolerance to pass.

Check each forum's current rules and select a suitable thread. The owner posts and replies. Record the final URLs and dates in the measurement log.
