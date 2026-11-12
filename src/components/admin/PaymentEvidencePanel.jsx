import StatusBadge from "../ui/StatusBadge";

const inr = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format((paise || 0) / 100);
const when = (v) => (v ? new Date(v).toLocaleString() : "—");

const Row = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
    <dt className="text-slate-500">{label}</dt>
    <dd className="text-right font-semibold text-slate-800">{children}</dd>
  </div>
);
const Section = ({ title, children, note }) => (
  <section className="rounded-control border border-slate-200 p-4">
    <h4 className="text-sm font-bold text-slate-950">{title}</h4>
    {note && <p className="mb-2 text-xs text-slate-500">{note}</p>}
    {children}
  </section>
);
const Empty = ({ children }) => <p className="text-sm font-semibold text-slate-400">{children}</p>;

// Evidence behind one payment, exactly as the server stored it (safe projection: no signatures, payloads or secrets).
function PaymentEvidencePanel({ evidence }) {
  if (!evidence) return <Empty>Evidence is unavailable for this payment.</Empty>;
  const { allocation: a, attempts, stateTransitions, walletReservation, ledger, earning, reconciliation } = evidence;
  return (
    <div className="space-y-4">
      <Section title="Funding allocation" note="Wallet and gateway portions as decided by the server at checkout, with refund counters.">
        <dl>
          <Row label="Total">{inr(a.totalPaise)}</Row>
          <Row label="Wallet / gateway">{inr(a.walletPaise)} / {inr(a.gatewayPaise)}</Row>
          <Row label="Refunded (wallet / gateway)">{inr(a.refundedPaise)} ({inr(a.walletRefundedPaise)} / {inr(a.gatewayRefundedPaise)})</Row>
          <Row label="Provider refunds counted">{a.providerRefundsCounted}</Row>
          <Row label="Consistency">
            <span className="flex flex-wrap justify-end gap-1">
              <StatusBadge tone={a.allocationConsistent ? "success" : "danger"}>{a.allocationConsistent ? "allocation adds up" : "allocation does not add up"}</StatusBadge>
              <StatusBadge tone={a.refundSplitConsistent ? "success" : "danger"}>{a.refundSplitConsistent ? "refund split adds up" : "refund split mismatch"}</StatusBadge>
            </span>
          </Row>
        </dl>
      </Section>

      <Section title="Reconciliation status">
        <dl>
          <Row label="Payment state">{reconciliation.paymentState || "—"}</Row>
          <Row label="Reconciliation">
            <StatusBadge tone={reconciliation.reconciliationState === "required" ? "danger" : "neutral"}>{reconciliation.reconciliationState}</StatusBadge>
          </Row>
          <Row label="Unresolved capture cases">{reconciliation.unresolvedCaptureCases}</Row>
          <Row label="Provider payment id recorded">{reconciliation.hasProviderPaymentId ? "yes" : "no"}</Row>
        </dl>
      </Section>

      <Section title="Checkout attempts" note="Most recent first.">
        {attempts.length === 0 ? <Empty>No attempts recorded.</Empty> : (
          <ul className="space-y-2">
            {attempts.map((t) => (
              <li key={`${t.attemptNumber}-${t.gatewayOrderId}`} className="rounded-control bg-slate-50 p-2 text-xs text-slate-600">
                <span className="font-bold text-slate-800">#{t.attemptNumber}</span> · {t.status} · {t.amount} {t.currency}
                <span className="block font-mono">order {t.gatewayOrderId}{t.gatewayPaymentId ? ` · payment ${t.gatewayPaymentId}` : ""}</span>
                {t.failureReason && <span className="block text-rose-700">{t.failureCode ? `${t.failureCode}: ` : ""}{t.failureReason}</span>}
                <span className="block text-slate-400">{when(t.startedAt)} → {when(t.completedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Wallet hold">
        {!walletReservation ? <Empty>No wallet reservation for this payment.</Empty> : (
          <dl>
            <Row label="Status"><StatusBadge tone={walletReservation.status === "recovery_required" ? "danger" : "neutral"}>{walletReservation.status}</StatusBadge></Row>
            <Row label="Amount">{inr(walletReservation.amountPaise)}</Row>
            <Row label="Committed / released">{when(walletReservation.committedAt)} / {when(walletReservation.releasedAt)}</Row>
            {walletReservation.lastError && <Row label="Last recovery error">{walletReservation.lastError}</Row>}
          </dl>
        )}
      </Section>

      <Section title="Ledger references" note={evidence.ledgerTruncated ? "Showing the first 100 entries." : "Immutable postings tied to this payment."}>
        {ledger.length === 0 ? <Empty>No ledger rows reference this payment.</Empty> : (
          <ul className="space-y-1.5">
            {ledger.map((l) => (
              <li key={l.idempotencyKey || `${l.type}-${l.createdAt}`} className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-slate-50 p-2 text-xs">
                <span className="font-bold capitalize text-slate-800">{String(l.type).replaceAll("_", " ")} · {l.direction}</span>
                <span className="font-semibold">{l.currency || "INR"} {l.amount} · {l.status}</span>
                <span className="w-full font-mono text-slate-400">{l.idempotencyKey || l.referenceId || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Doctor earning">
        {!earning ? <Empty>No payout record for this payment.</Empty> : (
          <dl>
            <Row label="Payout status">{earning.status}</Row>
            <Row label="Gross / platform / doctor">₹{earning.grossAmount} / ₹{earning.platformFee} / ₹{earning.doctorAmount}</Row>
            <Row label="Refund reversal (doctor / platform)">₹{earning.refundAdjustmentAmount || 0} / ₹{earning.platformRefundAdjustmentAmount || 0}</Row>
            <Row label="Liability">{earning.liabilityStatus || "none"}</Row>
          </dl>
        )}
      </Section>

      <Section title="State transitions" note="Server-recorded payment state changes (most recent 50).">
        {stateTransitions.length === 0 ? <Empty>No transitions recorded.</Empty> : (
          <ol className="space-y-1 text-xs text-slate-600">
            {stateTransitions.map((t, i) => (
              <li key={`${t.at}-${i}`}><span className="font-bold text-slate-800">{t.from || "∅"} → {t.to}</span> · {t.source || "system"} · {when(t.at)}{t.reason ? ` — ${t.reason}` : ""}</li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

export default PaymentEvidencePanel;
