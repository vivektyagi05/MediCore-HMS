# Doctor Workflow Test Scenarios

## Scheduling
- Reject duplicate slots within the same weekday, for example `monday: 09:00` entered twice.
- Reject malformed schedule payloads with empty `timeSlots`.
- Preserve existing approved/pending appointments when schedule availability changes.
- Verify blocked dates are returned by `GET /api/doctor/schedule`.

## Prescriptions
- Reject prescription creation without `diagnosis`.
- Reject prescription creation without at least one medicine.
- Reject prescription creation when `appointmentId` does not belong to the authenticated doctor.
- Verify prescription PDF download works only for the owning doctor.

## Medical Notes
- Reject notes without clinical note text.
- Verify symptoms are searchable through `GET /api/doctor/notes?search=...`.
- Verify notes are linked into consultation history.

## Unauthorized Access
- Patient token cannot access `/api/doctor/prescriptions`.
- Doctor A cannot create notes or prescriptions for Doctor B appointments.
- Unauthenticated requests return `401`.

## Leave Management
- Reject leave requests where `endDate` is before `startDate`.
- Reject overlapping pending or approved leave ranges.
- Admin can approve/reject leave; doctor cannot approve their own leave.

## Uploads
- Accept only PDF, PNG, and JPEG doctor documents.
- Reject files larger than 5 MB.
- Store uploaded document metadata on the doctor profile with `pending` verification status.

## Exports
- Doctor can export prescriptions as CSV and PDF.
- Doctor can export schedules as CSV.
- Patient and admin tokens cannot use doctor export routes unless explicitly authorized.
