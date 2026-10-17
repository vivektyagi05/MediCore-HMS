# Patient Workflow Test Scenarios

## Medical Reports
- Patient A cannot download Patient B report by guessing report id.
- Upload rejects unsupported file types such as `.exe` or `.docx`.
- Upload rejects files larger than the configured 8 MB limit.
- Search returns matching report title, category, notes, or tags.

## Prescriptions
- Patient can list only prescriptions where `patientId` matches their account.
- Patient cannot download a prescription owned by another patient.
- Prescription timeline shows medicine, dosage, frequency, and follow-up date.

## Family Accounts
- Patient can add dependent with relation, age, gender, blood group, and conditions.
- Appointment booking rejects `familyMemberId` not owned by the authenticated patient.
- Inactive or deleted dependents cannot be used for booking.

## Reviews
- Patient can review only completed appointments.
- Duplicate review for the same appointment updates the existing review instead of creating spam.
- Doctor average rating recalculates after review create/update.

## Insurance
- Insurance creation requires provider, policy number, holder, and validity.
- Insurance uploads accept PDF, JPG, and PNG only.
- Claim status appears in the patient insurance dashboard.

## Health Timeline
- Timeline combines appointments, prescriptions, reports, and payments in reverse chronological order.
- Filters/search should not expose other users' records.

## Exports
- Patient can export appointments, prescriptions, and reports.
- Unauthorized users receive `401`; non-patient roles receive `403`.
- Invalid resource names are rejected with `400`.
