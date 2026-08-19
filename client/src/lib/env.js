// Test/live environment detection for the in-app toggle + "Testing Mode"
// banner. The test build is served from the `test` branch preview URL; every
// other host (the live pages.dev site or a custom domain) is treated as live.
// Runtime hostname check means the SAME code works on both builds — no
// build-time flags needed.
const TEST_HOST = 'test.homesaversscanner.pages.dev'

export const LIVE_URL = 'https://homesaversscanner.pages.dev'
export const TEST_URL = 'https://test.homesaversscanner.pages.dev'

export const isTestEnv = () =>
  typeof window !== 'undefined' && window.location.hostname === TEST_HOST
