# MediCore HMS — Admin Workflow Audit

**Date:** 2026-11-02  
**Scope:** Static review of patient, appointment, payment, invoice, refund and doctor list-page navigation/filter flows in the supplied snapshot.

## Confirmed and repaired

### URL state and controlled filter state

The five pages below initialized their filter form from URL parameters but did not synchronize the form when URL parameters later changed. This could occur during browser back/forward navigation or when another admin workspace navigated to the list with a different query.

| Page | API query source | Filter state synchronization |
|---|---|---|
| Patients | `searchParams` | FIXED |
| Appointments | `searchParams` | FIXED |
| Payments | `searchParams` | FIXED |
| Invoices | `searchParams` | FIXED |
| Refunds | `searchParams` | FIXED |
| Doctors | `searchParams` | Already present |

A shared `readAdminFilterState()` helper now resets missing keys to empty strings and reads only the filter fields owned by the current page. Context keys such as `patientId` remain available to the API query without being misrepresented as a search field.

### Contextual ID validation

Appointment, payment and refund controllers previously ignored malformed non-empty ObjectId context filters. They now reject malformed values with HTTP 400 rather than falling back to a broad list query.

## Existing navigation behaviour observed

- Patient list rows navigate to appointments using the real row `_id` as `patientId`.
- Patient workspace exposes a View Appointments action using the loaded patient `_id`.
- Appointment list controller applies `patientId` and `doctorId` filters server-side.
- Payment and invoice workspaces navigate to patient list search using the patient ObjectId. The patient controller supports exact `_id` matching in its search filter.
- Payment, invoice and refund workspaces link to appointment/payment context using IDs available on their loaded records.

## Remaining admin workflow gaps

1. **Interactive pagination:** The reviewed list pages pass fixed limits (patients 20; appointments/payments/invoices 100; refunds 50) and show a count message when more records exist. No next/previous page controls were found in these implementations, despite backend pagination metadata. This prevents admins from navigating beyond the first page without narrowing the search.
2. **Context visibility:** Contextual URL filters such as `patientId`, `doctorId` and `paymentId` are not consistently displayed as a clearable filter chip/banner. The query can be applied server-side without being represented in the visible form.
3. **End-to-end coverage:** Real browser workflows across all patient/doctor/appointment/payment/invoice/refund relationships were not executed.
4. **Response race coverage:** Some pages use a latest-request guard; the reviewed pages do not all share that protection. A systematic request-race audit remains outstanding.
5. **Entity-type correctness:** Each navigation callback must continue to be checked against the actual schema relationship (user ID versus doctor profile ID versus payment document ID versus gateway ID). This pass checked only a subset of these transitions.

## Recommended acceptance tests

- Navigate from patient workspace to appointments; verify exact `patientId` query, API filter and visible context.
- Use browser Back and Forward; verify form values and API results remain aligned.
- Refresh the filtered page; verify context persists.
- Replace a valid ID with malformed text; verify HTTP 400 and no unfiltered fallback.
- Clear context; verify the normal list returns.
- Navigate from payment to invoice/refund and back; verify internal document IDs are used where required.
- Page through more than one page while retaining all active filters and sort order.
