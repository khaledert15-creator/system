class AssignmentService {
  constructor({ conversationService }) {
    this.conversationService = conversationService;
  }

  claim(input) {
    return this.conversationService.claim(input);
  }

  assign(input) {
    return this.conversationService.assign(input);
  }
}

module.exports = { AssignmentService };
