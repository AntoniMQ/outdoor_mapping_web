# Fixtures

TrailLoop's fixture data is **generated**, not stored.

`src/server/providers/fixtures/network.ts` defines a deterministic synthetic path network as a pure function of
integer grid indices: geometry, OSM-style tags, way identifiers and terrain elevation all derive from those indices.
Every fixture provider — routing, rights of way, geocoding, elevation — reads from that one world, so the demo data is
internally consistent and byte-for-byte reproducible without any files on disk.

Consequences worth knowing:

- The same request always returns the same route, which is what makes the test suite reliable.
- All fixture path names are explicitly fictional ("Demo Coppice Track", "Sample Ridge Path", …). No real path is ever
  given fabricated legal metadata.
- Fixture output is always flagged with `isSyntheticData: true` and a visible demo banner.

Put static fixture files here only if you add a provider whose responses cannot be generated (for example a recorded
upstream payload used by an integration test).
