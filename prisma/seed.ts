import { PrismaClient, NotificationType, Channel } from '@prisma/client';

const prisma = new PrismaClient();

// All supported type×channel pairs and their default enabled state.
// marketing is off by default; all others are on.
const defaults: Array<{ notificationType: NotificationType; channel: Channel; enabled: boolean }> = [
  { notificationType: 'security',      channel: 'email',     enabled: true  },
  { notificationType: 'security',      channel: 'sms',       enabled: true  },
  { notificationType: 'security',      channel: 'push',      enabled: true  },
  { notificationType: 'security',      channel: 'messenger', enabled: true  },

  { notificationType: 'transactional', channel: 'email',     enabled: true  },
  { notificationType: 'transactional', channel: 'sms',       enabled: true  },
  { notificationType: 'transactional', channel: 'push',      enabled: true  },
  { notificationType: 'transactional', channel: 'messenger', enabled: true  },

  { notificationType: 'system',        channel: 'email',     enabled: true  },
  { notificationType: 'system',        channel: 'sms',       enabled: true  },
  { notificationType: 'system',        channel: 'push',      enabled: true  },
  { notificationType: 'system',        channel: 'messenger', enabled: true  },

  { notificationType: 'marketing',     channel: 'email',     enabled: false },
  { notificationType: 'marketing',     channel: 'sms',       enabled: false },
  { notificationType: 'marketing',     channel: 'push',      enabled: false },
  { notificationType: 'marketing',     channel: 'messenger', enabled: false },
];

async function main() {
  for (const row of defaults) {
    await prisma.defaultPreference.upsert({
      where: { notificationType_channel: { notificationType: row.notificationType, channel: row.channel } },
      create: row,
      update: { enabled: row.enabled },
    });
  }
  console.log(`Seeded ${defaults.length} default preferences.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
