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
});

export type AppRouter = typeof appRouter;
