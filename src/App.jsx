import { useLocation } from "react-router-dom";
import AppErrorBoundary from "./components/shared/AppErrorBoundary";
import AppRoutes from "./routes/AppRoutes";

function App() {
  const location = useLocation();
  // resetKey: navigating away from a crashed page clears the error screen
  return (
    <AppErrorBoundary resetKey={location.pathname}>
      <AppRoutes />
    </AppErrorBoundary>
  );
}

export default App;
