import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "../layout/MainLayout";
import DashboardLayout from "../layout/DashboardLayout";
import Loader from "../components/ui/Loader";
import PrivateRoute from "./PrivateRoute";

const Home = lazy(() => import("../pages/public/Home"));
const About = lazy(() => import("../pages/public/About"));
const Contact = lazy(() => import("../pages/public/Contact"));
const DoctorSearch = lazy(() => import("../pages/public/DoctorSearch"));
const DoctorProfile = lazy(() => import("../pages/public/DoctorProfile"));
const DoctorCompare = lazy(() => import("../pages/public/DoctorCompare"));
const Services = lazy(() => import("../pages/public/Services"));
const ServiceDetail = lazy(() => import("../pages/public/ServiceDetail"));
const Articles = lazy(() => import("../pages/public/Articles"));
const ArticleDetail = lazy(() => import("../pages/public/ArticleDetail"));
const DoctorReputationCenter = lazy(() => import("../pages/doctor/DoctorReputationCenter"));
const DoctorBusinessOverview = lazy(() => import("../pages/doctor/DoctorBusinessOverview"));
const DoctorProfileStrength = lazy(() => import("../pages/doctor/DoctorProfileStrength"));
const DoctorPracticeOverview = lazy(() => import("../pages/doctor/DoctorPracticeOverview"));
const DoctorProfessionalProfile = lazy(() => import("../pages/doctor/DoctorProfessionalProfile"));
const DoctorVerificationCenter = lazy(() => import("../pages/doctor/DoctorVerificationCenter"));
const DoctorPracticeSettings = lazy(() => import("../pages/doctor/DoctorPracticeSettings"));
const Login = lazy(() => import("../pages/auth/Login"));
const Register = lazy(() => import("../pages/auth/Register"));
const ForgotPassword = lazy(() => import("../pages/auth/ForgotPassword"));
const VerifyOtp = lazy(() => import("../pages/auth/VerifyOtp"));
const ResetPassword = lazy(() => import("../pages/auth/ResetPassword"));
const LegalDocumentPage = lazy(() => import("../components/legal/LegalDocumentPage"));
const PrivacyPreferences = lazy(() => import("../pages/public/PrivacyPreferences"));
const DataRights = lazy(() => import("../pages/public/DataRights"));
const ChatWorkspace = lazy(() => import("../pages/chat/ChatWorkspace"));
const AdminAIInsights = lazy(() => import("../pages/ai/AdminAIInsights"));
const PatientAIAssistant = lazy(() => import("../pages/ai/PatientAIAssistant"));
const AdminServices = lazy(() => import("../pages/admin/AdminServices"));
const AdminArticles = lazy(() => import("../pages/admin/AdminArticles"));
const AdminSettings = lazy(() => import("../pages/admin/AdminSettings"));
const AdminDashboard = lazy(() => import("../pages/dashboard/AdminDashboard"));
const DoctorDashboard = lazy(() => import("../pages/dashboard/DoctorDashboard"));
const PatientDashboard = lazy(() => import("../pages/dashboard/PatientDashboard"));
const PatientDoctors = lazy(() => import("../pages/patient/PatientDoctors"));
const PatientFamily = lazy(() => import("../pages/patient/PatientFamily"));
const PatientInsurance = lazy(() => import("../pages/patient/PatientInsurance"));
const PatientProfile = lazy(() => import("../pages/patient/PatientProfile"));
const PatientRecords = lazy(() => import("../pages/patient/PatientRecords"));
const HealthJourney = lazy(() => import("../pages/patient/HealthJourney"));
const DoctorAnalytics = lazy(() => import("../pages/doctor/DoctorAnalytics"));
const DoctorClinicalWorkspace = lazy(() => import("../pages/doctor/DoctorClinicalWorkspace"));
const DoctorSmartInbox = lazy(() => import("../pages/doctor/DoctorSmartInbox"));
const DoctorDocuments = lazy(() => import("../pages/doctor/DoctorDocuments"));
const DoctorSchedule = lazy(() => import("../pages/doctor/DoctorSchedule"));
const DoctorPatients = lazy(
  () => import("../pages/doctor/DoctorPatients")
);
const DoctorPatientProfile = lazy(
  () => import("../pages/doctor/DoctorPatientProfile")
);
const DoctorAppointments = lazy(
  () => import("../pages/doctor/DoctorAppointments")
);
const PatientAppointments = lazy(
  () =>
    import(
      "../pages/patient/PatientAppointments"
    )
);
const AppointmentDetail = lazy(() => import("../pages/patient/AppointmentDetail"));

