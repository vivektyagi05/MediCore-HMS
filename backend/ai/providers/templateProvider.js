// Default AI text-generation provider: deterministic, template-driven, and
// fully grounded in the `context` object it is given — it never invents a
// fact. This keeps the AI layer usable with zero external configuration
// while the provider interface stays swappable (see textGenerationProvider.js).

const join = (list, fallback = "none reported") => (Array.isArray(list) && list.length ? list.join(", ") : fallback);
const fmtDate = (value) => (value ? new Date(value).toLocaleDateString() : "not on file");

function renderConsultationSummary(context) {
  const { patientName, reason, symptoms, painLevel, doctorNotes, recommendations, outcomeStatus } = context;
  const parts = [];
  parts.push(`Consultation with ${patientName || "the patient"} for: ${reason || "a general visit"}.`);
  if (symptoms?.length) parts.push(`Reported symptoms: ${join(symptoms)}${painLevel != null ? ` (pain level ${painLevel}/10)` : ""}.`);
  if (doctorNotes) parts.push(`Clinical notes on file: ${doctorNotes}`);
  if (recommendations) parts.push(`Recommendations given: ${recommendations}`);
  parts.push(`Consultation status: ${outcomeStatus || "in progress"}.`);
  return parts.join(" ");
}

function renderPatientClinicalBrief(context) {
  const {
    patientName,
    appointmentCount,
    lastVisit,
    nextVisit,
    medicalConditions,
    allergies,
    medications,
    recentPrescriptionsCount,
    upcomingFollowUp,
    insuranceProvider,
    outstandingAmount,
  } = context;

  const overview = [
    `${patientName || "This patient"} has been seen ${appointmentCount || 0} time(s) with you, last on ${fmtDate(lastVisit)}${
      nextVisit ? `, next visit on ${fmtDate(nextVisit)}` : ""
    }.`,
  ];
  if (medicalConditions?.length || allergies?.length) {
    overview.push(`On file: ${join(medicalConditions, "no conditions recorded")}${allergies?.length ? `; allergies to ${join(allergies)}` : ""}.`);
  }

  const checklist = [];
  if (allergies?.length) checklist.push(`Confirm allergy status before prescribing: ${join(allergies)}.`);
  if (medications?.length) checklist.push(`Review current medications on file: ${join(medications)}.`);
  if (recentPrescriptionsCount) checklist.push(`${recentPrescriptionsCount} prescription(s) already on file with you.`);
  if (upcomingFollowUp) checklist.push(`A follow-up was scheduled for ${fmtDate(upcomingFollowUp)}.`);
  if (insuranceProvider) checklist.push(`Insurance on file: ${insuranceProvider}.`);
  if (outstandingAmount) checklist.push(`Outstanding balance of ₹${outstandingAmount} on this patient's account.`);

  return {
    overview: overview.join(" "),
    checklist: checklist.length ? checklist : ["No additional flags on file for this patient."],
  };
}

function renderClinicalNoteDraft(context) {
  const { reason, symptoms, painLevel, allergies, medications, insuranceProvider, reportCount } = context;
  return {
    subjective: `Patient reports: ${reason || "not specified"}. Symptoms: ${join(symptoms)}${painLevel != null ? `. Pain level ${painLevel}/10.` : "."}`,
    objective: `Allergies on file: ${join(allergies)}. Current medications: ${join(medications)}. Reports on file: ${reportCount || 0}. Insurance: ${insuranceProvider || "none on file"}.`,
    assessment: "[Doctor to complete — clinical assessment]",
    plan: "[Doctor to complete — treatment plan / follow-up]",
  };
}

function renderPrescriptionExplain(context) {
  const { diagnosis, medicines, followUpDate } = context;
  const lines = (medicines || []).map(
    (m) => `${m.name}: take ${m.dosage}, ${m.frequency}, for ${m.duration}.${m.instructions ? ` Note: ${m.instructions}` : ""}`,
  );
  return {
    overview: `This prescription was written for: ${diagnosis || "your visit"}.`,
    medicines: lines,
    followUp: followUpDate ? `A follow-up is scheduled for ${fmtDate(followUpDate)}.` : "No follow-up date has been set.",
    note: "Take medicines exactly as prescribed. Contact your doctor before stopping or changing any medication.",
  };
}

