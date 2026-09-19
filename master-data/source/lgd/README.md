# LGD source snapshot

This directory is intentionally data-free in source control. Populate it with an official Local Government Directory (LGD) export before running the importer.

Required files:

- `states.csv` — LGD States export
- `districts.csv` — LGD Districts export
- `statewise_ulbs_coverage.csv` — LGD urban-local-body coverage export, used as the application's City/Town layer because it maps urban local bodies to districts and states.

Source: Government of India, Ministry of Panchayati Raj, Local Government Directory (LGD).

Reference: https://lgdirectory.gov.in/

The Open Government Data (OGD) Platform publishes the LGD state and district resources and records monthly updates. The importer preserves existing MongoDB `_id` values when a `(kind,parentId,normalizedName)` record already exists and is safe to rerun.

Example:

```bash
LGD_MASTER_DATA_DIR=./master-data/source/lgd npm run migrate:master-data:lgd
```

Do not hand-edit MongoDB records and do not replace this source with a hardcoded frontend list.
