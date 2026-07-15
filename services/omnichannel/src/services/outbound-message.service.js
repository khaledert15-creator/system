class OutboundMessageService {
  constructor({ messageService }) {
    this.messageService = messageService;
  }

  send(input) {
    return this.messageService.sendOutbound(input);
  }
}

module.exports = { OutboundMessageService };