function renderDocumentSummary(context) {
  const { title, category, reportDate, notes, missingFields } = context;
  return {
    summary: `"${title || "This document"}" (${category || "uncategorized"}) dated ${fmtDate(reportDate)}.${notes ? ` Notes on file: ${notes}` : " No notes were added at upload."}`,
    keyObservations: notes
      ? notes
          .split(/[.\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [],
    missingInfo: missingFields?.length ? missingFields : ["None — all core fields are present"],
  };
}

function renderAppointmentPrep(context) {
  const { doctorName, specialization, date, timeSlot, reason, reportCount } = context;
  const checklist = [
    `Arrive 10-15 minutes before your ${timeSlot || "scheduled"} slot on ${fmtDate(date)}.`,
    "Bring a valid ID and your insurance card if applicable.",
    reportCount ? `Bring or confirm access to your ${reportCount} uploaded report(s).` : "Upload any recent test results before the visit if you have them.",
    "List current medications and allergies to share with the doctor.",
  ];
  const questions = [
    reason ? `What could be causing "${reason}"?` : "What should I expect from this visit?",
    "Are there any lifestyle changes you'd recommend?",
    "When should I schedule a follow-up, and what symptoms should prompt an earlier visit?",
  ];
  return {
    intro: `Preparing for your visit with Dr. ${doctorName || "your doctor"}${specialization ? ` (${specialization})` : ""}.`,
    checklist,
    questionsForDoctor: questions,
  };
}

const COMMUNICATION_TEMPLATES = {
  appointment_reminder: (c) =>
    `Hi ${c.patientName || "there"}, this is a reminder for your appointment with Dr. ${c.doctorName || ""} on ${fmtDate(c.date)} at ${c.timeSlot || "your scheduled time"}. Reply if you need to reschedule.`,
  patient_follow_up: (c) =>
    `Hi ${c.patientName || "there"}, following up after your recent visit${c.reason ? ` for ${c.reason}` : ""}. Please let us know how you're feeling and reach out with any questions.`,
  review_reply: (c) =>
    `Thank you for sharing your feedback${c.rating ? ` (${c.rating}/5)` : ""}. ${c.rating && c.rating <= 3 ? "We're sorry your experience fell short and would like to make it right — please reach out so we can help." : "We're glad to hear about your experience and appreciate you taking the time to share it."}`,
  admin_announcement: (c) =>
    `Announcement: ${c.subject || "Platform update"}. ${c.body || "Details to be added."}`,
  doctor_response: (c) =>
    `Hi ${c.patientName || "there"}, thank you for reaching out. ${c.topic ? `Regarding ${c.topic}: ` : ""}[Doctor to complete response].`,
};

function renderCommunicationDraft(context) {
  const builder = COMMUNICATION_TEMPLATES[context.type];
  if (!builder) throw new Error(`Unknown communication type: ${context.type}`);
  return builder(context);
}

function renderMetricExplain(context) {
  const { metricKey, value, breakdown, threshold } = context;
  const labels = {
    healthScore: "Platform Health Score",
    cancellationRate: "Cancellation Rate",
    paymentFailureRate: "Payment Failure Rate",
    refundBacklog: "Refund Backlog",
  };
  const label = labels[metricKey] || metricKey;

  if (metricKey === "healthScore") {
    const narrative = breakdown?.length
      ? `The Platform Health Score is ${value}/100. It is reduced by: ${breakdown.join("; ")}.`
      : `The Platform Health Score is ${value}/100, with no deductions currently applied.`;
    return { narrative };
  }

  if (threshold != null) {
    return {
      narrative:
        value > threshold
          ? `${label} is currently ${value}%, above the ${threshold}% threshold used elsewhere in the platform health calculation.`
          : `${label} is currently ${value}%, within the healthy ${threshold}% threshold.`,
    };
  }

  return { narrative: `${label} is currently ${value}.` };
}

function renderExecutiveBrief(context) {
  const { revenue, appointments, pendingApprovals, refunds, doctors } = context;
  const bullets = [];
  bullets.push(`Revenue today is INR ${revenue?.today || 0}, INR ${revenue?.week || 0} this week, INR ${revenue?.month || 0} this month.`);
  bullets.push(`${appointments?.today || 0} appointments today; ${appointments?.pending || 0} awaiting approval; ${appointments?.cancelledToday || 0} cancelled today.`);
  if (pendingApprovals?.total) bullets.push(`${pendingApprovals.total} items need admin attention (${pendingApprovals.doctorVerifications || 0} doctor verifications, ${pendingApprovals.refunds || 0} refunds).`);
  if (refunds?.pendingCount) bullets.push(`${refunds.pendingCount} refund(s) pending, totaling INR ${refunds.pendingAmount || 0}.`);
  bullets.push(`${doctors?.online || 0} of ${doctors?.total || 0} doctors currently online.`);
  return {
    narrative: `Here is today's operational snapshot based on live platform data.`,
    bullets,
  };
}

function renderWorkflowSuggestions(context) {
  const items = [];
  if (context.pendingApprovals) items.push({ priority: "high", label: `${context.pendingApprovals} appointment approval(s) pending` });
  if (context.pendingRefunds) items.push({ priority: "high", label: `${context.pendingRefunds} refund request(s) pending` });
  if (context.followUpsDue) items.push({ priority: "medium", label: `${context.followUpsDue} patient(s) due for follow-up` });
  if (context.incompleteProfiles) items.push({ priority: "low", label: `${context.incompleteProfiles} profile(s) incomplete` });
  if (context.doctorVerifications) items.push({ priority: "high", label: `${context.doctorVerifications} doctor verification(s) pending` });
  return items;
}

function renderPrescriptionFollowUpSuggestion(context) {
  const { diagnosis, medicines, longestDurationDays, visitCount } = context;
  const window = longestDurationDays
    ? `${Math.max(3, Math.round(longestDurationDays * 0.7))}-${longestDurationDays} days`
    : "7-10 days";
  return {
    suggestedWindow: window,
    narrative: `Based on the prescribed course${medicines?.length ? ` (${join(medicines)})` : ""}${
      diagnosis ? ` for ${diagnosis}` : ""
    }, a follow-up in about ${window} would let you confirm response to treatment${
      visitCount ? ` (this is visit ${visitCount} with this patient)` : ""
    }. Set the actual date based on your clinical judgment.`,
  };
}

function renderScheduleOptimization(context) {
  const { dayUtilization, upcomingLeaveDays } = context;
  const items = [];
  (dayUtilization || []).forEach((day) => {
    if (day.capacity && day.booked / day.capacity >= 0.9) {
      items.push({ priority: "high", label: `${day.label} is ${Math.round((day.booked / day.capacity) * 100)}% booked — consider adding a session or emergency slots.` });
    } else if (day.capacity && day.booked === 0) {
      items.push({ priority: "low", label: `${day.label} has no bookings yet — consider reducing configured capacity or promoting availability.` });
    }
  });
  if (upcomingLeaveDays) items.push({ priority: "medium", label: `${upcomingLeaveDays} upcoming leave day(s) on file — patients booking around these dates will need slots blocked.` });
  return items.length ? items : [{ priority: "low", label: "No scheduling pressure detected from current bookings." }];
}

function renderDocumentCenterSuggestions(context) {
  const items = [];
  if (context.expiringCount) items.push({ priority: "high", label: `${context.expiringCount} document(s) expiring within 30 days — renew soon.` });
  if (context.expiredCount) items.push({ priority: "high", label: `${context.expiredCount} document(s) already expired — renewal is overdue.` });
  if (context.pendingVerificationCount) items.push({ priority: "medium", label: `${context.pendingVerificationCount} document(s) still awaiting verification.` });
  if (context.recentCertificates) items.push({ priority: "low", label: `${context.recentCertificates} certificate(s) issued recently — available in Generated Certificates.` });
  return items.length ? items : [{ priority: "low", label: "No document actions needed right now." }];
}

function renderReviewSentiment(context) {
  const { reviews } = context;
  const total = reviews?.length || 0;
  const positive = reviews?.filter((r) => r.rating >= 4).length || 0;
  const neutral = reviews?.filter((r) => r.rating === 3).length || 0;
  const negative = reviews?.filter((r) => r.rating <= 2).length || 0;
  return {
    total,
    positivePct: total ? Math.round((positive / total) * 100) : 0,
    neutralPct: total ? Math.round((neutral / total) * 100) : 0,
    negativePct: total ? Math.round((negative / total) * 100) : 0,
    narrative: total
      ? `${positive} of ${total} reviews are positive (4-5 stars), ${neutral} neutral, ${negative} negative.`
      : "No reviews available yet for sentiment analysis.",
  };
}

function renderPaymentExplain(context) {
  const { totalAmount, currency, gatewayAmount, walletAmount, discountAmount, taxAmount, status, doctorName, createdAt } = context;
  const parts = [];
  parts.push(`This payment of ${currency || "INR"} ${totalAmount} was for your consultation with Dr. ${doctorName || "your doctor"} on ${fmtDate(createdAt)}.`);
  const splits = [];
  if (gatewayAmount) splits.push(`${currency || "INR"} ${gatewayAmount} via gateway`);
  if (walletAmount) splits.push(`${currency || "INR"} ${walletAmount} from your wallet`);
  if (discountAmount) splits.push(`${currency || "INR"} ${discountAmount} coupon discount`);
  if (splits.length) parts.push(`Breakdown: ${splits.join(", ")}.`);
  if (taxAmount) parts.push(`Includes ${currency || "INR"} ${taxAmount} tax.`);
  parts.push(`Current status: ${(status || "unknown").replace("_", " ")}.`);
  return parts.join(" ");
}

function renderInvoiceExplain(context) {
  const { invoiceNumber, totalAmount, taxAmount, currency, documentType, lineItems, issuedAt } = context;
  return {
    overview: `Invoice ${invoiceNumber || ""} issued ${fmtDate(issuedAt)} — this is a ${(documentType || "tax_invoice").replace(/_/g, " ")}.`,
    lineItems: (lineItems || []).map((item) => `${item.description}: ${currency || "INR"} ${item.total}`),
    taxAndTotal: `Tax: ${currency || "INR"} ${taxAmount || 0}. Total: ${currency || "INR"} ${totalAmount}.`,
  };
}

function renderRefundAssistant(context) {
  const { amount, currency, reason, status, timeline } = context;
  const statusNarrative = {
    pending: "Your refund request is awaiting review.",
    approved: "Your refund has been approved and is being processed.",
    processed: "Your refund has been processed and credited to your wallet.",
    rejected: "Your refund request was not approved.",
    failed: "Your refund could not be processed and needs attention.",
  };
  return {
    summary: `Refund request for ${currency || "INR"} ${amount}: ${reason || "no reason on file"}.`,
    status: statusNarrative[status] || `Current status: ${status}.`,
    timeline: (timeline || []).map((entry) => `${fmtDate(entry.at)}: ${entry.note || entry.status}`),
  };
}

function renderExpenseSummary(context) {
  const { monthlySpending, doctorWiseSpending, taxSummary, expenseSummary } = context;
  const bullets = [];
  if (expenseSummary?.allTimeTotal) bullets.push(`You've spent a total of INR ${expenseSummary.allTimeTotal} across ${expenseSummary.allTimeCount || 0} payments.`);
  if (taxSummary?.totalTax) bullets.push(`INR ${taxSummary.totalTax} of that was tax this year.`);
  if (doctorWiseSpending?.length) bullets.push(`Your highest spending is with Dr. ${doctorWiseSpending[0].doctorName} (INR ${doctorWiseSpending[0].totalAmount}).`);
  if (expenseSummary?.totalRefunded) bullets.push(`INR ${expenseSummary.totalRefunded} has been refunded back to you.`);
  const trendCount = monthlySpending?.length || 0;
  return {
    narrative: trendCount ? `Here is a summary of your healthcare spending over the last ${trendCount} month(s).` : "No spending recorded yet.",
    insights: bullets.length ? bullets : ["Not enough data yet for spending insights."],
  };
}

function renderFamilyHealthInsights(context) {
  const { members } = context;
  if (!members?.length) {
    return { narrative: "No family members added yet.", observations: ["Add a dependent to start tracking their health records here."] };
  }
  const observations = [];
  members.forEach((member) => {
    if (member.upcomingAppointment) observations.push(`${member.name} has an upcoming appointment on ${fmtDate(member.upcomingAppointment)}.`);
    if (!member.insuranceCount) observations.push(`${member.name} has no insurance policy on file.`);
    if (!member.reportCount) observations.push(`${member.name} has no health records uploaded yet.`);
  });
  return {
    narrative: `You are managing health records for ${members.length} family member(s).`,
    observations: observations.length ? observations.slice(0, 6) : ["All family members have records and insurance on file."],
  };
}

function renderInsuranceExplain(context) {
  const { provider, coverageAmount, validTill, claimStatus, familyMemberName } = context;
  const parts = [];
  parts.push(`This is your ${provider || "insurance"} policy${familyMemberName ? ` for ${familyMemberName}` : ""}, valid until ${fmtDate(validTill)}.`);
  if (coverageAmount) parts.push(`It provides coverage up to INR ${coverageAmount}.`);
  parts.push(`Claim status: ${(claimStatus || "not_submitted").replace(/_/g, " ")}.`);
  return parts.join(" ");
}

function renderInsuranceEligibilitySummary(context) {
  const { coverageAmount, utilizedAmount, remainingAmount, claimStatus } = context;
  const parts = [];
  parts.push(`Of your INR ${coverageAmount || 0} coverage, INR ${utilizedAmount || 0} has been used against real consultations, leaving INR ${remainingAmount || 0} remaining.`);
  const claimNarrative = {
    not_submitted: "No claim has been submitted for this policy yet.",
    submitted: "Your claim has been submitted and is awaiting review.",
    in_review: "Your claim is currently under review.",
    approved: "Your claim has been approved.",
    rejected: "Your claim was not approved.",
  };
  parts.push(claimNarrative[claimStatus] || `Current claim status: ${claimStatus}.`);
  return parts.join(" ");
}

function renderHealthProfileReview(context) {
  const { healthScore, breakdown, bmi } = context;
  const missing = (breakdown || []).filter((check) => !check.ok);
  const parts = [];
  parts.push(`Your health profile is ${healthScore ?? 0}% complete.`);
  if (bmi?.value) parts.push(`Your recorded BMI is ${bmi.value} (${bmi.category}).`);
  return {
    narrative: parts.join(" "),
    suggestions: missing.length
      ? missing.slice(0, 4).map((check) => `Add ${check.label.toLowerCase()} to strengthen your profile.`)
      : ["Your profile has every core field on file — nice work keeping it current."],
  };
}

function renderHealthJourneySummary(context) {
  const { timeline, milestones, nextAction } = context;
  const recent = (timeline || []).slice(0, 5);
  const parts = [];
  parts.push(
    recent.length
      ? `Your most recent health activity: ${recent.map((item) => item.title).slice(0, 3).join("; ")}.`
      : "No health activity recorded yet.",
  );
  if (milestones?.length) parts.push(milestones.map((m) => `${m.value} ${m.label.toLowerCase()}`).join(", ") + ".");
  if (nextAction?.label) parts.push(`Next up: ${nextAction.label}`);
  return {
    narrative: parts.join(" "),
    recentActivity: recent.map((item) => `${item.type}: ${item.title}`),
  };
}

function renderRevenueInsights(context) {
  const { totalEarnings, collectedAmount, monthlyEarnings, pendingEarnings, upcomingPayout, platformFees, totalTax, totalRefunded, incomeForecast, incomeForecastBasisMonths, monthlyTrend } = context;
  const bullets = [];
  bullets.push(`Total attributed earnings are INR ${totalEarnings || 0}, with INR ${monthlyEarnings || 0} settled this month.`);
  // PHASE DOC-09: earned (payout attribution) and collected (actual patient
  // payment capture) are genuinely different numbers — only stated
  // separately when the supplied data distinguishes them, never implied
  // when it's absent.
  if (collectedAmount != null) {
    bullets.push(`INR ${collectedAmount} has actually been collected from patients to date.`);
  }
  bullets.push(`INR ${pendingEarnings || 0} is pending settlement; the next upcoming payout is INR ${upcomingPayout || 0}.`);
  if (totalTax) bullets.push(`INR ${totalTax} has been collected in taxes and INR ${platformFees || 0} in platform fees to date.`);
  if (totalRefunded) bullets.push(`INR ${totalRefunded} has been refunded to patients to date.`);
  const trendUp = monthlyTrend?.length >= 2 && monthlyTrend.at(-1).amount >= monthlyTrend.at(-2).amount;
  if (incomeForecast != null) {
    bullets.push(`Based on the last ${incomeForecastBasisMonths || 3} completed month(s), next month's income is projected around INR ${incomeForecast}${trendUp ? ", continuing a recent upward trend" : ""}.`);
  } else {
    bullets.push("Not enough settled-payout history yet to project next month's income.");
  }
  return {
    narrative: "Here is a summary of your current revenue position based on your real settlement data.",
    bullets,
  };
}

function renderReputationAdvisor(context) {
  const { rating, satisfactionRate, responseRate, appointmentReliability, repeatPatientRate, topStrengths, improvementOpportunities } = context;
  const bullets = [];
  bullets.push(`Your current rating is ${rating || 0}/5 with a ${satisfactionRate || 0}% patient satisfaction rate.`);
  if (topStrengths?.length) bullets.push(`Your strongest areas right now: ${topStrengths.join(" and ")}.`);
  if (improvementOpportunities?.length) {
    bullets.push(`Focus area to improve: ${improvementOpportunities[0]}.`);
    if (improvementOpportunities[0]?.toLowerCase().includes("response") && responseRate < 100) {
      bullets.push(`Replying to more patient reviews (currently ${responseRate}% response rate) tends to lift patient trust.`);
    }
    if (improvementOpportunities[0]?.toLowerCase().includes("reliability") && appointmentReliability < 100) {
      bullets.push(`Reducing cancellations would raise your appointment reliability above its current ${appointmentReliability}%.`);
    }
  }
  bullets.push(`${repeatPatientRate || 0}% of your consultations are repeat patients — a strong signal of trust to build on.`);
  return {
    narrative: "Here's an honest read on your reputation standing based on your real patient data.",
    bullets,
  };
}

function renderBusinessAdvisor(context) {
  const { businessScore, revenue, rating, growth, retention, appointments, refundRate } = context;
  const bullets = [];
  bullets.push(`Overall business health score: ${businessScore || 0}/100.`);
  bullets.push(`Revenue this month is INR ${revenue?.monthly || 0}, with a forecast of INR ${revenue?.forecast || 0} next month.`);
  bullets.push(`Rating stands at ${rating?.average || 0}/5 across ${rating?.totalReviews || 0} reviews (${rating?.satisfactionRate || 0}% satisfaction).`);
  const opportunity = growth?.newPatientsThisMonth
    ? `Business opportunity: ${growth.newPatientsThisMonth} new patients this month — consider a follow-up outreach to convert them into repeat patients.`
    : "Business opportunity: attracting new patients this month has been limited; consider promoting availability.";
  bullets.push(opportunity);
  const weakArea = (appointments?.cancelled || 0) > 0
    ? `Weak area: ${appointments.cancelled} cancelled appointment(s) recently — reducing these would improve both revenue and reliability.`
    : (refundRate > 0 ? `Weak area: a ${refundRate}% refund rate is worth reviewing.` : "No major weak area detected in the current data.");
  bullets.push(weakArea);
  bullets.push(`Patient retention: ${retention?.repeatPatientRate || 0}% repeat-patient rate; keep nurturing follow-ups to sustain it.`);
  bullets.push(`Growth outlook: ${growth?.growthForecast >= 0 ? "+" : ""}${growth?.growthForecast || 0}% projected month-over-month.`);
  return {
    narrative: "Here is your monthly business advisor summary, grounded in your real practice data.",
    bullets,
  };
}

function renderProfileReview(context) {
  const { profileCompletionPercent, practiceCompletenessPercent, verificationProgressPercent, seoReadinessPercent, trustScore, missingInformation, missingDocuments } = context;
  const bullets = [];
  bullets.push(`Your profile is ${profileCompletionPercent || 0}% complete, with practice details at ${practiceCompletenessPercent || 0}% and verification progress at ${verificationProgressPercent || 0}%.`);
  bullets.push(`SEO readiness stands at ${seoReadinessPercent || 0}%, and your current patient trust score is ${trustScore || 0}/100.`);
  if (missingInformation?.length) {
    bullets.push(`Highest-impact next step: ${missingInformation[0].label}.`);
  } else if (missingDocuments?.length) {
    bullets.push(`Highest-impact next step: upload your ${missingDocuments[0]}.`);
  } else {
    bullets.push("Your profile has no outstanding gaps right now -- keep it updated as your practice evolves.");
  }
  return {
    narrative: "Here's an honest look at how complete and discoverable your profile currently is.",
    bullets,
  };
}

function renderVerificationAdvisor(context) {
  const { verificationStatus, requiredDocuments, expiringSoon, expired, verificationNotes } = context;
  const bullets = [];
  bullets.push(`Your current verification status is "${verificationStatus || "pending"}".`);
  const missingDocs = (requiredDocuments || []).filter((d) => !d.uploaded);
  if (missingDocs.length) {
    bullets.push(`Still to upload: ${missingDocs.map((d) => d.label).join(", ")}.`);
  }
  const pendingReview = (requiredDocuments || []).filter((d) => d.uploaded && d.status === "pending");
  if (pendingReview.length) {
    bullets.push(`Awaiting admin review: ${pendingReview.map((d) => d.label).join(", ")}.`);
  }
  if (expired?.length) bullets.push(`${expired.length} document(s) have expired and need renewal.`);
  if (expiringSoon?.length) bullets.push(`${expiringSoon.length} document(s) are expiring within 30 days.`);
  if (verificationStatus === "rejected" && verificationNotes) bullets.push(`Rejection reason to address: ${verificationNotes}.`);
  if (!missingDocs.length && !expired?.length && !expiringSoon?.length && verificationStatus === "approved") {
    bullets.push("All required documents are on file and your verification is approved -- nothing outstanding.");
  }
  return {
    narrative: "Here's exactly what's outstanding on your verification.",
    bullets,
  };
}

function renderSubscriptionAdvisor(context) {
  const { currentPlan, usage } = context;
  const bullets = [];
  bullets.push(`You're currently on the ${currentPlan?.planName || "Free"} plan.`);
  const usageEntries = Object.entries(usage || {});
  const nearLimit = usageEntries.filter(([, v]) => v?.limit && v.used / v.limit >= 0.8);
  const overLimit = usageEntries.filter(([, v]) => v?.limit && v.used > v.limit);
  if (overLimit.length) {
    bullets.push(`Over plan limit: ${overLimit.map(([k, v]) => `${k} (${v.used}/${v.limit})`).join(", ")}. Upgrading would remove this constraint.`);
  } else if (nearLimit.length) {
    bullets.push(`Approaching plan limit: ${nearLimit.map(([k, v]) => `${k} (${v.used}/${v.limit})`).join(", ")}.`);
  } else {
    bullets.push("Your usage is comfortably within your current plan's limits.");
  }
  return {
    narrative: "Here's how your real usage compares to your current plan's limits.",
    bullets,
  };
}

function renderGrowthAdvisor(context) {
  const { profileVisits, appointmentConversionRate, patientAcquisition, repeatPatients, growthScore } = context;
  const bullets = [];
  bullets.push(`Growth score: ${growthScore || 0}/100.`);
  bullets.push(`Profile visits: ${profileVisits || 0}${appointmentConversionRate != null ? `, converting to appointments at ${appointmentConversionRate}%` : " (not enough view data yet to measure conversion)"}.`);
  bullets.push(`${patientAcquisition?.newPatientsThisMonth || 0} new patient(s) this month, ${repeatPatients?.rate || 0}% repeat-patient rate.`);
  const weakest = appointmentConversionRate != null && appointmentConversionRate < 5
    ? "Focus on turning profile visits into bookings -- consider a clearer call-to-action on your public profile."
    : (repeatPatients?.rate || 0) < 30
      ? "Focus on patient retention -- follow-up outreach tends to lift your repeat-patient rate."
      : "Keep nurturing both new-patient acquisition and repeat visits to sustain growth.";
  bullets.push(weakest);
  return {
    narrative: "Here's your practice growth snapshot based on real visit and appointment data.",
    bullets,
  };
}

function renderMissingFieldsAdvisor(context) {
  const { missingInformation, missingDocuments } = context;
  const bullets = [];
  (missingInformation || []).forEach((item, index) => bullets.push(`${index + 1}. ${item.label}`));
  (missingDocuments || []).forEach((label, index) => bullets.push(`${(missingInformation || []).length + index + 1}. Upload ${label}`));
  if (!bullets.length) bullets.push("Nothing outstanding -- your profile and documents are complete.");
  return {
    narrative: "Here's your prioritized checklist of what to complete next.",
    bullets,
  };
}

function renderConsultationAssistant(context) {
  const {
    reason,
    symptoms,
    painLevel,
    allergies,
    medications,
    medicalConditions,
    reportCount,
    priorVisitCount,
    priorDiagnoses,
    safetyWarningCount,
  } = context;

  const checklist = [];
  if (allergies?.length) checklist.push(`Confirm current allergy status before prescribing: ${join(allergies)}.`);
  if (medications?.length) checklist.push(`Review medications already on file: ${join(medications)}.`);
  if (medicalConditions?.length) checklist.push(`Account for existing condition(s): ${join(medicalConditions)}.`);
  if (painLevel != null && painLevel >= 7) checklist.push(`Pain level reported at ${painLevel}/10 — assess urgency before discharge.`);
  if (priorVisitCount) checklist.push(`${priorVisitCount} prior visit(s) on file with you${priorDiagnoses?.length ? ` (previous diagnosis: ${join(priorDiagnoses)})` : ""}.`);
  if (safetyWarningCount) checklist.push(`${safetyWarningCount} prescription safety warning(s) already flagged — review before saving.`);
  if (!checklist.length) checklist.push("No additional flags on file for this visit — proceed with standard intake.");

  const investigations = [];
  const symptomText = join(symptoms, "").toLowerCase();
  if (/fever|infection/.test(symptomText)) investigations.push("Consider CBC and fever panel given reported fever/infection symptoms.");
  if (/chest|breath|cough/.test(symptomText)) investigations.push("Consider chest examination or imaging given reported chest/respiratory symptoms.");
  if (/pain/.test(symptomText) || (painLevel != null && painLevel >= 5)) investigations.push("Consider a focused examination of the site of reported pain.");
  if (reportCount) investigations.push(`${reportCount} report(s) already on file — review before ordering new tests.`);
  if (!investigations.length) investigations.push("No specific investigation suggested from the symptoms on file — clinical judgment applies.");

  const lifestyle = [];
  if (medicalConditions?.length) lifestyle.push(`General lifestyle guidance relevant to: ${join(medicalConditions)}.`);
  if (painLevel != null && painLevel >= 4) lifestyle.push("Advise rest and monitoring given the reported pain level.");
  if (!lifestyle.length) lifestyle.push("No condition-specific lifestyle guidance triggered by the data on file.");

  const referral = reason && /specialist|refer|persist|chronic|recurring/.test(String(reason).toLowerCase())
    ? "The stated reason mentions a pattern that may warrant a specialist referral — doctor to confirm."
    : "No referral signal found in the stated reason — doctor's clinical judgment applies.";

  return {
    checklist,
    investigationsToConsider: investigations,
    lifestyleGuidance: lifestyle,
    referralNote: referral,
  };
}

function renderPatientEducationSummary(context) {
  const { diagnosis, medicines, followUpDate } = context;
  const medicineLines = (medicines || []).map(
    (m) => `${m.name}: ${m.dosage}, ${m.frequency}, for ${m.duration}.${m.instructions ? ` ${m.instructions}` : ""}`,
  );
  return {
    visitSummary: `Your visit was recorded for: ${diagnosis || "your consultation"}.`,
    howToTakeYourMedicines: medicineLines.length ? medicineLines : ["No medicines were prescribed at this visit."],
    selfCareReminders: [
      "Take every medicine exactly as instructed above.",
      "Contact your doctor before stopping or changing any medication.",
      followUpDate ? `A follow-up is scheduled for ${fmtDate(followUpDate)}.` : "No follow-up date has been set yet.",
    ],
  };
}

function renderOperationSummary(context) {
  const { typeLabel, priority, reason, businessImpact, recommendedAction, slaState, elapsedHours, relatedCount } = context;

  const slaLine =
    slaState === "overdue"
      ? "This item is past its SLA target."
      : slaState === "at_risk"
        ? "This item is approaching its SLA target."
        : "This item is within its SLA target.";

  const riskNote =
    priority === "critical"
      ? "Critical priority — treat as an immediate action item."
      : priority === "high"
        ? "High priority — action recommended within the SLA window."
        : "Standard priority — action recommended in due course.";

  return {
    summary: `${typeLabel}: ${reason} ${slaLine} (elapsed ~${elapsedHours}h).${relatedCount ? ` ${relatedCount} related operation(s) are open for the same patient/doctor.` : ""}`,
    riskNote,
    resolutionSuggestion: recommendedAction || `Review this ${typeLabel.toLowerCase()} and resolve via its linked page.`,
    businessImpact,
  };
}

function renderWorkflowExplain(context) {
  const {
    typeLabel,
    department,
    priorityRule,
    slaRule,
    dependencies,
    currentStatus,
    allowedActions,
    priority,
    reason,
    businessImpact,
    slaState,
    relatedCount,
  } = context;

  const slaLine =
    slaState === "overdue"
      ? "past its SLA target"
      : slaState === "at_risk"
        ? "approaching its SLA target"
        : "within its SLA target";

  const actionsLine = (allowedActions || []).filter((a) => a !== "pin").join(", ") || "none (terminal state)";
  const dependencyLine = (dependencies || []).join(", ") || "no declared dependency fields";

  return {
    whatItIs: `${typeLabel} is a ${department} workflow. ${reason || ""}`.trim(),
    whyThisState: `It is currently "${currentStatus}". Priority (${priority}) is set by this workflow's Priority Policy: ${priorityRule} SLA is governed by: ${slaRule} This item is ${slaLine}.`,
    dependencies: `Grounded in real fields: ${dependencyLine}.`,
    nextActions: `Legal next actions from "${currentStatus}": ${actionsLine}.`,
    risk: businessImpact || "No additional business-impact note recorded for this item.",
    relatedNote: relatedCount ? `${relatedCount} related open operation(s) share the same patient/doctor.` : "No related open operations.",
  };
}

// ── Phase A6.2.2 — Smart Assignment Engine renderers ────────────────────
function renderAssignmentRecommendation(context) {
  const { item, candidates } = context;
  const top = (candidates || [])[0];
  if (!top) {
    return { recommendation: `No eligible candidate is currently under capacity for ${item?.typeLabel || "this item"}.` };
  }
  const b = top.breakdown || {};
  const highlights = [b.workload?.detail, b.experience?.detail, b.slaHistory?.detail].filter(Boolean).join("; ");
  return {
    recommendation: `${top.admin.name} is the top-ranked candidate for ${item?.typeLabel || "this item"} (score ${top.score}/100): ${highlights}.`,
    alternateNote:
      candidates.length > 1
        ? `${candidates.length - 1} alternate candidate(s) also available if this recommendation is overridden.`
        : "No other eligible candidates are currently under capacity.",
  };
}

function renderWorkloadAdvisor(context) {
  const { snapshots } = context;
  const overloaded = (snapshots || []).filter((s) => s.utilization?.state !== "available");
  const idle = (snapshots || []).filter((s) => s.openCount === 0);
  return {
    summary:
      overloaded.length > 0
        ? `${overloaded.length} admin(s) are at or near capacity: ${overloaded.map((s) => `${s.admin.name} (${s.utilization.pct}%)`).join(", ")}.`
        : "No admin is currently at or near capacity.",
    rebalanceSuggestion:
      overloaded.length > 0 && idle.length > 0
        ? `Consider shifting new assignments toward ${idle.map((s) => s.admin.name).join(", ")}, who currently have no open items.`
        : "No clear rebalancing opportunity from current workload data alone.",
  };
}

function renderReassignmentAdvisor(context) {
  const { item, shouldReassign, reasons, alternate } = context;
  if (!shouldReassign) {
    return { advice: `No reassignment is currently warranted for ${item?.typeLabel || "this item"}.` };
  }
  return {
    advice: `Reassignment is recommended for ${item?.typeLabel || "this item"} because: ${(reasons || []).join(", ")}.${
      alternate ? ` ${alternate.admin.name} is the best available alternate (score ${alternate.score}/100).` : " No alternate is currently under capacity."
    }`,
  };
}

function renderSlaAdvisor(context) {
  const { distribution, mostAtRiskType } = context;
  const total = (distribution?.on_track || 0) + (distribution?.at_risk || 0) + (distribution?.overdue || 0);
  return {
    summary:
      total === 0
        ? "No open operations to evaluate."
        : `Of ${total} open operations: ${distribution.on_track} on track, ${distribution.at_risk} at risk, ${distribution.overdue} overdue.`,
    mostAtRisk: mostAtRiskType ? `"${mostAtRiskType}" is currently the most at-risk operation type.` : "No single type stands out as most at-risk right now.",
  };
}

function renderAssignmentExplain(context) {
  const { weights, capacity } = context;
  const weightLines = Object.entries(weights || {})
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join(", ");
  return {
    explanation: `Every eligible candidate is scored on: ${weightLines}. Candidates at or over ${capacity?.overloadThresholdPct || 85}% utilization are flagged as near capacity, and no one is ever auto-assigned past ${capacity?.maxOpenItemsPerAdmin || "the configured"} open items.`,
  };
}

// ── Phase A6.2.3 — Enterprise Automation Studio renderers ───────────────
//
// AUDIT FINDING (Phase A6.2.4): automationFlowExplain / automationFlowAdvisor
// were fully wired end-to-end (promptLibrary.js entries, generativeAssistant.js
// wrapper functions, controller endpoints, routes, frontend API calls, UI
// panels) but NEITHER renderer function was ever written, and neither key
// was registered in RENDERERS below. Every real call to GET
// /flows/:id/ai-explain or /ai-advisor has therefore always thrown
// `No template renderer registered for promptKey: ...` and returned a 500 —
// a genuine root-cause bug in previously "shipped" work, not a regression
// from this phase. Fixed here by writing both renderers (grounded only in
// the real flow fields already passed as context — see
// automationStudioController.js) and registering them.
function renderAutomationFlowExplain(context) {
  const { flowName, triggerLabel, triggerType, conditions, actions } = context;
  const actionCount = (actions || []).length;
  const actionTypes = [...new Set((actions || []).map((a) => a.type))];
  const hasConditions = !!(conditions && ((conditions.rules && conditions.rules.length) || conditions.field));
  return {
    whatItDoes: `"${flowName}" runs whenever "${triggerLabel || triggerType}" happens.`,
    conditionSummary: hasConditions
      ? "It only proceeds when its configured conditions match the real event data."
      : "It has no conditions configured, so it always proceeds once triggered.",
    actionSummary: actionCount
      ? `It then runs ${actionCount} action${actionCount === 1 ? "" : "s"} in order: ${actionTypes.join(", ")}.`
      : "It has no actions configured yet, so triggering it currently does nothing.",
  };
}

function renderAutomationFlowAdvisor(context) {
  const { actions, stats } = context;
  const actionTypes = new Set((actions || []).map((a) => a.type));
  const totalRuns = stats?.totalRuns || 0;
  const failureCount = stats?.failureCount || 0;
  const failurePct = totalRuns ? Math.round((failureCount / totalRuns) * 1000) / 10 : null;

  const missingSafety = !actionTypes.has("activity_log")
    ? "No activity_log action is configured, so this flow leaves no audit trail of its own runs."
    : "An activity_log action is present, giving this flow its own audit trail.";

  const risk = (actions || []).some((a) => a.type === "webhook" && !a.config?.url)
    ? "A webhook action has no configured URL — it will fail on every real run until one is set."
    : failurePct !== null && failurePct > 20
      ? `Failure rate is ${failurePct}% across ${totalRuns} real run(s) — worth reviewing recent failed runs before relying on this flow.`
      : "No configuration risk detected in the real action list.";

  const optimization = totalRuns === 0
    ? "This flow has never run yet — use the Execution Simulator with a sample payload before publishing changes."
    : "Consider adding a notify_admins step if this flow currently fails silently.";

  return { missingSafety, risk, optimization };
}

// ── Phase A6.2.4 — Enterprise Monitoring Platform renderers ─────────────
// Every field below is re-fetched server-side from AutomationRunLog/
// CronRunLog/AutomationFlow/Payment by monitoringController.js — nothing
// here is fabricated or estimated.
function renderExecutionExplain(context) {
  const { flowName, triggerLabel, status, conditionsMatched, stepResults, durationMs, error } = context;
  const failed = (stepResults || []).filter((s) => s.ok === false && !s.skipped);
  const skipped = (stepResults || []).filter((s) => s.skipped);

  const outcome =
    status === "skipped"
      ? `This run of "${flowName}" was skipped because its conditions did not match the "${triggerLabel}" event data.`
      : status === "failed"
        ? `This run of "${flowName}" failed after ${durationMs}ms.`
        : `This run of "${flowName}" completed successfully in ${durationMs}ms.`;

  const stepNote = failed.length
    ? `${failed.length} action step(s) failed: ${failed.map((s) => `${s.actionType} (${s.message || "no message"})`).join("; ")}.`
    : skipped.length
      ? `${skipped.length} action step(s) were skipped.`
      : "Every configured action step ran successfully.";

  return {
    outcome,
    conditionNote: conditionsMatched === false ? "Condition evaluation did not match this event." : "Conditions matched this event.",
    stepNote,
    errorNote: error ? `Top-level error recorded: ${error}` : "No top-level error recorded.",
  };
}

function renderFailureExplain(context) {
  const { totalFailures, byTriggerType, byActionType, sampleMessages, rangeDays } = context;
  const topTrigger = (byTriggerType || [])[0];
  const topAction = (byActionType || [])[0];
  return {
    summary: totalFailures
      ? `${totalFailures} real failure(s) recorded across the last ${rangeDays} day(s).`
      : `No failures recorded in the last ${rangeDays} day(s).`,
    triggerNote: topTrigger
      ? `Most failures are on the "${topTrigger.triggerType}" trigger (${topTrigger.count}).`
      : "No trigger stands out as a concentration of failures.",
    actionNote: topAction
      ? `The action step most often failing is "${topAction.actionType}" (${topAction.count} occurrence(s)).`
      : "No single action type accounts for most failures.",
    sampleNote: sampleMessages?.length
      ? `Recent real error messages: ${sampleMessages.slice(0, 3).join(" | ")}`
      : "No error messages recorded on these failures.",
  };
}

function renderPerformanceAdvisor(context) {
  const { avgDurationMs, p95DurationMs, peakHour, slowestFlow, totalExecutions, rangeDays } = context;
  return {
    summary: `${totalExecutions} real execution(s) over the last ${rangeDays} day(s), averaging ${avgDurationMs}ms per run (95th percentile ${p95DurationMs}ms).`,
    peakNote: peakHour !== null && peakHour !== undefined ? `Execution volume peaks around ${peakHour}:00.` : "No clear hourly peak in this window.",
    slowestNote: slowestFlow ? `"${slowestFlow.name}" is the slowest flow, averaging ${slowestFlow.avgDurationMs}ms.` : "No flow stands out as unusually slow.",
    advice: p95DurationMs > avgDurationMs * 3
      ? "A small number of runs are far slower than the average — inspect the slowest individual executions rather than the average alone."
      : "Runtimes are fairly consistent across executions.",
  };
}

function renderWorkflowHealthAdvisor(context) {
  const { totalFlows, publishedFlows, avgSuccessRate, worstFlow, cronHealthy, cronTotal } = context;
  return {
    summary: `${publishedFlows} of ${totalFlows} automation flow(s) are published, averaging ${avgSuccessRate}% success across real runs.`,
    worstNote: worstFlow
      ? `"${worstFlow.name}" has the lowest success rate at ${worstFlow.successRate}% (${worstFlow.totalRuns} run(s)).`
      : "No flow has a concerning success rate.",
    cronNote: `${cronHealthy} of ${cronTotal} tracked background job(s) are currently healthy based on their most recent run.`,
    advice: worstFlow && worstFlow.successRate < 50
      ? `Review "${worstFlow.name}" in the Execution Explorer before it runs again — its failure rate is real, not estimated.`
      : "No flow requires immediate attention based on real run history.",
  };
}

function renderRetryAdvisor(context) {
  const { inRetryWindow, deadLetter, maxRetries } = context;
  return {
    summary: `${inRetryWindow} payment(s) are still within their retry window (max ${maxRetries} attempts); ${deadLetter} have exhausted retries and need manual review.`,
    advice: deadLetter
      ? "The retryFailedPayments cron only re-schedules a retry attempt — it does not automatically resolve exhausted payments. Review the dead-letter list below and resolve each after manual verification."
      : "No payment has exhausted its retry attempts right now.",
  };
}

// ── Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform ──
function renderPredictionExplain(context) {
  const { prediction, confidence, reason, supportingMetrics, recommendedAction } = context;
  const metricsLine = Object.entries(supportingMetrics || {})
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : v}`)
    .join(", ");
  return {
    whatIsPredicted: prediction,
    why: `${reason} Confidence: ${confidence}%.`,
    supportingData: metricsLine || "No additional metrics supplied.",
    recommendedNextStep: recommendedAction,
  };
}

function renderAnomalyExplain(context) {
  const { metric, severity, rootCause, evidence, impact, confidence } = context;
  return {
    whatDeviated: `${metric} (${severity} severity, ${confidence}% confidence).`,
    rootCause,
    evidence,
    impact,
  };
}

function renderCapacityAdvisor(context) {
  const entries = Object.entries(context || {}).filter(([, value]) => value && typeof value === "object" && "trendConfidenceR2" in value);
  if (!entries.length) return { summary: "No capacity metrics with a computable trend were available in this forecast window." };

  const lines = entries.map(([key, value]) => {
    const trustLine = value.trendConfidenceR2 < 0.15 ? "trend is too noisy to act on" : `trend confidence r²=${value.trendConfidenceR2}`;
    return `${key}: next-24h≈${value.twentyFourHour}, next-7d≈${value.sevenDay}, next-30d≈${value.thirtyDay} (${trustLine}).`;
  });
  return {
    summary: lines.join(" "),
    deferredNote: (context?.deferredMetrics || []).join(" "),
  };
}

function renderOptimizationAdvisor(context) {
  const { suggestions = [] } = context;
  if (!suggestions.length) return { summary: "No optimization suggestions triggered — no unused, duplicate, expensive, slow, or noisy automation flows detected." };
  const top = suggestions.slice(0, 5);
  return {
    summary: `${suggestions.length} optimization suggestion(s) found. Top priorities: ${top.map((s) => `${s.action} ${s.target?.name || s.target?.names?.join("/") || ""} — ${s.why}`).join(" | ")}`,
  };
}

function renderSelfHealingAdvisor(context) {
  const { queue = [] } = context;
  const pending = queue.filter((q) => q.status === "pending_approval");
  const failed = queue.filter((q) => q.status === "failed");
  return {
    summary: `${pending.length} action(s) awaiting approval, ${failed.length} failed on last attempt.`,
    pendingList: pending.map((q) => `${q.actionKey} (triggered by ${q.trigger})`).join("; ") || "None.",
    failedList: failed.map((q) => `${q.actionKey}: ${q.errorMessage}`).join("; ") || "None.",
  };
}

function renderPlatformIntelligenceSummary(context) {
  const { score, breakdown = {} } = context;
  const urgent = breakdown.criticalPredictions > 0
    ? `${breakdown.criticalPredictions} critical prediction(s)`
    : breakdown.criticalAnomalies > 0
      ? `${breakdown.criticalAnomalies} critical anomaly/anomalies`
      : breakdown.pendingHealingActions > 0
        ? `${breakdown.pendingHealingActions} pending healing action(s)`
        : "nothing urgent right now";
  return {
    summary: `Platform Intelligence Score: ${score}/100. Most urgent: ${urgent}.`,
    breakdown,
  };
}

// ── Phase A6.3.1/A6.3.2 — Enterprise Process Registry & Orchestration Core
// + Cross-System Integration Hub. ────────────────────────────────────────
function renderProcessExplain(context) {
  const { process, health } = context;
  const healthNote = health?.score === null || health?.score === undefined
    ? "no live health signal available"
    : `health score ${health.score}/100 (${health.note || ""})`;
  const deps = (process?.dependencies || []).length ? process.dependencies.join(", ") : "none";
  return {
    summary: `${process?.label}: ${process?.documentation || "no documentation on file"}`.slice(0, 400),
    dependencies: deps,
    health: healthNote,
    impactNote: `Owned by ${process?.owner || "unknown"}; category ${process?.category || "unknown"}.`,
  };
}

function renderIntegrationExplain(context) {
  const { edge } = context;
  return {
    summary: `${edge?.fromLabel} -> ${edge?.toLabel}, discovered via ${edge?.verifiedVia}.`,
    status: edge?.status || "unknown",
    fromHealth: edge?.fromHealth?.score ?? "n/a",
    toHealth: edge?.toHealth?.score ?? "n/a",
  };
}

function renderOrchestrationAdvisor(context) {
  const { plan, integrationHealth = [] } = context;
  const degraded = integrationHealth.filter((e) => e.status === "degraded" || e.status === "at_risk");
  const topConcerns = degraded.slice(0, 3).map((e) => `${e.fromLabel} -> ${e.toLabel} (${e.status})`);
  return {
    summary: topConcerns.length
      ? `${topConcerns.length} integration(s) need attention: ${topConcerns.join("; ")}.`
      : "No degraded or at-risk integrations detected right now.",
    executionMode: plan?.executionMode || "n/a",
    approvalGate: plan?.approvalGate ? "yes" : "no",
  };
}

function renderImpactAnalysis(context) {
  const { impact, trace = [] } = context;
  const impactSummary = impact
    ? `${impact.note} Upstream: ${(impact.upstream || []).join(", ") || "none"}.`
    : "No impact data supplied.";
  const traceSummary = trace.length
    ? `Trace has ${trace.length} real event(s), earliest: ${trace[0]?.label}, latest: ${trace[trace.length - 1]?.label}.`
    : "No trace events supplied.";
  return { summary: `${impactSummary} ${traceSummary}` };
}

// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
function renderProcessDesignExplain(context) {
  const { name, status, version, nodes = [], edges = [], validation, risk } = context;
  const nodeSummary = nodes.map((n) => `${n.type}${n.config?.actionType ? `(${n.config.actionType})` : ""}${n.config?.triggerType ? `(${n.config.triggerType})` : ""}`).join(" -> ");
  const validationNote = validation?.valid ? "currently valid" : `has ${validation?.errors?.length || 0} validation error(s)`;
  return {
    summary: `"${name}" (v${version}, status: ${status}) is ${nodeSummary || "an empty graph"}.`,
    validation: validationNote,
    riskLevel: risk?.level || "unknown",
    riskFactors: risk?.factors || [],
    edgeCount: edges.length,
  };
}

function renderProcessSimulationExplain(context) {
  const { name, status, nodeTrace = [] } = context;
  const failing = nodeTrace.find((n) => n.status === "fail" || n.status === "blocked");
  const summary = failing
    ? `Simulation of "${name}" ended with status "${status}" — node "${failing.nodeId}" (${failing.nodeType}) reported "${failing.status}": ${failing.message}.`
    : `Simulation of "${name}" completed with status "${status}" across ${nodeTrace.length} visited node(s). This was a dry run — no production data was mutated.`;
  return {
    summary,
    nodeCount: nodeTrace.length,
    steps: nodeTrace.map((n) => `${n.nodeId} (${n.nodeType}): ${n.status}`),
  };
}

// Phase A6.3.4 — Process Analytics & Optimization Intelligence. All four
// renderers below receive ONLY server-computed real metrics (see
// process-analytics/processAnalyticsAggregates.js /
// processOptimizationEngine.js) — they format, they never calculate.
function renderProcessAnalyticsExplain(context) {
  const { key, rangeDays, hasData, totalExecutions, successRate, failureRate, avgDurationMs, health } = context;
  if (!hasData) return { summary: `"${key}" has no historical data in the last ${rangeDays} days.` };
  const parts = [
    `FACT: "${key}" ran ${totalExecutions} time(s) in the last ${rangeDays} days with a ${successRate}% success rate (${failureRate}% failure) and an average duration of ${avgDurationMs}ms.`,
  ];
  if (health?.score !== null && health?.score !== undefined) {
    parts.push(`FACT: Health score is ${health.score} (${health.grade}), driven by: ${(health.negativeFactors || []).join("; ") || "no negative factors reported"}.`);
  }
  parts.push(
    health?.score !== null && health?.score < 65
      ? "RECOMMENDATION: Review the Bottleneck Explorer and Optimization Center for this process before its next version publish."
      : "RECOMMENDATION: No urgent action indicated by current data — continue routine monitoring.",
  );
  return { summary: parts.join(" ") };
}

function renderProcessBottleneckExplain(context) {
  const { key, slowestNodes = [], highestFailureNodes = [] } = context;
  const worstFailure = highestFailureNodes[0];
  const worstSlow = slowestNodes[0];
  const parts = [`Bottleneck analysis for "${key}":`];
  if (worstFailure && worstFailure.confidence !== "insufficient") {
    parts.push(`FACT: node "${worstFailure.nodeId}" failed on ${worstFailure.failureRate}% of ${worstFailure.executionCount} executions.`);
  } else if (worstFailure) {
    parts.push(`Node "${worstFailure.nodeId}" shows failures but sample size is insufficient for a confident conclusion.`);
  } else {
    parts.push("No node has a meaningfully elevated failure rate in the supplied data.");
  }
  if (worstSlow && worstSlow.avgDurationMs !== null) {
    parts.push(`FACT: node "${worstSlow.nodeId}" averages ${worstSlow.avgDurationMs}ms, the slowest in this process.`);
  }
  return { summary: parts.join(" ") };
}

function renderProcessOptimizationAdvisor(context) {
  const { recommendations = [] } = context;
  if (!recommendations.length) return { summary: "No optimization recommendations are currently open for this process." };
  const lines = recommendations.map(
    (r) => `FACT: ${r.issue} RECOMMENDATION: ${r.recommendedChange} (severity: ${r.severity}, confidence: ${r.confidence}).`,
  );
  return { summary: lines.join(" "), count: recommendations.length };
}

function renderProcessVersionComparisonExplain(context) {
  const { from, to, comparable, insufficientDataVersions = [], nodeChanges } = context;
  if (!comparable) {
    return { summary: `Cannot draw a reliable conclusion — version(s) ${insufficientDataVersions.join(", ")} have insufficient execution data.` };
  }
  const better = to.successRate >= from.successRate ? "at least as reliable" : "less reliable";
  const parts = [
    `FACT: version ${from.version} had ${from.successRate}% success over ${from.totalExecutions} runs; version ${to.version} has ${to.successRate}% success over ${to.totalExecutions} runs.`,
    `FACT: average duration changed from ${from.avgDurationMs}ms to ${to.avgDurationMs}ms.`,
    `Structurally, ${nodeChanges.added.length} node(s) were added and ${nodeChanges.removed.length} removed.`,
    `RECOMMENDATION: version ${to.version} appears ${better} than version ${from.version} based on this real execution data.`,
  ];
  return { summary: parts.join(" ") };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
// Intelligence. Every renderer below only narrates the real controls/
// evidence the controller supplies (from processGovernanceEngine.js) —
// none of them decide or state an approval outcome the supplied data
// doesn't already contain (Section 16: "AI MUST NOT decide approval").
// ─────────────────────────────────────────────────────────────────────────

function renderGovernanceExplain(context) {
  const { name, status, governance = {}, approval = {} } = context;
  const { riskLevel, approvalRequired, simulationRequired, documentationRequired, segregationRequired, blockers = [], controls = [] } = governance;
  const failed = controls.filter((c) => c.status === "FAIL");

  const parts = [`FACT: "${name}" is at status "${status}" with an effective governance risk tier of ${riskLevel}.`];
  const requirements = [];
  if (approvalRequired) requirements.push("governance approval");
  if (simulationRequired) requirements.push("a completed simulation");
  if (documentationRequired) requirements.push("a written process description");
  if (segregationRequired) requirements.push("an approver distinct from the creator");
  parts.push(requirements.length ? `FACT: at this tier, the policy requires ${requirements.join(", ")}.` : "FACT: no extra governance controls are required at this tier.");

  if (blockers.length) {
    parts.push(`FACT: ${blockers.length} control(s) are currently blocking progress — ${failed.map((c) => c.control).join(", ") || blockers.join(" ")}.`);
    parts.push(`RECOMMENDATION: resolve the above before attempting to publish or approve this process.`);
  } else if (approvalRequired && approval.status !== "approved") {
    parts.push(`FACT: approval status is "${approval.status || "not_required"}".`);
    parts.push("RECOMMENDATION: this process is otherwise clear — the remaining step is a governance approval decision.");
  } else {
    parts.push("RECOMMENDATION: no governance action is currently required for this process.");
  }
  return { summary: parts.join(" ") };
}

function renderApprovalRiskExplain(context) {
  const { name, governance = {}, createdBy, approval = {} } = context;
  const { riskLevel, approvalRequired, segregationRequired } = governance;
  const parts = [`FACT: "${name}" has an effective governance risk tier of ${riskLevel}.`];
  parts.push(
    approvalRequired
      ? `FACT: at the ${riskLevel} tier, this codebase's governance policy requires approval before publish.`
      : `FACT: at the ${riskLevel} tier, this codebase's governance policy does not require approval before publish.`,
  );
  if (segregationRequired) {
    const decidedBy = approval.decidedBy;
    parts.push(
      decidedBy
        ? `FACT: segregation of duties applies at this tier — the approval on record was decided by ${decidedBy}, and the process was created by ${createdBy}.`
        : `FACT: segregation of duties applies at this tier — the approver must not be the same person as the creator (${createdBy}).`,
    );
  }
  return { summary: parts.join(" ") };
}

