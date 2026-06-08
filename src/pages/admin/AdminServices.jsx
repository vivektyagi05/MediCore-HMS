import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import AdminModal from "../../components/admin/AdminModal";
import AdminTable from "../../components/admin/AdminTable";
import FilterBar from "../../components/admin/FilterBar";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import { useToast } from "../../context/ToastContext";

const emptyService = { title: "", description: "", price: "", category: "", icon: "", image: "", isActive: true };

function AdminServices() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    category: searchParams.get("category") || "",
    status: searchParams.get("status") || "",
  });
  const [services, setServices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyService);
  const [error, setError] = useState("");
  const toast = useToast();

  const query = useMemo(() => Object.fromEntries([...searchParams.entries()].filter(([, value]) => value)), [searchParams]);

  const loadServices = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await adminApi.getServices({ ...query, limit: 50 });
      setServices(response.data.services || []);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, [searchParams]);

  const openModal = (service = null) => {
    setEditing(service);
    setForm(service || emptyService);
  };

  const saveService = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      if (editing) await adminApi.updateService(editing._id, form);
      else await adminApi.createService(form);
      toast.success(`Service ${editing ? "updated" : "created"}`);
      setEditing(null);
      setForm(emptyService);
      await loadServices();
    } catch (saveError) {
      toast.error(getApiErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteService = async (service) => {
    try {
      await adminApi.deleteService(service._id);
      toast.success("Service deleted");
      await loadServices();
    } catch (deleteError) {
      toast.error(getApiErrorMessage(deleteError));
    }
  };

  const columns = [
    { key: "title", header: "Service" },
    { key: "category", header: "Category" },
    { key: "price", header: "Price", render: (row) => `INR ${row.price}` },
    { key: "isActive", header: "Status", render: (row) => (row.isActive ? "Active" : "Disabled") },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openModal(row)}>Edit</Button>
          <Button variant="secondary" onClick={() => deleteService(row)}><Trash2 size={16} /></Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Service Management</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Hospital service catalog</h1>
        </div>
        <Button onClick={() => openModal()}><Plus size={18} /> New Service</Button>
      </div>
      <FilterBar
        filters={filters}
        onChange={(event) => setFilters((current) => ({ ...current, [event.target.name]: event.target.value }))}
        onApply={() => setSearchParams(filters)}
      >
        <Input name="category" placeholder="Category" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} />
        <select className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-semibold" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Disabled</option>
        </select>
      </FilterBar>
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
      <Card><AdminTable columns={columns} data={services} isLoading={isLoading} /></Card>
      <AdminModal isOpen={Boolean(editing) || form !== emptyService} title={editing ? "Edit Service" : "Create Service"} onClose={() => { setEditing(null); setForm(emptyService); }}>
        <form className="grid gap-4" onSubmit={saveService}>
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Input label="Price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <Input label="Icon / Image URL" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Description</span>
            <textarea className="min-h-24 w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label className="flex items-center gap-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
          <Button type="submit" isLoading={isSaving}>Save Service</Button>
        </form>
      </AdminModal>
    </div>
  );
}

export default AdminServices;
