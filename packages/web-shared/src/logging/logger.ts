import { datadogLogs, type Context } from '@datadog/browser-logs'

export type BrowserLoggerConfig = {
  clientToken?: string
  site?: string
  service: string
  environment?: string
  version?: string
}

let initialized = false

// initializeBrowserLogger is intentionally a no-op without a client token so
// every developer can run the app without Datadog credentials.
export function initializeBrowserLogger(config: BrowserLoggerConfig): boolean {
  if (initialized || !config.clientToken) {
    return initialized
  }

  datadogLogs.init({
    clientToken: config.clientToken,
    site: config.site ?? 'datadoghq.com',
    service: config.service,
    env: config.environment ?? 'local',
    version: config.version ?? 'dev',
    forwardErrorsToLogs: true,
    sessionSampleRate: 100,
  })
  datadogLogs.setGlobalContextProperty('app_type', 'browser')
  initialized = true
  browserLogger.info('application started', { event_name: 'application_started' })
  return true
}

function log(message: string, context: Context | undefined, status: 'debug' | 'info' | 'warn' | 'error', error?: Error) {
  if (!initialized) {
    return
  }
  datadogLogs.logger.log(message, context, status, error)
}

export const browserLogger = {
  debug(message: string, context?: Context) {
    log(message, context, 'debug')
  },
  info(message: string, context?: Context) {
    log(message, context, 'info')
  },
  warn(message: string, context?: Context) {
    log(message, context, 'warn')
  },
  error(message: string, context?: Context, error?: Error) {
    log(message, context, 'error', error)
  },
}