function renderComplianceSummary(context) {
  const { name, controls = [], riskLevel } = context;
  const pass = controls.filter((c) => c.status === "PASS");
  const fail = controls.filter((c) => c.status === "FAIL");
  const warning = controls.filter((c) => c.status === "WARNING");
  const parts = [
    `FACT: "${name}" (risk tier ${riskLevel}) has ${pass.length} passing control(s), ${fail.length} failing, and ${warning.length} warning(s) out of ${controls.length} evaluated.`,
  ];
  if (fail.length) parts.push(`FACT: failing controls — ${fail.map((c) => `${c.control} (${c.evidence})`).join("; ")}.`);
  if (warning.length) parts.push(`FACT: controls needing attention — ${warning.map((c) => c.control).join(", ")}.`);
  parts.push(
    fail.length
      ? `RECOMMENDATION: address the failing controls above before this process can be considered compliant.`
      : `RECOMMENDATION: no failing controls — review any warnings above at your discretion.`,
  );
  return { summary: parts.join(" ") };
}

function renderChangeImpactExplain(context) {
  const { name, from, to } = context;
  const parts = [`FACT: comparing "${name}" version ${from.version} (status ${from.status}, risk ${from.riskLevel}) to version ${to.version} (status ${to.status}, risk ${to.riskLevel}).`];
  if (from.riskLevel === to.riskLevel) {
    parts.push(`FACT: the risk tier is unchanged between these two versions.`);
    parts.push(`RECOMMENDATION: this change is unlikely to alter the governance approval requirement on its own.`);
  } else {
    const escalated = ["low", "medium", "high", "critical"].indexOf(to.riskLevel) > ["low", "medium", "high", "critical"].indexOf(from.riskLevel);
    parts.push(`FACT: the risk tier ${escalated ? "increased" : "decreased"} from ${from.riskLevel} to ${to.riskLevel}.`);
    parts.push(
      escalated
        ? `RECOMMENDATION: re-check whether governance approval is now required for this process at its new risk tier before publishing.`
        : `RECOMMENDATION: this version carries a lower risk tier than the one it replaces — governance requirements may be reduced, but confirm against current policy.`,
    );
  }
  return { summary: parts.join(" ") };
}

