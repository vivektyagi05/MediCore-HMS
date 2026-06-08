import apiClient from "./axios";

export const invoiceApi = {
  getInvoices() {
    return apiClient.get("/invoices").then((res) => res.data);
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
