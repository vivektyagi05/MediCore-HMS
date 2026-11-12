import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppErrorBoundary, { isChunkLoadError } from "./AppErrorBoundary";

const Bomb = ({ explode, message = "kaboom" }) => { if (explode) throw new Error(message); return <p>healthy page</p>; };
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe("AppErrorBoundary", () => {
  it("shows a recoverable screen instead of a blank page when a page throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AppErrorBoundary resetKey="/a"><Bomb explode /></AppErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on this page");
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to home" })).toHaveAttribute("href", "/");
  });

  it("'Try again' re-renders the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup(); let explode = true;
    const Flaky = () => <Bomb explode={explode} />;
    render(<AppErrorBoundary resetKey="/a"><Flaky /></AppErrorBoundary>);
    explode = false; await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("healthy page")).toBeInTheDocument();
  });

  it("navigating to another route clears the error screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<AppErrorBoundary resetKey="/a"><Bomb explode /></AppErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<AppErrorBoundary resetKey="/b"><Bomb explode={false} /></AppErrorBoundary>);
    expect(screen.getByText("healthy page")).toBeInTheDocument();
  });

  it("recognises stale-chunk errors and reloads at most once per 30 s", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: /assets/x.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    const reload = vi.fn(); const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    render(<AppErrorBoundary resetKey="/a"><Bomb explode message="Failed to fetch dynamically imported module" /></AppErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1);
    render(<AppErrorBoundary resetKey="/a"><Bomb explode message="Failed to fetch dynamically imported module" /></AppErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1); // guarded: a broken deploy cannot cause a reload loop
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("A new version is available");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
