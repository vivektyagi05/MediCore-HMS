# Database Design (MongoDB / Mongoose)

> **Status: derived from `backend/models/` (56 model files).** Relationships are the `ref:` fields found by static parsing; indexes are counted from `.index(` calls and `unique: true` flags. Nothing was executed against a database. Field-level semantics live in the model files, which are the source of truth.

Related: [Architecture](../ARCHITECTURE.md) · [Payments & financial architecture](payments-financial-architecture.md) · [Load-testing guide](../testing/load-testing.md)

## Models and references

| Model file | Mongoose model | References (field → model) | `.index()` calls | `unique: true` |
|---|---|---|---|---|
| `AIDraft.js` | AIDraft | `approvedBy`→User; `createdBy`→User; `targetUserId`→User | 1 | 0 |
| `AIInsight.js` | AIInsight | `targetUserId`→User | 2 | 0 |
| `AdminActivityLog.js` | AdminActivityLog | `actorId`→User | 2 | 0 |
| `Appointment.js` | Appointment | `actorId`→User; `doctorId`→Doctor; `familyMemberId`→FamilyMember; `insuranceId`→Insurance; `invoiceId`→Invoice; `patientId`→User; `paymentId`→Payment; `reportIds`→MedicalReport; `resolvedBy`→User | 5 | 3 |
| `AutomationFlow.js` | AutomationFlow | `archivedBy`→User; `createdBy`→User; `publishedBy`→User; `updatedBy`→User | 2 | 0 |
| `AutomationRunLog.js` | AutomationRunLog | `actorId`→User; `flowId`→AutomationFlow; `processDefinitionId`→ProcessDefinition | 3 | 0 |
| `CMSPage.js` | CMSPage | `archivedBy`→User; `author`→User; `createdBy`→User; `publishedBy`→User; `relatedDoctors`→Doctor; `relatedServices`→Service; `updatedBy`→User | 1 | 1 |
| `Certificate.js` | Certificate | `appointmentId`→Appointment; `doctorId`→Doctor; `patientId`→User | 2 | 0 |
| `ChatMessage.js` | ChatMessage | `appointmentId`→Appointment; `recipientId`→User; `senderId`→User | 4 | 1 |
| `ConsentRecord.js` | ConsentRecord | `user`→User | 1 | 0 |
| `ConsultationHistory.js` | ConsultationHistory | `appointmentId`→Appointment; `doctorId`→Doctor; `noteIds`→MedicalNote; `patientId`→User; `paymentId`→Payment; `prescriptionIds`→Prescription; `refundIds`→RefundRequest | 2 | 1 |
| `Coupon.js` | Coupon | `appointmentId`→Appointment; `userId`→User | 0 | 1 |
| `CronRunLog.js` | CronRunLog | — | 3 | 1 |
| `Doctor.js` | Doctor | `changedBy`→User; `cityMasterId`→MasterData; `districtMasterId`→MasterData; `specializationMasterId`→MasterData; `stateMasterId`→MasterData; `userId`→User; `verifiedBy`→User | 4 | 1 |
| `DoctorPayout.js` | DoctorPayout | `actorId`→User; `appointmentId`→Appointment; `doctorId`→Doctor; `paymentId`→Payment; `settledBy`→User | 2 | 1 |
| `EmailDelivery.js` | EmailDelivery | `recipientId`→User | 2 | 1 |
| `FamilyMember.js` | FamilyMember | `userId`→User | 1 | 0 |
| `FeatureToggle.js` | FeatureToggle | `updatedBy`→User | 0 | 1 |
| `HospitalSetting.js` | HospitalSetting | `updatedBy`→User | 0 | 1 |
| `Insurance.js` | Insurance | `familyMemberId`→FamilyMember; `userId`→User | 0 | 0 |
| `IntelligenceActionLog.js` | IntelligenceActionLog | `approvedBy`→User | 1 | 0 |
| `Invoice.js` | Invoice | `appointmentId`→Appointment; `doctorId`→Doctor; `paymentId`→Payment; `subscriptionId`→Subscription; `userId`→User | 1 | 2 |
| `Lead.js` | Lead | `actorId`→User; `assignedBy`→User; `assignedTo`→User; `author`→User; `user`→User | 4 | 1 |
| `LeaveRequest.js` | LeaveRequest | `doctorId`→Doctor; `reviewedBy`→User; `userId`→User | 1 | 0 |
| `MasterData.js` | MasterData | `parentId`→MasterData | 1 | 1 |
| `MedicalNote.js` | MedicalNote | `appointmentId`→Appointment; `doctorId`→Doctor; `patientId`→User | 1 | 0 |
| `MedicalReport.js` | MedicalReport | `appointmentId`→Appointment; `doctorId`→Doctor; `familyMemberId`→FamilyMember; `reviewedBy`→User; `userId`→User | 1 | 0 |
| `NotificationDelivery.js` | NotificationDelivery | `actorId`→User; `recipientId`→User | 2 | 2 |
| `OnlineSession.js` | OnlineSession | `userId`→User | 2 | 1 |
| `OperationAssignment.js` | OperationAssignment | `actorId`→User; `assignedTo`→User; `escalatedTo`→User; `resolvedBy`→User; `targetUserId`→User | 0 | 1 |
| `PasswordReset.js` | PasswordReset | `user`→User | 2 | 0 |
| `Payment.js` | Payment | `actorId`→User; `appointmentId`→Appointment; `couponId`→Coupon; `doctorId`→Doctor; `invoiceId`→Invoice; `retryResolvedBy`→User; `userId`→User | 3 | 2 |
| `PaymentAttempt.js` | PaymentAttempt | `paymentId`→Payment | 2 | 2 |
| `Permission.js` | Permission | `updatedBy`→User | 0 | 1 |
| `Prescription.js` | Prescription | `appointmentId`→Appointment; `doctorId`→Doctor; `followUpScheduledAppointmentId`→Appointment; `patientId`→User | 3 | 1 |
| `PrivacyPreference.js` | PrivacyPreference | `user`→User | 0 | 1 |
| `PrivacyRequest.js` | PrivacyRequest | `resolvedBy`→User; `user`→User | 2 | 0 |
| `ProcessDefinition.js` | ProcessDefinition | `activatedBy`→User; `actorId`→User; `archivedBy`→User; `createdBy`→User; `decidedBy`→User; `ownerUserId`→User; `pausedBy`→User; `publishedBy`→User; `reviewedBy`→User; `submittedBy`→User; `updatedBy`→User | 3 | 1 |
| `ProcessOptimizationRecommendation.js` | ProcessOptimizationRecommendation | `decidedBy`→User; `proposedDefinitionId`→ProcessDefinition; `reviewedBy`→User; `simulationRunId`→AutomationRunLog | 2 | 0 |
| `ReconciliationRecord.js` | ReconciliationRecord | `resolvedBy`→User | 1 | 1 |
| `RefundRequest.js` | RefundRequest | `actorId`→User; `paymentId`→Payment; `processedBy`→User; `requestedBy`→User | 2 | 1 |
| `RefundReview.js` | RefundReview | `doctorId`→Doctor; `doctorUserId`→User; `paymentId`→Payment; `payoutId`→DoctorPayout; `resolvedBy`→User | 2 | 1 |
| `ReminderLog.js` | ReminderLog | `userId`→User | 2 | 2 |
| `Review.js` | Review | `adminDeletedBy`→User; `appointmentId`→Appointment; `doctorId`→Doctor; `userId`→User | 2 | 1 |
| `SavedDoctor.js` | SavedDoctor | `doctorId`→Doctor; `userId`→User | 1 | 1 |
| `Service.js` | Service | `createdBy`→User; `relatedDoctors`→Doctor; `relatedServices`→Service; `updatedBy`→User | 4 | 2 |
| `Subscription.js` | Subscription | `doctorId`→Doctor; `invoiceId`→Invoice; `userId`→User | 1 | 2 |
| `SymptomSession.js` | SymptomSession | `userId`→User | 1 | 0 |
| `TransactionLedger.js` | TransactionLedger | `doctorId`→Doctor; `paymentId`→Payment; `subscriptionId`→Subscription; `userId`→User; `walletId`→Wallet | 2 | 2 |
| `User.js` | User | `reviewedBy`→User | 1 | 1 |
| `Wallet.js` | Wallet | `userId`→User | 0 | 1 |
| `WalletRecharge.js` | WalletRecharge | `actorId`→User; `ledgerEntryId`→TransactionLedger; `userId`→User | 2 | 1 |
| `WalletReservation.js` | WalletReservation | `actorId`→User; `paymentId`→Payment; `userId`→User; `walletId`→Wallet | 2 | 1 |
| `WebhookEvent.js` | WebhookEvent | — | 2 | 1 |
| `Withdrawal.js` | Withdrawal | `actorId`→User; `doctorId`→Doctor; `payoutReference`→DoctorPayout; `processedBy`→User; `requestedBy`→User; `settledBy`→User | 3 | 2 |
| `WithdrawalReservationGate.js` | WithdrawalReservationGate | `doctorId`→Doctor | 0 | 1 |

## Notes confirmed from code

- `Appointment.doctorId` references **`Doctor`**, not `User`; `Doctor.userId` links the doctor profile to its `User`.
- `User.role` is one of `super_admin`, `doctor`, `patient` (`backend/constants/roles.js`). There is no separate `admin` role.
- Active appointment slots are protected by a partial unique index on `{doctorId, date, timeSlot}` limited to the statuses in `ACTIVE_STATUSES` (`backend/constants/appointmentStatus.js`).
- No model sets an explicit `collection:` option, so collection names follow Mongoose default pluralisation.

## Not covered

- Field-by-field schema tables are intentionally not duplicated here; read the model file.
- Index definitions inside sub-schemas or created by migrations (`backend/migrations/`) are not enumerated.