const BookAppointment = lazy(
  () => import("../pages/patient/BookAppointment")
);
const PatientPayments = lazy(
  () => import("../pages/patient/PatientPayments")
);
const PatientDoctorsDirectory = lazy(
  () => import("../pages/patient/PatientDoctorsDirectory")
);
const AdminDoctors = lazy(
  () => import("../pages/admin/AdminDoctors")
);
const DoctorOnboarding = lazy(
  () =>
    import(
      "../pages/doctor/DoctorOnboarding"
    )
);
const AdminPatients = lazy(
  () => import("../pages/admin/AdminPatients")
);
const AdminAppointments = lazy(
  () =>
    import(
      "../pages/admin/AdminAppointments"
    )
);
const AdminPayments = lazy(
  () => import("../pages/admin/AdminPayments")
);
const AdminRefunds = lazy(
  () => import("../pages/admin/AdminRefunds")
);
const AdminWithdrawals = lazy(
  () => import("../pages/admin/AdminWithdrawals")
);
// PHASE UI-7 — admin-only Invoice Operations Workspace and Finance
// Operations (Collections/Reconciliation) pages. Patient-facing
// InvoiceHistory.jsx (imported below, unchanged) still serves
// /patient/invoices.
const AdminInvoices = lazy(() => import("../pages/admin/AdminInvoices"));
const FinanceOperations = lazy(() => import("../pages/finance/FinanceOperations"));
const AdminAudit = lazy(() => import("../pages/admin/AdminAudit"));
const AdminNotifications = lazy(() => import("../pages/admin/AdminNotifications"));
const AdminAnalytics = lazy(() => import("../pages/admin/AdminAnalytics"));
const AdminMissionControl = lazy(() => import("../pages/admin/AdminMissionControl"));
const AdminPlatformHealth = lazy(() => import("../pages/admin/AdminPlatformHealth"));
const AdminOperationsCenter = lazy(() => import("../pages/admin/AdminOperationsCenter"));
const AdminOperationsCommandWorkspace = lazy(() => import("../pages/admin/AdminOperationsCommandWorkspace"));
const AdminWorkflowEngine = lazy(() => import("../pages/admin/AdminWorkflowEngine"));
const AdminSmartAssignment = lazy(() => import("../pages/admin/AdminSmartAssignment"));
const AdminAutomationStudio = lazy(() => import("../pages/admin/AdminAutomationStudio"));
const AdminMonitoringPlatform = lazy(() => import("../pages/admin/AdminMonitoringPlatform"));
const AdminWorkflowIntelligence = lazy(() => import("../pages/admin/AdminWorkflowIntelligence"));
const AdminProcessOrchestrator = lazy(() => import("../pages/admin/AdminProcessOrchestrator"));
const AdminProcessDesigner = lazy(() => import("../pages/admin/AdminProcessDesigner"));
const AdminProcessAnalytics = lazy(() => import("../pages/admin/AdminProcessAnalytics"));
const AdminProcessGovernance = lazy(() => import("../pages/admin/AdminProcessGovernance"));
const AdminProcessCommandCenter = lazy(() => import("../pages/admin/AdminProcessCommandCenter"));
const AdminIntegrationHub = lazy(() => import("../pages/admin/AdminIntegrationHub"));
const AdminSmartWidgets = lazy(() => import("../pages/admin/AdminSmartWidgets"));
const AdminExecutiveActionCenter = lazy(() => import("../pages/admin/AdminExecutiveActionCenter"));
const AdminUserManagement = lazy(() => import("../pages/admin/AdminUserManagement"));
const AdminAccessControl = lazy(() => import("../pages/admin/AdminAccessControl"));
const AdminFeatureManagement = lazy(() => import("../pages/admin/AdminFeatureManagement"));
const AdminExportCenter = lazy(() => import("../pages/admin/AdminExportCenter"));
const AdminCMS = lazy(() => import("../pages/admin/AdminCMS"));
const DoctorReviews =
lazy(
 () =>
 import(
 "../pages/doctor/DoctorReviews"
 )
);
const AdminReviews = lazy(
 () =>
 import(
  "../pages/admin/AdminReviews"
 )
);
const AdminLeads = lazy(() => import("../pages/admin/AdminLeads"));
const DoctorEarnings =
lazy(
()=>import(
"../pages/doctor/DoctorEarnings"
)
);
const InvoicePreview = lazy(() => import("../pages/invoice/InvoicePreview"));
const InvoiceHistory = lazy(() => import("../pages/finance/InvoiceHistory"));
const SubscriptionBilling = lazy(() => import("../pages/finance/SubscriptionBilling"));
const AdminFinanceDashboard = lazy(() => import("../pages/payment/AdminFinanceDashboard"));
const PaymentCheckout = lazy(() => import("../pages/payment/PaymentCheckout"));
const WalletDashboard = lazy(() => import("../pages/payment/WalletDashboard"));

