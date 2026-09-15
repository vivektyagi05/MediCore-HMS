import apiClient from "./axios";

export const invoiceApi = {
  getInvoices(params = {}) {
    return apiClient.get("/invoices", { params }).then((res) => res.data);
  },
  getSummary() {
    return apiClient.get("/invoices/summary").then((res) => res.data);
  },
  getInvoice(id) {
    return apiClient.get(`/invoices/${id}`).then((res) => res.data);
  },
  downloadInvoice(id) {
    return apiClient
      .get(`/invoices/${id}/download`, { responseType: "blob" })
      .then((res) => res.data);
  },
};
