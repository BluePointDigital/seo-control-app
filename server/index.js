import 'dotenv/config'

import { createApp } from './app.js'
import { assertSupportedRuntime } from './lib/runtime.js'

await assertSupportedRuntime()

const { app, context, close } = createApp()
const server = app.listen(context.config.port, () => {
  console.log(`Agency SaaS API listening on http://localhost:${context.config.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      close()
      process.exit(0)
    })
  })
}
