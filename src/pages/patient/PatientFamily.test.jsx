import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ getEcosystemOverview: vi.fn(), getFamily: vi.fn(), createFamily: vi.fn(), deleteFamily: vi.fn(), getFamilyWorkspace: vi.fn() }));
vi.mock("../../api/patientWorkflowApi", () => ({ patientWorkflowApi: api }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../../i18n/I18nContext", () => ({ useI18n: () => ({ t: (k) => k }) }));
vi.mock("../../components/patient/HealthEcosystemNav", () => ({ default: () => null }));
import PatientFamily from "./PatientFamily";

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getEcosystemOverview.mockResolvedValue({ data: {} });
  api.getFamily.mockResolvedValue({ data: { familyMembers: [] } });
  api.createFamily.mockResolvedValue({ data: {} });
});
const open = async () => { const user = userEvent.setup(); render(<MemoryRouter><PatientFamily /></MemoryRouter>); await screen.findByLabelText(/^Name/); return user; };
const fill = async (user, { name = "Asha Rao", relation = "Mother", age = "54" } = {}) => {
  await user.type(screen.getByLabelText(/^Name/), name); await user.type(screen.getByLabelText(/^Relation/), relation); if (age) await user.type(screen.getByLabelText(/^Age/), age);
};

describe("PatientFamily add-dependent form", () => {
  it("submits trimmed, valid data once", async () => {
    const user = await open(); await fill(user, { name: "  Asha Rao  " });
    await user.click(screen.getByRole("button", { name: "Save Dependent" }));
    await waitFor(() => expect(api.createFamily).toHaveBeenCalledTimes(1));
    expect(api.createFamily.mock.calls[0][0]).toMatchObject({ name: "Asha Rao", relation: "Mother", age: 54 });
  });

  it.each([["3.5", /whole number from 0 to 130/], ["131", /whole number from 0 to 130/], ["-4", /whole number from 0 to 130/]])("blocks age %s with a message and sends nothing", async (age, message) => {
    const user = await open(); await fill(user, { age });
    await user.click(screen.getByRole("button", { name: "Save Dependent" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.createFamily).not.toHaveBeenCalled();
  });

  it("blocks an empty form and names each missing field", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Save Dependent" }));
    expect(await screen.findByText("Name must be 2-100 characters")).toBeInTheDocument();
    expect(screen.getByText("Relation must be 2-80 characters")).toBeInTheDocument();
    expect(api.createFamily).not.toHaveBeenCalled();
  });

  it("a double click adds the dependent only once", async () => {
    const user = await open(); await fill(user);
    let release; api.createFamily.mockReturnValue(new Promise((r) => { release = r; }));
    await user.dblClick(screen.getByRole("button", { name: "Save Dependent" }));
    expect(api.createFamily).toHaveBeenCalledTimes(1);
    release({ data: {} });
  });
});
