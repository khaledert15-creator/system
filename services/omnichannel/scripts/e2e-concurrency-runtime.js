require("../src/config/env");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const BASE_APP = process.env.EXISTING_APP_BASE_URL || "http://127.0.0.1:8765";
const BASE_OMNI = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8775";
const PASSWORD = "DotCom@2026";

async function request(method, url, { token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(token ? { "X-Session-Token": token } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { status: response.status, body: payload };
}

async function login(username) {
  const result = await request("POST", `${BASE_APP}/api/login`, { body: { username, password: PASSWORD } });
  if (!result.body?.token) throw new Error(`login failed ${username}: ${result.status}`);
  return { username, token: result.body.token, user: result.body.user };
}

async function createConversation(ownerToken, suffix) {
  const accounts = await request("GET", `${BASE_OMNI}/api/channel-accounts`, { token: ownerToken });
  const whatsapp = accounts.body.accounts.find(account => account.channel?.key === "whatsapp" && account.status === "mock_connected");
  if (!whatsapp) throw new Error("No mock WhatsApp account found");
  const inbound = await request("POST", `${BASE_OMNI}/api/mock/whatsapp/incoming`, {
    token: ownerToken,
    body: {
      channelAccountId: whatsapp.id,
      phone: `01078${String(suffix).slice(-6)}`,
      name: `E2E Concurrency Fixed ${suffix}`,
      text: `E2E fixed concurrency message ${suffix}`
    }
  });
  if (inbound.status !== 201) throw new Error(`mock inbound failed: ${inbound.status} ${JSON.stringify(inbound.body)}`);
  const id = inbound.body.conversation.id;
  const detail = await request("GET", `${BASE_OMNI}/api/conversations/${id}`, { token: ownerToken });
  return { id, initial: detail.body.conversation };
}

async function getConversation(token, id) {
  return (await request("GET", `${BASE_OMNI}/api/conversations/${id}`, { token })).body.conversation;
}

async function dbSnapshot(conversationId) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const assignments = await prisma.conversationAssignment.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  const events = await prisma.conversationEvent.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  const messages = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  const activities = await prisma.agentActivityLog.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  const delivery = await prisma.messageDeliveryStatus.findMany({ where: { messageId: { in: messages.map(message => message.id) } }, orderBy: { createdAt: "asc" } });
  return { conversation, assignments, events, messages, activities, delivery };
}

async function main() {
  const suffix = Date.now();
  const owner = await login("owner");
  const cashier = await login("cashier");
  const shipping = await login("shipping");
  const created = await createConversation(owner.token, suffix);
  const conversationId = created.id;
  const versionN = created.initial.version;

  const claimA = await request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/claim`, { token: cashier.token, body: { version: versionN } });
  const staleClaimB = await request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/claim`, { token: shipping.token, body: { version: versionN } });
  const afterClaim = await getConversation(owner.token, conversationId);
  const countAfterClaim = await prisma.message.count({ where: { conversationId } });

  const unauthorizedReplyB = await request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/messages`, {
    token: shipping.token,
    body: { text: "B unauthorized before transfer", clientMessageId: `unauth-b-${suffix}` }
  });
  const countAfterUnauthorized = await prisma.message.count({ where: { conversationId } });

  const authorizedReplyA = await request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/messages`, {
    token: cashier.token,
    body: { text: "A authorized reply before transfer", clientMessageId: `auth-a-${suffix}` }
  });

  const versionBeforeTransfer = (await getConversation(owner.token, conversationId)).version;
  const transferValid = await request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/assign`, {
    token: owner.token,
    body: { toUserId: "U006", reason: "E2E supervisor transfer to B", version: versionBeforeTransfer }
  });
  const staleTransfer = await request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/assign`, {
    token: owner.token,
    body: { toUserId: "U004", reason: "E2E stale transfer back to A", version: versionBeforeTransfer }
  });
  const afterTransfer = await getConversation(owner.token, conversationId);

  const oldAgentAfterTransfer = await request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/messages`, {
    token: cashier.token,
    body: { text: "A old agent after transfer should block", clientMessageId: `old-after-transfer-${suffix}` }
  });
  const newAgentReplyB = await request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/messages`, {
    token: shipping.token,
    body: { text: "B new assigned reply after transfer", clientMessageId: `new-b-${suffix}` }
  });

  const race = await Promise.all([
    request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/messages`, {
      token: cashier.token,
      body: { text: "race A old blocked", clientMessageId: `race-a-${suffix}` }
    }),
    request("POST", `${BASE_OMNI}/api/conversations/${conversationId}/messages`, {
      token: shipping.token,
      body: { text: "race B accepted", clientMessageId: `race-b-${suffix}` }
    })
  ]);

  const db = await dbSnapshot(conversationId);
  const outbounds = db.messages.filter(message => message.direction === "outbound");
  const duplicateClientIds = Object.entries(outbounds.reduce((acc, message) => {
    acc[message.clientMessageId] = (acc[message.clientMessageId] || 0) + 1;
    return acc;
  }, {})).filter(([, count]) => count > 1);

  const checks = {
    firstClaimSucceeds: claimA.status === 200 && claimA.body.conversation.assignedUserId === "U004",
    staleClaimFails409: staleClaimB.status === 409,
    assignedUnchangedAfterStaleClaim: afterClaim.assignedUserId === "U004",
    unauthorizedReplyBlocked: unauthorizedReplyB.status === 403 && countAfterUnauthorized === countAfterClaim,
    authorizedReplySucceeds: authorizedReplyA.status === 201 && authorizedReplyA.body.message.sentByUserId === "U004" && authorizedReplyA.body.message.status === "sent" && Boolean(authorizedReplyA.body.message.externalMessageId),
    supervisorTransferSucceeds: transferValid.status === 200 && transferValid.body.conversation.assignedUserId === "U006",
    staleTransferFails409: staleTransfer.status === 409,
    assignedUnchangedAfterStaleTransfer: afterTransfer.assignedUserId === "U006",
    oldAgentBlockedAfterTransfer: oldAgentAfterTransfer.status === 403,
    newAgentReplySucceeds: newAgentReplyB.status === 201 && newAgentReplyB.body.message.sentByUserId === "U006",
    doubleReplyRacePolicy: race[0].status === 403 && race[1].status === 201 && race[1].body.message.sentByUserId === "U006",
    noDuplicateOutboundClientIds: duplicateClientIds.length === 0,
    assignmentHistoryCorrect: db.assignments.length === 2 && db.assignments[0].toUserId === "U004" && db.assignments[1].fromUserId === "U004" && db.assignments[1].toUserId === "U006" && db.assignments[1].assignedByUserId === "U001",
    auditTrailExists: db.activities.length >= 4 && db.events.length >= 4,
    deliveryHistoryExists: db.delivery.length >= 3
  };

  const report = {
    pass: Object.values(checks).every(Boolean),
    users: { supervisor: owner.user, agentA: cashier.user, agentB: shipping.user },
    conversationId,
    versions: {
      initial: versionN,
      afterClaim: afterClaim.version,
      beforeTransfer: versionBeforeTransfer,
      afterTransfer: afterTransfer.version,
      final: db.conversation.version
    },
    http: {
      claimA: { status: claimA.status },
      staleClaimB: { status: staleClaimB.status, body: staleClaimB.body },
      unauthorizedReplyB: { status: unauthorizedReplyB.status },
      authorizedReplyA: { status: authorizedReplyA.status, sentByUserId: authorizedReplyA.body?.message?.sentByUserId, statusText: authorizedReplyA.body?.message?.status, externalMessageId: authorizedReplyA.body?.message?.externalMessageId },
      transferValid: { status: transferValid.status, assignedUserId: transferValid.body?.conversation?.assignedUserId },
      staleTransfer: { status: staleTransfer.status, body: staleTransfer.body },
      oldAgentAfterTransfer: { status: oldAgentAfterTransfer.status },
      newAgentReplyB: { status: newAgentReplyB.status, sentByUserId: newAgentReplyB.body?.message?.sentByUserId, externalMessageId: newAgentReplyB.body?.message?.externalMessageId },
      race: race.map(result => ({ status: result.status, sentByUserId: result.body?.message?.sentByUserId, externalMessageId: result.body?.message?.externalMessageId }))
    },
    checks,
    db: {
      conversation: { assignedUserId: db.conversation.assignedUserId, version: db.conversation.version, status: db.conversation.status },
      assignmentCount: db.assignments.length,
      assignments: db.assignments.map(item => ({ action: item.action, assignedByUserId: item.assignedByUserId, fromUserId: item.fromUserId, toUserId: item.toUserId, reason: item.reason })),
      eventCount: db.events.length,
      events: db.events.map(item => ({ eventType: item.eventType, actorUserId: item.actorUserId, messageId: item.messageId })),
      messageCount: db.messages.length,
      messages: db.messages.map(item => ({ direction: item.direction, textContent: item.textContent, sentByUserId: item.sentByUserId, externalMessageId: item.externalMessageId, status: item.status, clientMessageId: item.clientMessageId })),
      activityCount: db.activities.length,
      activities: db.activities.map(item => ({ userId: item.userId, action: item.action, messageId: item.messageId })),
      deliveryCount: db.delivery.length,
      duplicateClientIds
    }
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