const RENDERERS = {
  automationFlowExplain: renderAutomationFlowExplain,
  automationFlowAdvisor: renderAutomationFlowAdvisor,
  executionExplain: renderExecutionExplain,
  failureExplain: renderFailureExplain,
  performanceAdvisor: renderPerformanceAdvisor,
  workflowHealthAdvisor: renderWorkflowHealthAdvisor,
  retryAdvisor: renderRetryAdvisor,
  workflowExplain: renderWorkflowExplain,
  operationSummary: renderOperationSummary,
  assignmentRecommendation: renderAssignmentRecommendation,
  workloadAdvisor: renderWorkloadAdvisor,
  reassignmentAdvisor: renderReassignmentAdvisor,
  slaAdvisor: renderSlaAdvisor,
  assignmentExplain: renderAssignmentExplain,
  consultationSummary: renderConsultationSummary,
  prescriptionFollowUpSuggestion: renderPrescriptionFollowUpSuggestion,
  scheduleOptimization: renderScheduleOptimization,
  documentCenterSuggestions: renderDocumentCenterSuggestions,
  clinicalNoteDraft: renderClinicalNoteDraft,
  prescriptionExplain: renderPrescriptionExplain,
  documentSummary: renderDocumentSummary,
  appointmentPrep: renderAppointmentPrep,
  communicationDraft: renderCommunicationDraft,
  executiveBrief: renderExecutiveBrief,
  metricExplain: renderMetricExplain,
  workflowSuggestions: renderWorkflowSuggestions,
  reviewSentiment: renderReviewSentiment,
  paymentExplain: renderPaymentExplain,
  invoiceExplain: renderInvoiceExplain,
  refundAssistant: renderRefundAssistant,
  expenseSummary: renderExpenseSummary,
  familyHealthInsights: renderFamilyHealthInsights,
  insuranceExplain: renderInsuranceExplain,
  insuranceEligibilitySummary: renderInsuranceEligibilitySummary,
  healthProfileReview: renderHealthProfileReview,
  healthJourneySummary: renderHealthJourneySummary,
  patientClinicalBrief: renderPatientClinicalBrief,
  revenueInsights: renderRevenueInsights,
  reputationAdvisor: renderReputationAdvisor,
  businessAdvisor: renderBusinessAdvisor,
  profileReview: renderProfileReview,
  verificationAdvisor: renderVerificationAdvisor,
  subscriptionAdvisor: renderSubscriptionAdvisor,
  growthAdvisor: renderGrowthAdvisor,
  missingFieldsAdvisor: renderMissingFieldsAdvisor,
  consultationAssistant: renderConsultationAssistant,
  patientEducationSummary: renderPatientEducationSummary,
  predictionExplain: renderPredictionExplain,
  anomalyExplain: renderAnomalyExplain,
  capacityAdvisor: renderCapacityAdvisor,
  optimizationAdvisor: renderOptimizationAdvisor,
  selfHealingAdvisor: renderSelfHealingAdvisor,
  platformIntelligenceSummary: renderPlatformIntelligenceSummary,
  processExplain: renderProcessExplain,
  integrationExplain: renderIntegrationExplain,
  orchestrationAdvisor: renderOrchestrationAdvisor,
  impactAnalysis: renderImpactAnalysis,
  processDesignExplain: renderProcessDesignExplain,
  processSimulationExplain: renderProcessSimulationExplain,
  processAnalyticsExplain: renderProcessAnalyticsExplain,
  processBottleneckExplain: renderProcessBottleneckExplain,
  processOptimizationAdvisor: renderProcessOptimizationAdvisor,
  processVersionComparisonExplain: renderProcessVersionComparisonExplain,
  governanceExplain: renderGovernanceExplain,
  approvalRiskExplain: renderApprovalRiskExplain,
  complianceSummary: renderComplianceSummary,
  changeImpactExplain: renderChangeImpactExplain,
  patientOperationalSummary: renderPatientOperationalSummary,
  financeExecutiveSummary: renderFinanceExecutiveSummary,
  commandCenterExecutiveSummary: renderCommandCenterExecutiveSummary,
};

