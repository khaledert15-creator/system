# Meta Activation Checklist

No real Meta connection is performed by this repository step.

1. Deploy the application.
2. Enable HTTPS.
3. Confirm public webhook URLs:
   - `https://example.com/webhooks/whatsapp`
   - `https://example.com/webhooks/messenger`
4. Create/prepare Meta App.
5. Configure `META_APP_SECRET`.
6. Configure strong `META_WEBHOOK_VERIFY_TOKEN`.
7. Register webhooks in Meta.
8. Connect the secondary/test WhatsApp number first.
9. Test inbound message.
10. Test outbound reply.
11. Test delivered callback.
12. Test read callback.
13. Test failed callback.
14. Connect Messenger main page.
15. Monitor logs and `/ready`.
16. Only after stable operation, evaluate connecting the primary WhatsApp account.

Safety rules:

- Do not use production credentials on local machines.
- Do not connect the primary WhatsApp account first.
- Do not enable mock accounts in production unless an incident test explicitly requires it.
