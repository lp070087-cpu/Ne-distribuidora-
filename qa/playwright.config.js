import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'.', testMatch:'portal.spec.js', workers:1, timeout:45000,
  webServer:{command:'node qa/server.js',url:'http://localhost:4176/api/portal',cwd:process.cwd(),timeout:30000,
    env:{MAXDISTRIB_PORTAL_ENABLED:'1',MAXDISTRIB_ORIGIN:'http://localhost:4176',
      MAXDISTRIB_TERMS_URL:'https://portal.test/termos',MAXDISTRIB_PRIVACY_URL:'https://portal.test/privacidade',
      MAXDISTRIB_TERMS_VERSION:'fixture',MAXDISTRIB_DELIVERY_QUOTE:'1',NODE_ENV:'test'}},
  use:{...devices['Desktop Chrome'],baseURL:'http://localhost:4176'}
});
