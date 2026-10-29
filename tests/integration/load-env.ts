import { loadEnvConfig } from "@next/env";

// NODE_ENV is "test" under Vitest, so this loads .env.test (CI env vars take precedence).
loadEnvConfig(process.cwd());
