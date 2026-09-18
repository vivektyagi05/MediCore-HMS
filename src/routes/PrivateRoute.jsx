import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import Button from "../components/ui/Button";
import Loader from "../components/ui/Loader";

function Unauthorized() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="glass-card max-w-lg rounded-shell p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-control bg-navy-950 text-white shadow-sm">
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
  // PHASE 2-A — Part 2/3 (session restoration): read `user` from the
  // AuthContext state rather than re-parsing localStorage directly, so a
  // freshly-verified /auth/me response (see AuthContext.refreshUser)
  // actually reaches this routing decision instead of a snapshot frozen at
  // last login. `initializing` covers the brief window on page
  // load/browser restart while that verification is still in flight — a
  // stale cached doctorOnboardingStatus must never make a routing decision
  // before the real one is known.
  const { isAuthenticated, role, user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <Loader label="Restoring your session..." />;
  }

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
