# Legal position and data limitations

## TrailLoop is not a legal record

OpenStreetMap is a crowd-sourced map, not a legal register. In England and Wales the **Definitive Map and Statement**
held by the local highway authority is the legal record of public rights of way. On-site signage and traffic
regulation orders take precedence over anything shown here.

TrailLoop therefore deliberately uses the language:

- “mapped access information”, not “rights of way you have”;
- “OSM access classification”;
- “access confidence”;
- “verify locally where access is uncertain”.

Every route summary, feature inspector and warning is framed this way, and the app never says a route _is_ legal.

## What the classification does and does not do

- It applies England-and-Wales rules only inside England and Wales.
- It never converts missing data into permission.
- It separates permissive access (revocable, granted by a landowner) from statutory rights.
- It reports uncertainty explicitly, including how much of a route it could not match to mapped data.
- It does not model: temporary closures, diversions, seasonal restrictions, Cycling UK/Open Access land nuances,
  Scotland’s statutory access rights, or byelaws on land held by particular authorities.

## Licensing

Map data © OpenStreetMap contributors, licensed under the **Open Database Licence (ODbL) 1.0**.

- **Produced works** (maps, route summaries, GPX files) must credit “© OpenStreetMap contributors”. TrailLoop shows
  this on the map, in the footer, on `/about/data` and inside exported GPX descriptions.
- **Derived databases** — if you publish a database derived from OSM (for example the `osm_rights_of_way` table after
  enrichment), the share-alike obligation applies.
- Cached upstream responses are a convenience for the running service and should not be redistributed as a dataset.

## Provider terms

- **Overpass API** — a volunteer-run shared resource. Identify yourself with a real contact address, keep queries
  bounded, cache aggressively, and move to your own PostGIS import for production.
- **Nominatim** — no per-keystroke autocomplete against the public instance, maximum 1 request/second, identifying
  User-Agent required, results must be cached.
- **openrouteservice** — free tier quotas apply; the API key must remain server-side.
- **Tile services** — do not use the public OpenStreetMap raster tiles as production infrastructure; choose a provider
  whose terms cover your usage.

## Third-party notices

Runtime dependencies include MapLibre GL JS (BSD-3-Clause), Turf.js (MIT), Zod, Zustand, TanStack Query, Radix UI and
Lucide (all MIT), and Next.js/React (MIT). Full details are in `pnpm-lock.yaml`; run `pnpm licenses list` to produce a
notices file for distribution.

## Safety

Route generation optimises against mapped attributes, not against real-world conditions. Fords, unbridged crossings,
gates, stiles, livestock, erosion and weather are not modelled. Riders and walkers remain responsible for assessing
what is in front of them.
