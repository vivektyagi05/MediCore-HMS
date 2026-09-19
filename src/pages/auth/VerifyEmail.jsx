import { CheckCircle2, MailCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthPageFrame from "../../components/public/AuthPageFrame";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import { authApi } from "../../api/authApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";

function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const initialEmail = useMemo(() => searchParams.get("email") || "", [searchParams]);
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (!token) {
      setStatus("waiting");
      return;
    }

    authApi.verifyEmail(token)
      .then((response) => {
        setStatus("verified");
        setMessage(response.message || "Email verified successfully. You can now log in.");
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      })
      .catch((error) => {
        setStatus("error");
        setMessage(getApiErrorMessage(error));
      });
  }, []);

  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const resend = async (event) => {
    event.preventDefault();
    if (!email || cooldown) return;
    setResending(true);
    try {
      const response = await authApi.resendVerification(email.trim());
      setMessage(response.message || "If an unverified account exists, a verification email will be sent.");
      toast.success("Verification email request processed.");
      setCooldown(60);
    } catch (error) {
      setMessage(getApiErrorMessage(error));
    } finally {
      setResending(false);
    }
  };

  const verified = status === "verified";

  return (
    <AuthPageFrame mode="login">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          {verified ? <CheckCircle2 size={28} /> : <MailCheck size={28} />}
        </div>
        <h1 className="mt-5 text-3xl font-black text-slate-950">
          {verified ? "Email verified" : "Verify your email"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {verified
            ? message
            : "We sent a verification link to your registered email address. Verify it before continuing."}
        </p>
      </div>

      {status !== "verified" && (
        <form className="mt-7 space-y-4" onSubmit={resend}>
          <Input
            label="Registered email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          {message && <p className="text-sm font-semibold text-slate-600">{message}</p>}
          <Button type="submit" className="w-full" isLoading={resending} disabled={!email || Boolean(cooldown)}>
            {cooldown ? `Resend available in ${cooldown}s` : "Resend verification email"}
          </Button>
        </form>
      )}

      {verified && (
        <div className="mt-7">
          <Button to="/login" className="w-full">Continue to login</Button>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        <Link className="font-bold text-blue-600" to="/login">Back to login</Link>
      </p>
    </AuthPageFrame>
  );
}

export default VerifyEmail;
