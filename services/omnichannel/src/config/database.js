let prisma = null;

function getPrisma() {
  if (prisma) return prisma;
  try {
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient();
    return prisma;
  } catch (error) {
    const message = "Prisma client is not installed/generated. Run: npm install && npm run generate";
    const wrapped = new Error(message);
    wrapped.cause = error;
    throw wrapped;
  }
}

async function disconnectPrisma() {
  if (prisma) await prisma.$disconnect();
}

module.exports = { getPrisma, disconnectPrisma };
