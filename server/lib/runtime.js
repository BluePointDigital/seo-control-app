import process from 'node:process'

const MINIMUM_NODE_MAJOR = 24
const MINIMUM_NODE_VERSION_LABEL = `${MINIMUM_NODE_MAJOR}.0.0`

export function getRuntimeDiagnostics() {
  const nodeVersion = process.versions?.node || process.version?.replace(/^v/, '') || 'unknown'
  const major = Number.parseInt(String(nodeVersion).split('.')[0] || '', 10)
  const errors = []
  const warnings = []

  if (!Number.isFinite(major) || major < MINIMUM_NODE_MAJOR) {
    errors.push(
      `Node ${MINIMUM_NODE_VERSION_LABEL}+ is required. Current runtime is ${process.version}. This app uses the built-in node:sqlite module, so npm install can succeed on an older machine while npm run dev still fails at runtime.`,
    )
  }

  return {
    nodeVersion,
    minimumNodeMajor: MINIMUM_NODE_MAJOR,
    minimumNodeVersionLabel: MINIMUM_NODE_VERSION_LABEL,
    errors,
    warnings,
  }
}

export async function assertSupportedRuntime() {
  const diagnostics = getRuntimeDiagnostics()
  if (!diagnostics.errors.length) {
    try {
      await import('node:sqlite')
    } catch (error) {
      diagnostics.errors.push(
        `The built-in node:sqlite module is unavailable in this Node runtime (${process.version}). ${error?.message || 'Unknown runtime error.'}`,
      )
    }
  }

  if (diagnostics.errors.length) {
    const message = [
      'Unsupported runtime for Agency SEO Control.',
      ...diagnostics.errors.map((item) => `- ${item}`),
      '',
      `Install Node ${diagnostics.minimumNodeVersionLabel}+ and run npm install again.`,
    ].join('\n')

    const runtimeError = new Error(message)
    runtimeError.code = 'UNSUPPORTED_RUNTIME'
    runtimeError.diagnostics = diagnostics
    throw runtimeError
  }

  return diagnostics
}
