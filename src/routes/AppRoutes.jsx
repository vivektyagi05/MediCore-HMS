import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "../layout/MainLayout";
import DashboardLayout from "../layout/DashboardLayout";
import Loader from "../components/ui/Loader";
import PrivateRoute from "./PrivateRoute";

const Home = lazy(() => import("../pages/public/Home"));
const About = lazy(() => import("../pages/public/About"));
const Contact = lazy(() => import("../pages/public/Contact"));
const Login = lazy(() => import("../pages/auth/Login"));
const Register = lazy(() => import("../pages/auth/Register"));
const ChatWorkspace = lazy(() => import("../pages/chat/ChatWorkspace"));
const AdminAIInsights = lazy(() => import("../pages/ai/AdminAIInsights"));
const PatientAIAssistant = lazy(() => import("../pages/ai/PatientAIAssistant"));
const AdminServices = lazy(() => import("../pages/admin/AdminServices"));
const AdminSettings = lazy(() => import("../pages/admin/AdminSettings"));
const AdminDashboard = lazy(() => import("../pages/dashboard/AdminDashboard"));
const DoctorDashboard = lazy(() => import("../pages/dashboard/DoctorDashboard"));
const PatientDashboard = lazy(() => import("../pages/dashboard/PatientDashboard"));
const PatientDoctors = lazy(() => import("../pages/patient/PatientDoctors"));
const PatientFamily = lazy(() => import("../pages/patient/PatientFamily"));
const PatientInsurance = lazy(() => import("../pages/patient/PatientInsurance"));
const PatientProfile = lazy(() => import("../pages/patient/PatientProfile"));
const PatientRecords = lazy(() => import("../pages/patient/PatientRecords"));
const DoctorAnalytics = lazy(() => import("../pages/doctor/DoctorAnalytics"));
const DoctorClinicalWorkspace = lazy(() => import("../pages/doctor/DoctorClinicalWorkspace"));
const DoctorDocuments = lazy(() => import("../pages/doctor/DoctorDocuments"));
const DoctorSchedule = lazy(() => import("../pages/doctor/DoctorSchedule"));
const DoctorPatients = lazy(
  () => import("../pages/doctor/DoctorPatients")
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
const InvoicePreview = lazy(() => import("../pages/invoice/InvoicePreview"));
const FinanceHistory = lazy(() => import("../pages/finance/FinanceHistory"));
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
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
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
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="finance" element={<AdminFinanceDashboard />} />
          <Route path="finance/ops" element={<FinanceHistory />} />
          <Route path="invoices" element={<InvoiceHistory />} />
          <Route path="ai" element={<AdminAIInsights />} />
          <Route path="services" element={<AdminServices />} />
          <Route path="settings" element={<AdminSettings />} />
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
      path="patients"
      element={<DoctorPatients />}
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

  </Route>
</Route>

      <Route element={<PrivateRoute allowedRoles={["patient"]} />}>
        <Route path="/patient" element={<DashboardLayout />}>

          <Route index element={<Navigate to="/patient/dashboard" replace />} />

          <Route path="dashboard" element={<PatientDashboard />} />

          <Route path="wallet" element={<WalletDashboard />} />

          <Route path="appointments" element={<PatientAppointments />} />

          <Route path="payments" element={<PatientPayments />} />

          <Route path="payments/:appointmentId" element={<PaymentCheckout />} />

          <Route path="invoices" element={<InvoiceHistory />} />

          <Route path="records" element={<PatientRecords />} />

          <Route path="family" element={<PatientFamily />} />

          <Route path="insurance" element={<PatientInsurance />} />

          <Route path="doctors" element={<PatientDoctorsDirectory />}/>

          <Route path="saved-doctors" element={<PatientDoctors />}/>

          <Route path="profile" element={<PatientProfile />} />

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
