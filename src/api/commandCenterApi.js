import apiClient from "./axios";

export const commandCenterApi = {
  getCommandCenter() {
    return apiClient.get("/doctor/command-center").then((res) => res.data);
  },
  markReportReviewed(reportId) {
    return apiClient.patch(`/doctor/reports/${reportId}/reviewed`).then((res) => res.data);
  },
};
