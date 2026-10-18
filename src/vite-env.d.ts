interface ImportMetaEnv {
  /** Sätts bara när en PR-förhandsvisning byggs, t.ex. "PR #3". */
  readonly VITE_PREVIEW_LABEL?: string
}

/** Commitens korta hash som appen byggdes från, eller "dev". */
declare const __APP_VERSION__: string
/** När appen byggdes (ISO-tid). */
declare const __APP_BUILT__: string
