import apiClient from "./axios";

export const walletApi = {
  getWallet() {
    return apiClient.get("/wallet").then((res) => res.data);
  },
};
