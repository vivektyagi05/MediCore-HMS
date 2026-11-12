import { Link, useNavigate } from "react-router-dom";
import SEOMeta from "../../components/shared/SEOMeta";

// Unknown URLs used to bounce silently to the home page, which hides mistyped or outdated links.
function NotFound() {
  const navigate = useNavigate();
  return (
    <>
      <SEOMeta title="Page not found" description="This page does not exist." canonical="/404" noIndex />
      <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">404</p>
        <h1 className="text-3xl font-black text-slate-950">We couldn’t find that page</h1>
        <p className="text-sm leading-6 text-slate-600">The link may be mistyped or out of date.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Go back</button>
          <Link to="/" className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">Go to home</Link>
        </div>
      </div>
    </>
  );
}

export default NotFound;
