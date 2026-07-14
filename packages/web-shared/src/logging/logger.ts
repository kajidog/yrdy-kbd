import { datadogLogs, type Context } from '@datadog/browser-logs'

export type BrowserLoggerConfig = {
  clientToken?: string
  site?: string
  service: string
  environment?: string
  version?: string
}

let initialized = false

// Datadog export is optional. Browser console logging remains available when
// there is no client token so local WebRTC failures are still diagnosable.
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

function logToConsole(
  message: string,
  context: Context | undefined,
  status: 'debug' | 'info' | 'warn' | 'error',
  error?: Error,
) {
  const details = context ? { ...context, ...(error ? { error } : {}) } : error
  const args = details ? [`[yrdy-kbd] ${message}`, details] : [`[yrdy-kbd] ${message}`]
  switch (status) {
    case 'debug':
      console.debug(...args)
      break
    case 'warn':
      console.warn(...args)
      break
    case 'error':
      console.error(...args)
      break
    default:
      console.info(...args)
  }
}

function log(
  message: string,
  context: Context | undefined,
  status: 'debug' | 'info' | 'warn' | 'error',
  error?: Error,
) {
  logToConsole(message, context, status, error)
  if (initialized) {
    datadogLogs.logger.log(message, context, status, error)
  }
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