function AppRoutes() {
  return (
    <Suspense fallback={<div className="p-6"><Loader label="Loading workspace" /></div>}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/doctors" element={<DoctorSearch />} />
          <Route path="/doctors/compare" element={<DoctorCompare />} />
          <Route path="/doctors/:id" element={<DoctorProfile />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/:slug" element={<ServiceDetail />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/articles/:slug" element={<ArticleDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/verify-otp" element={<VerifyOtp />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/privacy-policy" element={<LegalDocumentPage documentKey="privacy" />} />
          <Route path="/terms" element={<LegalDocumentPage documentKey="terms" />} />
          <Route path="/medical-disclaimer" element={<LegalDocumentPage documentKey="medicalDisclaimer" />} />
          <Route path="/cookie-policy" element={<LegalDocumentPage documentKey="cookie" />} />
          <Route path="/privacy-preferences" element={<PrivacyPreferences />} />
          <Route path="/data-rights" element={<DataRights />} />
        </Route>

      <Route element={<PrivateRoute allowedRoles={["admin", "super_admin"]} />}>
        <Route path="/admin" element={<DashboardLayout />}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route
            path="doctors"
            element={<AdminDoctors />}
          />
          <Route
            path="patients"
            element={<AdminPatients />}
          />
          <Route
            path="appointments"
            element={
              <AdminAppointments />
            }
          />
          <Route
            path="payments"
            element={<AdminPayments />}
          />
          
          <Route
            path="refunds"
            element={<AdminRefunds />}
          />
          <Route
            path="withdrawals"
            element={<AdminWithdrawals />}
          />
          <Route
          path="reviews"
          element={
            <AdminReviews />
          }
          />
          <Route path="leads" element={<AdminLeads />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="mission-control" element={<AdminMissionControl />} />
          <Route path="platform-health" element={<AdminPlatformHealth />} />
          <Route path="operations-center" element={<AdminOperationsCenter />} />
          <Route path="operations-command-workspace" element={<AdminOperationsCommandWorkspace />} />
          <Route path="workflow-engine" element={<AdminWorkflowEngine />} />
          <Route path="smart-assignment" element={<AdminSmartAssignment />} />
          <Route path="automation-studio" element={<AdminAutomationStudio />} />
          <Route path="monitoring" element={<AdminMonitoringPlatform />} />
          <Route path="workflow-intelligence" element={<AdminWorkflowIntelligence />} />
          <Route path="process-orchestrator" element={<AdminProcessOrchestrator />} />
          <Route path="process-designer" element={<AdminProcessDesigner />} />
          <Route path="process-analytics" element={<AdminProcessAnalytics />} />
          <Route path="process-governance" element={<AdminProcessGovernance />} />
          <Route path="process-command-center" element={<AdminProcessCommandCenter />} />
          <Route path="integration-hub" element={<AdminIntegrationHub />} />
          <Route path="widgets" element={<AdminSmartWidgets />} />
          <Route path="executive-actions" element={<AdminExecutiveActionCenter />} />
          <Route path="user-management" element={<AdminUserManagement />} />
          <Route path="access-control" element={<AdminAccessControl />} />
          <Route path="feature-management" element={<AdminFeatureManagement />} />
          <Route path="export-center" element={<AdminExportCenter />} />
          <Route path="finance" element={<AdminFinanceDashboard />} />
          <Route path="finance/ops" element={<FinanceOperations />} />
          <Route path="invoices" element={<AdminInvoices />} />
          <Route path="ai" element={<AdminAIInsights />} />
          <Route path="services" element={<AdminServices />} />
          <Route path="articles" element={<AdminArticles />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="audit" element={<AdminAudit />} />
          <Route path="notifications" element={<AdminNotifications />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="cms" element={<AdminCMS />} />
        </Route>
      </Route>

      <Route element={<PrivateRoute allowedRoles={["doctor"]} />}>
  <Route path="/doctor" element={<DashboardLayout />}>

    <Route
      index
      element={<Navigate to="/doctor/dashboard" replace />}
    />

    <Route
      path="onboarding"
      element={<DoctorOnboarding />}
    />

    <Route
      path="dashboard"
      element={<DoctorDashboard />}
    />

    <Route
      path="inbox"
      element={<DoctorSmartInbox />}
    />

    <Route
      path="patients"
      element={<DoctorPatients />}
    />

    <Route
      path="patients/:patientId"
      element={<DoctorPatientProfile />}
    />

    <Route
      path="appointments"
      element={<DoctorAppointments />}
    />

    <Route
      path="clinical"
      element={<DoctorClinicalWorkspace />}
    />

    <Route
      path="earnings"
      element={
        <DoctorEarnings/>
      }
      />

    <Route
      path="schedule"
      element={<DoctorSchedule />}
    />

    <Route
      path="documents"
      element={<DoctorDocuments />}
    />

    <Route
      path="analytics"
      element={<DoctorAnalytics />}
    />

    <Route
      path="billing"
      element={<SubscriptionBilling />}
    />

    <Route
      path="reviews"
      element={
        <DoctorReviews />
      }
    />

    <Route
      path="reputation"
      element={<DoctorReputationCenter />}
    />

    <Route
      path="business"
      element={<DoctorBusinessOverview />}
    />

    <Route
      path="profile-strength"
      element={<DoctorProfileStrength />}
    />

    <Route
      path="practice"
      element={<DoctorPracticeOverview />}
    />

    <Route
      path="profile/edit"
      element={<DoctorProfessionalProfile />}
    />

    <Route
      path="verification"
      element={<DoctorVerificationCenter />}
    />

    <Route
      path="practice-settings"
      element={<DoctorPracticeSettings />}
    />

  </Route>
</Route>

      <Route element={<PrivateRoute allowedRoles={["patient"]} />}>
        <Route path="/patient" element={<DashboardLayout />}>

          <Route index element={<Navigate to="/patient/dashboard" replace />} />

          <Route path="dashboard" element={<PatientDashboard />} />

          <Route path="wallet" element={<WalletDashboard />} />

          <Route path="appointments" element={<PatientAppointments />} />

          <Route path="appointments/:id" element={<AppointmentDetail />} />

          <Route path="appointments/book" element={<BookAppointment />} />

          <Route path="payments" element={<PatientPayments />} />

          <Route path="payments/:appointmentId" element={<PaymentCheckout />} />

          <Route path="invoices" element={<InvoiceHistory />} />

          <Route path="records" element={<PatientRecords />} />

          <Route path="family" element={<PatientFamily />} />

          <Route path="insurance" element={<PatientInsurance />} />

          <Route path="doctors" element={<PatientDoctorsDirectory />}/>

          <Route path="saved-doctors" element={<PatientDoctors />}/>

          <Route path="profile" element={<PatientProfile />} />

          <Route path="journey" element={<HealthJourney />} />

          <Route path="ai" element={<PatientAIAssistant />} />

        </Route>
      </Route>

      <Route element={<PrivateRoute allowedRoles={["admin", "super_admin", "patient"]} />}>
        <Route element={<DashboardLayout />}>
          <Route path="/invoices/:invoiceId" element={<InvoicePreview />} />
        </Route>
      </Route>

      <Route element={<PrivateRoute allowedRoles={["admin", "super_admin", "doctor", "patient"]} />}>
        <Route element={<DashboardLayout />}>
          <Route path="/chat/:userId" element={<ChatWorkspace />} />
        </Route>
      </Route>

      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
      </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default AppRoutes;
