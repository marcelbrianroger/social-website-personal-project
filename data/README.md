# GeoIP database

The region lock falls back to a local MaxMind lookup when no trusted geo header
is available (see `lib/geo/region-lock.ts`).

`GeoLite2-Country.mmdb` is **not committed** — MaxMind's licence requires each
user to download it under their own account, and it is gitignored via
`/data/*.mmdb`.

## Setup

1. Create a free account at <https://www.maxmind.com/en/geolite2/signup>.
2. Download the **GeoLite2 Country** database in *MaxMind DB binary* (`.mmdb`)
   format.
3. Extract `GeoLite2-Country.mmdb` into this directory.
4. Confirm `MAXMIND_DB_PATH` in `.env` points at it (the default already does).

## Without it

Everything still runs. `lookupCountry()` returns `null`, and the request falls
through to the `GEO_FALLBACK` policy — `allow` by default, so local development
is not blocked. Set `GEO_FALLBACK="deny"` only once the database is in place,
or you will lock out every visitor.
