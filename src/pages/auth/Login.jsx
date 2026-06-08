import { LockKeyhole, Mail } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import { roleDashboardPath, useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

const initialForm = {
  email: "",
  password: "",
};

function validateForm(form) {
  const errors = {};

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = "Enter a valid email address";
  }

  if (!form.password) {
    errors.password = "Password is required";
  }

  return errors;
}

function Login() {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, isAuthenticated, role } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  if (isAuthenticated) {
    return <Navigate to={roleDashboardPath(role)} replace />;
  }

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setServerError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationErrors = validateForm(form);

    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setServerError("");

    try {
      const user = await login(form);
      toast.success("Login successful");
      navigate(location.state?.from?.pathname || roleDashboardPath(user.role), {
        replace: true,
      });
    } catch (error) {
      const message = getApiErrorMessage(error);
      setServerError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="flex min-h-[calc(100vh-81px)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
            <LockKeyhole size={24} />
          </div>
          <h1 className="text-3xl font-black text-slate-950">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-600">Sign in to continue to your HMS workspace.</p>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Input
            label="Email"
            name="email"
            type="email"
            placeholder="admin@hmspro.com"
            value={form.email}
            onChange={updateField}
            error={errors.email}
          />
          <Input
            label="Password"
            name="password"
            type="password"
            placeholder="Minimum 8 characters"
            value={form.password}
            onChange={updateField}
            error={errors.password}
          />
          {serverError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {serverError}
            </div>
          )}
          <Button type="submit" className="mt-2 w-full" isLoading={isSubmitting}>
            <Mail size={18} /> Login
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          New to HMS Pro?{" "}
          <Link className="font-bold text-blue-600 hover:text-blue-700" to="/register">
            Create account
          </Link>
        </p>
      </Card>
    </section>
  );
}

export default Login;
