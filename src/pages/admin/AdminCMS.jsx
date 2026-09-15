import { useEffect, useMemo, useState } from "react";

import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";

import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Modal from "../../components/ui/Modal";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useToast } from "../../context/ToastContext";

const emptyForm = { slug: "", title: "", content: "", bannerImage: "", isPublished: false };

function AdminCMS() {
  const toast = useToast();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPage, setEditingPage] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const loadPages = async () => {
    try {
      setLoading(true);
      const params = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (search) params.search = search;
      const response = await adminApi.getCMSPages(params);
      setPages(response.data?.pages || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPages();
  }, [statusFilter]);

  const filteredPages = useMemo(() => pages, [pages]);

  const openCreate = () => {
    setEditingPage(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (page) => {
    setEditingPage(page);
    setForm({
      slug: page.slug,
      title: page.title,
      content: page.content,
      bannerImage: page.bannerImage || "",
      isPublished: page.isPublished,
    });
    setModalOpen(true);
  };

  const submitForm = async () => {
    if (!form.slug || !form.title || !form.content) {
      toast.error("Slug, title, and content are required");
      return;
    }
    try {
      setSubmitting(true);
      if (editingPage) {
        await adminApi.updateCMSPage(editingPage._id, form);
        toast.success("Page updated successfully");
      } else {
        await adminApi.saveCMSPage(form);
        toast.success("Page saved successfully");
      }
      setModalOpen(false);
      await loadPages();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const removePage = async (page) => {
    if (!window.confirm(`Delete "${page.title}"? This cannot be undone.`)) return;
    try {
      await adminApi.deleteCMSPage(page._id);
      toast.success("Page deleted successfully");
      await loadPages();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Content Management</h1>
          <p className="text-sm text-slate-500">
            Manage homepage content, articles, FAQs, announcements, and policy pages.
          </p>
        </div>
        <Button onClick={openCreate}>New Page</Button>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search by title"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadPages()}
            className="max-w-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All pages</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
          </select>
          <Button variant="secondary" onClick={loadPages}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <Loader label="Loading CMS pages" />
        ) : filteredPages.length === 0 ? (
          <EmptyState title="No pages yet" description="Create your first page to publish site content." />
        ) : (
          <div className="space-y-3">
            {filteredPages.map((page) => (
              <div
                key={page._id}
                className="flex flex-col gap-2 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{page.title}</p>
                  <p className="text-xs text-slate-500">/{page.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      page.isPublished ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {page.isPublished ? "Published" : "Draft"}
                  </span>
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => openEdit(page)}>
                    Edit
                  </Button>
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => removePage(page)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        isOpen={modalOpen}
        title={editingPage ? "Edit Page" : "New Page"}
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-4">
          <Input
            label="Slug"
            value={form.slug}
            disabled={!!editingPage}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="about-us"
          />
          <Input
            label="Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Content</label>
            <textarea
              className="w-full rounded-xl border border-slate-200 p-3 text-sm"
              rows={6}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            />
          </div>
          <Input
            label="Banner Image URL (optional)"
            value={form.bannerImage}
            onChange={(e) => setForm((f) => ({ ...f, bannerImage: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(e) => setForm((f) => ({ ...f, isPublished: e.target.checked }))}
            />
            Published
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={submitting}>
              {submitting ? "Saving..." : "Save Page"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default AdminCMS;
