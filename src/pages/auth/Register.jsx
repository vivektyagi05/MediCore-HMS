import { UserPlus } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useState } from "react";
import { getApiErrorMessage } from "../../api/axios";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import { roleDashboardPath, useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

const initialForm = {
  name: "",
  role: "patient",
  email: "",
  password: "",
  confirmPassword: "",
};

function validateForm(form) {
  const errors = {};

  if (form.name.trim().length < 2) errors.name = "Name must be at least 2 characters";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = "Enter a valid email";
  if (form.password.length < 8) errors.password = "Password must be at least 8 characters";
  if (form.confirmPassword !== form.password) errors.confirmPassword = "Passwords do not match";

  return errors;
}

function Register() {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register, isAuthenticated, role } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

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
      const user = await register({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
      });
      toast.success("Account created successfully");
      navigate(roleDashboardPath(user.role), { replace: true });
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
      <Card className="w-full max-w-2xl">
        <div className="mb-8">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
            <UserPlus size={24} />
          </div>
          <h1 className="text-3xl font-black text-slate-950">Create hospital workspace</h1>
          <p className="mt-2 text-sm text-slate-600">Create a secure HMS account with role-based access.</p>
        </div>

        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <Input label="Full name" name="name" placeholder="Vivek Sharma" value={form.name} onChange={updateField} error={errors.name} />
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Role</span>
            <select
              name="role"
              value={form.role}
              onChange={updateField}
              className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            >
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
            </select>
          </label>
          <Input label="Email" name="email" type="email" placeholder="vivek@hospital.com" value={form.email} onChange={updateField} error={errors.email} />
          <Input label="Password" name="password" type="password" placeholder="Minimum 8 characters" value={form.password} onChange={updateField} error={errors.password} />
          <Input label="Confirm password" name="confirmPassword" type="password" placeholder="Repeat password" value={form.confirmPassword} onChange={updateField} error={errors.confirmPassword} />
          {serverError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 md:col-span-2">
              {serverError}
            </div>
          )}
          <div className="md:col-span-2">
            <Button type="submit" className="w-full" isLoading={isSubmitting}>
              Create Account
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already registered?{" "}
          <Link className="font-bold text-blue-600 hover:text-blue-700" to="/login">
            Login
          </Link>
        </p>
      </Card>
    </section>
  );
}

export default Register;