// PHASE UI-4 — Patients Management Workspace. Renders the admin-facing
// operational brief with FACTS and RECOMMENDATIONS kept in explicitly
// separate arrays (not interleaved prose) per the mission's requirement
// that FACT be visibly distinguishable from AI INTERPRETATION/
// RECOMMENDATION. Every fact line is a direct restatement of a supplied
// field; every recommendation is operational (never clinical) and only
// fires off a real, already-computed attention item — nothing here infers
// a new attention condition on its own.
function renderPatientOperationalSummary(context) {
  const {
    patientName,
    appointmentCount,
    lastVisit,
    nextVisit,
    riskLevel,
    outstandingAmount,
    canViewFinance,
    hasInsurance,
    expiringInsuranceCount,
    expiredInsuranceCount,
    unreviewedCriticalReportsCount,
    attentionItems = [],
  } = context;

  const facts = [
    `${patientName || "This patient"} has ${appointmentCount || 0} appointment(s) on file, last visit ${fmtDate(lastVisit)}${nextVisit ? `, next visit ${fmtDate(nextVisit)}` : ", with no upcoming visit scheduled"}.`,
    `Deterministic risk level on file: ${riskLevel || "low"}.`,
  ];

  if (canViewFinance) {
    facts.push(
      outstandingAmount > 0
        ? `Outstanding balance of ₹${outstandingAmount}.`
        : "No outstanding balance on file.",
    );
  } else {
    facts.push("Financial detail is restricted for this admin account.");
  }

  facts.push(
    hasInsurance
      ? `Insurance on file${expiringInsuranceCount ? ` (${expiringInsuranceCount} policy/ies expiring within 30 days)` : ""}${expiredInsuranceCount ? `, ${expiredInsuranceCount} expired` : ""}.`
      : "No insurance policy on file.",
  );

  if (unreviewedCriticalReportsCount) {
    facts.push(`${unreviewedCriticalReportsCount} urgent/critical report(s) awaiting doctor review.`);
  }

  const recommendations = attentionItems.length
    ? attentionItems
        .filter((item) => item.action)
        .map((item) => item.action)
    : [];

  if (!recommendations.length) {
    recommendations.push(
      attentionItems.length
        ? "Review the attention items above; no specific operational action was flagged beyond monitoring."
        : "No open attention items — routine monitoring is sufficient.",
    );
  }

  return { facts, recommendations };
}

