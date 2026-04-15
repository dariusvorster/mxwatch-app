import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/routers/_app';
import { createContext } from '@/server/context';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
    onError({ path, error }) {
      // Surface server errors in container logs — otherwise tRPC silently
      // returns a 500 with no trace and the client only sees the status.
      console.error(`[trpc] ${path ?? '<unknown>'}:`, error.message);
      if (error.cause) console.error('  cause:', error.cause);
      if (error.stack) console.error(error.stack);
    },
  });

export { handler as GET, handler as POST };
