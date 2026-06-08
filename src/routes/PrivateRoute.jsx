import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";

function Unauthorized() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="glass-card max-w-lg rounded-2xl p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
          <ShieldAlert size={24} />
        </div>
        <h1 className="text-2xl font-black text-slate-950">Unauthorized access</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your current role does not have permission to view this workspace.
        </p>
        <Button to="/" className="mt-6">Return Home</Button>
      </div>
    </div>
  );
}

function PrivateRoute({ allowedRoles }) {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();
  const user = JSON.parse(
      localStorage.getItem("hms_user") || "{}"
    );

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowedRoles?.length && !allowedRoles.includes(role)) {
    return <Unauthorized />;
  }

  if (
      role === "doctor" &&
      location.pathname !==
        "/doctor/onboarding" &&
      user.doctorOnboardingStatus !==
        "approved"
    ) {
      return (
        <Navigate
          to="/doctor/onboarding"
          replace
        />
      );
    }

    return <Outlet />;
}

export default PrivateRoute;
