import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({
  getDoctorsAdmin: vi.fn(),
  getDoctorStatsAdmin: vi.fn(),
  getEligibleDoctorUsers: vi.fn(),
}));
const master = vi.hoisted(() => ({
  getSpecializations: vi.fn(), getStates: vi.fn(), getDistricts: vi.fn(), getCities: vi.fn(),
}));
vi.mock("../../api/adminApi", () => ({ adminApi: api }));
vi.mock("../../api/masterDataApi", () => ({ masterDataApi: master }));
vi.mock("../../api/doctorApi", () => ({ doctorApi: {} }));
vi.mock("../../components/admin/DoctorDetailWorkspace", () => ({ default: () => null }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../../i18n/I18nContext", () => ({ useI18n: () => ({ t: (key, fallback) => (typeof fallback === "string" ? fallback : key), locale: "en" }) }));

import AdminDoctors from "./AdminDoctors";

const doctorsResponse = (name) => ({
  data: {
    doctors: [{ _id: `id-${name}`, user: { name, email: `${name}@x.test`, isActive: true }, specialization: "General", verificationStatus: "approved", rating: 4, appointmentCount: 1 }],
    pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
  },
});
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  api.getDoctorsAdmin.mockReset().mockResolvedValue(doctorsResponse("Initial"));
  api.getDoctorStatsAdmin.mockReset().mockResolvedValue({ data: null });
  Object.values(master).forEach((fn) => fn.mockReset().mockResolvedValue([]));
});

describe("AdminDoctors request hygiene", () => {
  it("loads the list once on mount", async () => {
    render(<MemoryRouter><AdminDoctors /></MemoryRouter>);
    await screen.findByText("Dr. Initial");
    expect(api.getDoctorsAdmin).toHaveBeenCalledTimes(1);
  });

  it("a slow response for an older sort cannot replace the list for the newer sort", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AdminDoctors /></MemoryRouter>);
    await screen.findByText("Dr. Initial");

    const olderSlow = deferred();
    api.getDoctorsAdmin.mockReset()
      .mockImplementationOnce(() => olderSlow.promise) // sort #1 (older, slow)
      .mockImplementationOnce(async () => doctorsResponse("Newer")); // sort #2 (newer, fast)
    const sortSelect = screen.getAllByRole("combobox").at(-1);
    const values = [...sortSelect.options].map((o) => o.value).filter((v) => v !== sortSelect.value);
    await user.selectOptions(sortSelect, values[0]);
    await user.selectOptions(sortSelect, values[1]);
    await screen.findByText("Dr. Newer");
    await new Promise((r) => setTimeout(r, 50)); // let any stray duplicate request show up

    await act(async () => { olderSlow.resolve(doctorsResponse("Older")); await Promise.resolve(); });
    expect(screen.getByText("Dr. Newer")).toBeInTheDocument();
    expect(screen.queryByText("Dr. Older")).not.toBeInTheDocument();
    expect(api.getDoctorsAdmin).toHaveBeenCalledTimes(2);
  });
});
