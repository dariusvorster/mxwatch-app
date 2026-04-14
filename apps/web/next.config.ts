import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  output: 'standalone',
  // Trace workspace packages correctly for the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@mxwatch/db', '@mxwatch/monitor', '@mxwatch/alerts', '@mxwatch/types'],
  serverExternalPackages: ['better-sqlite3', 'smtp-server', 'mailparser', 'adm-zip', 'nodemailer', 'node-cron', '@react-pdf/renderer'],
  webpack: (cfg, { isServer }) => {
    if (isServer) {
      cfg.externals = [
        ...(cfg.externals || []),
        'better-sqlite3',
        'smtp-server',
        'mailparser',
        'adm-zip',
        'nodemailer',
        ({ request }: { request?: string }, cb: (err?: null, result?: string) => void) => {
          if (request && request.startsWith('node:')) return cb(null, 'commonjs ' + request);
          cb();
        },
      ];
    } else {
      // Never pull Node built-ins into the client bundle.
      cfg.resolve = cfg.resolve || {};
      cfg.resolve.fallback = {
        ...(cfg.resolve.fallback || {}),
        fs: false,
        path: false,
        net: false,
        tls: false,
        dns: false,
        stream: false,
        zlib: false,
        child_process: false,
        events: false,
        'node-cron': false,
        'better-sqlite3': false,
        'smtp-server': false,
        mailparser: false,
        'adm-zip': false,
        nodemailer: false,
      };
    }
    return cfg;
  },
};

export default config;