// PHASE UI-7 — Finance Executive Command Center. Renders a short
// FACT-then-RECOMMENDATION brief strictly from the real, already-computed
// finance overview/health/attention aggregates supplied by
// financeAdminController.js. Never invents a number, cause, or fraud
// claim — every fact line is a direct restatement of a supplied field.
function renderFinanceExecutiveSummary(context) {
  const { overview = {}, health = {}, attentionCounts = {}, totalAttentionItems = 0 } = context;

  const facts = [
    `Gross revenue is ₹${overview.grossRevenue || 0} with net revenue of ₹${overview.netRevenue || 0} after ₹${overview.refundedAmount || 0} in refunds.`,
    `Outstanding (uncompleted checkout) amount is ₹${overview.outstandingAmount || 0} across ${overview.outstandingCount || 0} payments; failed payments total ₹${overview.failedAmount || 0} across ${overview.failedCount || 0} payments.`,
    `Total invoiced value on file is ₹${overview.invoiceValue || 0} across ${overview.invoiceCount || 0} invoices.`,
  ];

  if (health.score === null || health.score === undefined) {
    facts.push(health.reason || "Financial health score is unavailable — insufficient data.");
  } else {
    facts.push(`Financial health score is ${health.score}/100, computed from ${health.factors?.length || 0} documented factors.`);
  }

  facts.push(
    `${totalAttentionItems} item(s) currently need attention: ${attentionCounts.payments || 0} payment(s), ${attentionCounts.refunds || 0} refund(s), ${attentionCounts.reconciliation || 0} reconciliation issue(s).`,
  );

  const recommendations = [];
  if ((attentionCounts.reconciliation || 0) > 0) {
    recommendations.push("Resolve the reconciliation issues first — these are real data-integrity gaps, not routine operational items.");
  }
  if ((attentionCounts.payments || 0) > 0) {
    recommendations.push(`Review the ${attentionCounts.payments} payment(s) needing attention in the Payments workspace.`);
  }
  if ((attentionCounts.refunds || 0) > 0) {
    recommendations.push(`Review the ${attentionCounts.refunds} refund(s) needing attention in the Refunds workspace.`);
  }
  if (!recommendations.length) {
    recommendations.push("No open attention items — routine monitoring is sufficient.");
  }

  return { facts, recommendations };
}

