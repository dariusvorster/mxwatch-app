import { router } from '../trpc';
import { domainsRouter } from './domains';
import { checksRouter } from './checks';
import { reportsRouter } from './reports';
import { alertsRouter } from './alerts';
import { settingsRouter } from './settings';
import { mailLogRouter } from './mail-log';
import { googleRouter } from './google';
import { warmupRouter } from './warmup';
import { activityRouter } from './activity';
import { propagationRouter } from './propagation';
import { ipReputationRouter } from './ip-reputation';
import { watchedRouter } from './watched';
import { deliverabilityRouter } from './deliverability';
import { stalwartRouter } from './stalwart';
import { billingRouter } from './billing';
import { onboardingRouter } from './onboarding';
import { serverIntegrationsRouter } from './server-integrations';
import { recipientDomainsRouter } from './recipient-domains';
import { bouncesRouter } from './bounces';
import { queueRouter } from './queue';
import { authFailuresRouter } from './auth-failures';
import { securityRouter } from './security';
import { logsRouter } from './logs';
import { profileRouter } from './profile';
import { inboxSetupRouter } from './inbox-setup';

export const appRouter = router({
  domains: domainsRouter,
  checks: checksRouter,
  reports: reportsRouter,
  alerts: alertsRouter,
  settings: settingsRouter,
  mailLog: mailLogRouter,
  google: googleRouter,
  warmup: warmupRouter,
  activity: activityRouter,
  propagation: propagationRouter,
  ipReputation: ipReputationRouter,
  watched: watchedRouter,
  deliverability: deliverabilityRouter,
  stalwart: stalwartRouter,
  billing: billingRouter,
  onboarding: onboardingRouter,
  serverIntegrations: serverIntegrationsRouter,
  recipientDomains: recipientDomainsRouter,
  bounces: bouncesRouter,
  queue: queueRouter,
  authFailures: authFailuresRouter,
  security: securityRouter,
  logs: logsRouter,
  profile: profileRouter,
  inboxSetup: inboxSetupRouter,
});

export type AppRouter = typeof appRouter;
