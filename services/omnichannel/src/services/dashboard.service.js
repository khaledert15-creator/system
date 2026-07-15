class DashboardService {
  constructor({ repository }) {
    this.repository = repository;
  }

  summary(range = {}) {
    return this.repository.dashboardSummary(range);
  }
}

module.exports = { DashboardService };
