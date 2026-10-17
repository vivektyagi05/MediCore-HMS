# HMS AI Automation Test Scenarios

## Symptom Checker Safety

- Submit an empty symptom list and confirm the API returns `400`.
- Submit symptoms without accepting the disclaimer and confirm the API returns `400`.
- Submit severe chest pain symptoms and confirm urgency is `urgent` with emergency-care safety wording.
- Confirm symptom output never contains diagnosis language such as "you have".

## Doctor Recommendations

- Request recommendations for a specialization with no matching doctors and confirm the response is empty, not an error.
- Request recommendations with a preferred date and confirm doctors without matching availability score lower.
- Create historical appointments for a patient and confirm previously consulted doctors receive a history boost.

## Smart Scheduling

- Create a booked slot, request AI slots, and confirm that slot is excluded.
- Create overloaded doctor schedules and confirm admin optimization marks them `overloaded`.
- Confirm low-traffic slots are ranked above busy midday slots when otherwise equivalent.

## AI Insights And Predictions

- Generate insights twice in one day and confirm the GET endpoint does not create duplicate daily insight batches.
- Seed high cancellation data and confirm a cancellation-risk insight appears.
- Seed payment/refund history and confirm predictive analytics returns refund risk and revenue forecast.

## Reminder Automation

- Run appointment reminders twice and confirm duplicate `ReminderLog.eventKey` entries are not created.
- Create pending payment appointments and confirm payment reminders emit in-app notifications.
- Create prescriptions with follow-up dates and confirm follow-up reminders are logged and delivered.

## Chatbot Misuse

- Send a medical diagnosis request and confirm the chatbot routes to safe symptom triage language.
- Send an oversized prompt and confirm the API rejects it.
- Ask about booking, payment, and refund flows and confirm the chatbot returns workflow guidance only.

## Realtime AI Alerts

- Generate overload insights and confirm admins receive a realtime notification.
- Run automation and confirm reminder delivery appears in the live notification center.
- Disconnect and reconnect the frontend and confirm missed AI notifications are recovered from `/api/realtime/notifications`.
