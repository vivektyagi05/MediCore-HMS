# Phase P12 — Final Closure Changes

## Geographic consistency
Public doctor search and public coverage now share centralized location semantics. State, district and city criteria are matched against either the primary doctor location or one clinic location as a complete object, preventing cross-location false matches.

## Availability
Doctor discovery uses a bounded batch endpoint (`/api/public/doctor-availability`) for the current result page. The browser does not issue one availability HTTP request per doctor. The batch implementation reuses `findNextAvailableSlotForDoctor` and the existing `buildDayCapacity` engine.

## Discovery UX
Search results are primary. The geographic map is secondary and collapsible on mobile. State/district/city controls remain the accessible primary geographic interaction.

## Booking boundary
Appointment creation remains protected by the existing `PATIENT` route authorization. Public booking continues through the existing patient route, with controlled booking intent parameters only. Non-patient sessions are cleared before patient authentication and booking registration is forced to the patient role.

## Verification limitation
The sandbox could not complete dependency installation. Consequently the frontend lint/build and dependency-backed full backend suite remain blocked and P12 is intentionally reported as **P12 NOT COMPLETE** until those commands pass in a dependency-complete environment.


## Final repair pass
- Fixed the public coverage aggregation runtime self-reference: filtered location stages are now appended to the original location stages.
- Coverage location aggregation now accepts authoritative state/district records even when city is absent; city coverage remains available only where a real city exists.
- Fixed same-day next-availability handling so slot start times already passed in the application's UTC business-date convention are excluded.
- The existing `/available-slots` endpoint now applies the same current-time filtering for today's slots, preventing the booking UI from offering already-passed times.
- Future dates, booked appointments, approved leave, blocked dates, and existing slot-generation rules remain handled by the existing capacity/slot engine.
- Added deterministic capacity tests for past/future same-day slots and booked future slots.
- Added stale-response protection for public coverage requests in DoctorSearch.
- Map retry now retries the geographic dataset request directly instead of reloading the whole page.
