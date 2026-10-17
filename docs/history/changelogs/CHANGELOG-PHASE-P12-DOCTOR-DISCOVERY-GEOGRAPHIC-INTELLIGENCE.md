# MediCore HMS — Phase P12
## Doctor Discovery + Geographic Intelligence

### Scope
P12 adds real geographic discovery to the finalized P11 public experience. P13 is not implemented.

### Geographic model
`Doctor.district` and `Doctor.location` are optional. `Doctor.location` is GeoJSON Point `[longitude, latitude]` with a 2dsphere index. Clinic records support the same optional district/location fields.

No district is inferred from city names and no coordinates are generated. Existing records remain unchanged until authoritative geographic data is supplied.

### Public APIs
- `GET /api/public/doctor-coverage` — aggregate public doctor coverage by state, district and city.
- `GET /api/public/next-availability?doctorId=...` — public next availability for an eligible doctor, reusing the existing appointment availability controller and slot/capacity engine.
- `GET /api/public/doctors` now accepts the additive `district` filter.
- `GET /api/public/search-meta` now exposes real district values present on eligible doctors.

All public doctor responses continue to use the safe public serializer and exclude private contact/moderation data.

### Geographic visualization source
The state-boundary visualization loads a published India states GeoJSON conversion used for web mapping at https://gist.githubusercontent.com/jbrobst/56c13bbbf9d97d187fea01ca62ea5112/raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/india_states.geojson. The published mapping reference identifies it as a conversion based on DataMeet state boundaries. DataMeet states data is documented under Creative Commons Attribution 2.5 India; retain attribution when redistributing or replacing the dataset. DataMeet also documents known boundary limitations, so the geometry is used only for visualization and never as a source for doctor geography.

The map also uses OpenStreetMap tiles with standard attribution. The map is a discovery aid; the accessible state selector remains available without map interaction.

### Architectural decisions
- Coverage is computed from the same public eligibility rule used by doctor discovery: verified + approved + active.
- Coverage aggregation is filter-aware so map state counts follow the current discovery filters.
- Geographic fields are additive and optional; there is no silent migration or city-to-district inference.
- Next availability is bounded by the existing appointment controller horizon and relies on existing schedule/capacity logic rather than a second slot algorithm.
- P11's light public visual identity is preserved.
- No contact persistence, public analytics, or other P13 work is included.

### Data migration requirements
No automatic migration is required. Authoritative district/coordinate values can be populated through a future controlled admin/doctor data-maintenance workflow. Existing records without those values remain explicitly partial.

## P12 Critical Booking Entry — Role-Aware Patient Authentication

- Public `Book Appointment` CTAs from doctor discovery/profile now enter one shared patient-only authentication flow.
- Patient sessions continue directly to the existing `/patient/appointments/book` route without re-authentication.
- Unauthenticated users are routed through the existing Login/Register pages with a validated internal booking return target.
- Doctor, admin, super-admin, and receptionist sessions are explicitly cleared before patient authentication; no role conversion or impersonation is performed.
- Booking return targets are restricted to the existing patient booking route and only preserve the known doctor/mode/date/time context fields.
- Booking registration forces the patient role when the return target is a booking intent.
- The existing backend `POST /api/appointments` authorization remains patient-only and continues binding the appointment to `req.user._id`.
- Realtime cleanup remains owned by the existing `AuthContext` + `RealtimeContext` lifecycle; no parallel socket/auth state was introduced.
- Existing patient booking draft persistence remains available, and authenticated booking context can restore consultation mode/date/time when the selected slot is still available.
- Added `backend/tests/p12BookingAuthFlow.test.mjs` for the booking/auth boundary contract.
