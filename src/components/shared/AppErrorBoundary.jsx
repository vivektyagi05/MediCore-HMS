import { Component } from "react";

// A render error anywhere used to blank the whole app (no boundary existed). This catches it, tells the user what
// happened in plain words and offers a way out. `resetKey` (the current route) clears the error when they navigate.
// A failed lazy chunk ("Failed to fetch dynamically imported module") means a new deploy replaced the files this tab was
// built against: one automatic reload fixes it, guarded so a genuinely broken deploy cannot loop.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;
const RELOAD_FLAG = "hms_chunk_reload_at";

export const isChunkLoadError = (error) => CHUNK_ERROR.test(String(error?.message || error || ""));

export default class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (isChunkLoadError(error)) {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
      if (Date.now() - last > 30000) {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        window.location.reload();
        return;
      }
    }
    console.error("MediCore UI error:", error);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div role="alert" className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-black text-slate-950">{stale ? "A new version is available" : "Something went wrong on this page"}</h1>
        <p className="text-sm leading-6 text-slate-600">
          {stale
            ? "MediCore was updated while this tab was open. Reload to get the latest version. Anything you already saved is safe."
            : "The page hit an unexpected problem. Anything you already saved is safe, but an unsaved form may need to be filled in again."}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">Reload page</button>
          {!stale && <button type="button" onClick={() => this.setState({ error: null })} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Try again</button>}
          <a href="/" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Go to home</a>
        </div>
      </div>
    );
  }
}
