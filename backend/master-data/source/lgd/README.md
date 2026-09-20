# LGD source snapshot (committed, checksummed)

Authoritative Government of India **Local Government Directory (LGD)** export used as the
single source for the canonical `MasterData` geography (`state` → `district` → `city`).
Nothing in this directory is hand-written; do not hand-edit these files or the MongoDB
records that are imported from them, and never replace them with a hardcoded frontend list.

| File | LGD report | Used as | Rows |
|---|---|---|---|
| `states.csv` | States | `kind: "state"` | 36 states/UTs |
| `districts.csv` | Districts | `kind: "district"` (parent = state via `State Code`) | 784 |
| `statewise_ulbs_coverage.csv` | Statewise urban local bodies coverage | `kind: "city"` (parent = district via `State Name` + `District Code`) | 35,008 village/ward coverage rows → ~5.1k distinct (district, local body) pairs |

Provenance, licence, snapshot date and SHA-256 of every file are recorded in
[`MANIFEST.json`](./MANIFEST.json). The importer **verifies those checksums before it
touches the database** and refuses to run when a file is missing, unreadable, or altered.

* Snapshot date: **2026-09-19** (LGD Download Directory export)
* Licence: Government Open Data License – India (GODL-India) – attribution is in `MANIFEST.json`
* Delimiter: comma (the importer auto-detects `,` or `;` from the header row)

## Field mapping

| Target (`MasterData`) | State | District | City |
|---|---|---|---|
| `name` | `State Name (In English)` | `District Name(In English)` | `Local Body Name (In English)` |
| `parentId` | `null` | `_id` of state with the same `State Code` | `_id` of the district with the same `(State Code, District Code)` |
| `source` | `lgd` | `lgd` | `lgd` |

Transformations performed by the importer (`backend/master-data/lgdSource.js`): whitespace is
collapsed; names are otherwise kept verbatim (LGD's own spelling/casing); duplicate
`(district, name)` pairs (a local body listed once per village) collapse into one city;
records are upserted on `(kind, parentId, normalizedName)` so re-runs never duplicate and
existing MongoDB `_id`s are preserved.

## Limitations

* The City layer is LGD's **urban local bodies** (municipal corporations, municipalities,
  town panchayats, cantonments …). Rural villages are intentionally *not* cities. Doctors in
  a place that is not an urban local body type the city name and it is stored as `OTHER`.
* 13 urban local bodies in the LGD ULB list have no district mapping in the coverage report
  and therefore cannot be placed under a district (they are not imported).
* An urban local body that spans several districts is listed under each of them.
* LGD is a living directory (districts are renamed / created); refresh the snapshot as below.

## Import

```bash
cd backend
npm run migrate:master-data:lgd        # uses ./master-data/source/lgd by default
# or: LGD_MASTER_DATA_DIR=/path/to/dir npm run migrate:master-data:lgd
```

The command exits non-zero (never a silent empty database) when the source is missing, a
checksum fails, a row references an unknown state/district, or the resulting counts do not
reach the source counts.

## Refreshing the snapshot

1. Download `states`, `districts`, `statewise_ulbs_coverage` for the desired date from the LGD
   Download Directory (https://lgdirectory.gov.in/downloadDirectory.do) or the mirror listed in
   `MANIFEST.json`, e.g.
   `https://github.com/ramSeraph/opendata/releases/download/lgd-latest-extra1/districts.<DDMonYYYY>.csv.7z`.
2. Extract to `states.csv`, `districts.csv`, `statewise_ulbs_coverage.csv` here.
3. Run `node scripts/updateLgdManifest.mjs` (from `backend/`) to recompute row counts/SHA-256
   (edit `snapshotDate`/`downloadedAt` in the manifest), then re-run the import.
