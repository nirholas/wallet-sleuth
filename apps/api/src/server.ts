/*
 * Wallet Sleuth: on-chain linkage analysis for EVM and Solana.
 *
 * Copyright (c) 2026 nirholas. All rights reserved.
 *
 * Proprietary and confidential. Source available, not open source. No licence to use, copy, modify,
 * deploy, or distribute this software is granted except by prior written permission of the copyright
 * holder. See LICENSE at the root of this repository.
 */
import { buildApp } from './app.js';

const { app, config } = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}