// PHASE UI-9 — Executive Admin Command Center. Same FACT/RECOMMENDATION
// discipline as renderFinanceExecutiveSummary/renderComplianceSummary
// above — every line traces to a field the caller actually supplied.
function renderCommandCenterExecutiveSummary(context) {
  const { executive = {}, needsAttention = {}, finance, reputation, workflow, governance } = context;

  const facts = [];
  const recommendations = [];
  const risks = [];

  facts.push(
    `Platform health score is ${executive.platformHealth?.score ?? "unavailable"}${executive.platformHealth?.score != null ? "/100" : ""}.`,
  );
  facts.push(
    `Revenue today is ₹${executive.revenue?.today || 0}; ${executive.appointments?.today || 0} appointments today with ${executive.appointments?.pending || 0} pending.`,
  );

  const whatChanged = [];
  if (executive.growth?.patientsWeekOverWeek != null) {
    whatChanged.push(`FACT: patient signups are ${executive.growth.patientsWeekOverWeek >= 0 ? "up" : "down"} ${Math.abs(executive.growth.patientsWeekOverWeek)}% week-over-week.`);
  }
  if (executive.growth?.doctorsWeekOverWeek != null) {
    whatChanged.push(`FACT: doctor signups are ${executive.growth.doctorsWeekOverWeek >= 0 ? "up" : "down"} ${Math.abs(executive.growth.doctorsWeekOverWeek)}% week-over-week.`);
  }
  if (!whatChanged.length) whatChanged.push("FACT: no week-over-week comparison data is available yet.");

  const attentionCounts = needsAttention.counts || {};
  facts.push(`${attentionCounts.total || 0} open operational item(s) need attention: ${attentionCounts.critical || 0} critical, ${attentionCounts.high || 0} high priority, ${attentionCounts.overdue || 0} past SLA.`);
  if ((attentionCounts.critical || 0) > 0) {
    recommendations.push(`RECOMMENDATION: resolve the ${attentionCounts.critical} critical operational item(s) first — open the Operations Queue.`);
    risks.push(`RISK: ${attentionCounts.critical} critical item(s) are currently unresolved.`);
  }
  if ((attentionCounts.unassigned || 0) > 0) {
    recommendations.push(`RECOMMENDATION: assign the ${attentionCounts.unassigned} unassigned open item(s) via Smart Assignment.`);
  }

  if (finance) {
    facts.push(`FACT: net revenue is ₹${finance.overview?.netRevenue || 0}; financial health score is ${finance.health?.score ?? "unavailable"}${finance.health?.score != null ? "/100" : ""}.`);
    const financeAttentionTotal = (finance.attentionCounts?.payments || 0) + (finance.attentionCounts?.refunds || 0) + (finance.attentionCounts?.reconciliation || 0);
    if (financeAttentionTotal > 0) recommendations.push(`RECOMMENDATION: review ${financeAttentionTotal} finance item(s) needing attention in the Finance Command Center.`);
  } else {
    facts.push("FACT: finance data is unavailable for this summary (not permitted or currently unreachable).");
  }

  if (reputation) {
    facts.push(`FACT: average platform rating is ${reputation.averageRating ?? "unavailable"} across ${reputation.totalReviews} review(s); ${reputation.doctorsNeedingAttention?.length || 0} doctor(s) have reviews needing attention.`);
    if (reputation.doctorsNeedingAttention?.length) {
      recommendations.push(`RECOMMENDATION: review reputation for ${reputation.doctorsNeedingAttention.length} doctor(s) with unresolved negative or unreplied reviews.`);
    }
  } else {
    facts.push("FACT: reputation data is unavailable for this summary.");
  }

  if (workflow) {
    facts.push(`FACT: ${workflow.failedExecutionsToday || 0} automation execution(s) failed today; ${workflow.slaBreaches || 0} operation(s) are past SLA; ${workflow.assignmentConflicts || 0} assignment conflict(s) detected.`);
    if ((workflow.slaBreaches || 0) > 0) risks.push(`RISK: ${workflow.slaBreaches} operation(s) are past their SLA target.`);
  } else {
    facts.push("FACT: workflow/automation health is unavailable for this summary (not permitted or currently unreachable).");
  }

  if (governance) {
    facts.push(`FACT: governance status is "${governance.governanceHealth}" across ${governance.kpis?.governedProcesses || 0} governed process(es), with ${governance.kpis?.pendingApproval || 0} pending approval and ${governance.kpis?.governanceViolations || 0} violation(s).`);
    if ((governance.kpis?.governanceViolations || 0) > 0) risks.push(`RISK: ${governance.kpis.governanceViolations} governance violation(s) on active/published processes.`);
  }

  if (!recommendations.length) recommendations.push("RECOMMENDATION: no urgent action identified from the supplied data — routine monitoring is sufficient.");
  if (!risks.length) risks.push("RISK / OPPORTUNITY: no elevated risk identified from the supplied data.");

  return {
    executiveSummary: `FACT: ${facts[0]} FACT: ${facts[1]}`,
    whatChanged,
    whatNeedsAttention: facts.slice(2).map((f) => (f.startsWith("FACT") ? f : `FACT: ${f}`)),
    recommendedActions: recommendations,
    riskOpportunity: risks,
  };
}

export const templateProvider = {
  name: "hms-template-engine",
  async generate({ promptKey, context }) {
    const renderer = RENDERERS[promptKey];
    if (!renderer) throw new Error(`No template renderer registered for promptKey: ${promptKey}`);
    return renderer(context || {});
  },
};
