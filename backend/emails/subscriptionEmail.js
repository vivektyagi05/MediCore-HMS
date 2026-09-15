export const subscriptionEmail = ({ subscription }) => `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#0f172a">Subscription update</h2>
    <p>Your ${subscription.planName} subscription is ${subscription.status}.</p>
  </div>
`;
