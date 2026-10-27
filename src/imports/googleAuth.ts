// Google Identity Services ("Sign in with Google"), loaded from Google only when needed.
// Needs VITE_GOOGLE_CLIENT_ID (see .env.example). Without it, sign-in stays hidden.

export type GoogleProfile = { sub: string; email: string; name: string }

export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()

type CredentialResponse = { credential?: string }
type GoogleId = {
  initialize(config: { client_id: string; callback: (response: CredentialResponse) => void; cancel_on_tap_outside?: boolean }): void
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void
  disableAutoSelect(): void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } }
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

let loading: Promise<GoogleId> | null = null
let credentialHandler: ((response: CredentialResponse) => void) | null = null

/** GIS allows one callback per page; the mounted button sets it. */
export function setCredentialHandler(handler: ((response: CredentialResponse) => void) | null) {
  credentialHandler = handler
}

export function loadGoogleId(): Promise<GoogleId> {
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error('VITE_GOOGLE_CLIENT_ID is not set'))
  loading ??= new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => {
      const id = window.google?.accounts?.id
      if (!id) return reject(new Error('Google Identity Services did not load'))
      id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => credentialHandler?.(r), cancel_on_tap_outside: true })
      resolve(id)
    }
    script.onerror = () => {
      loading = null
      script.remove()
      reject(new Error('Could not reach Google'))
    }
    document.head.appendChild(script)
  })
  return loading
}

/**
 * Reads the name and email from Google's ID token for display.
 * The signature is NOT checked here, so this must never authorize anything;
 * the backend has to verify the token itself once it exists.
 */
export function profileFromCredential(credential: string, clientId = GOOGLE_CLIENT_ID, now = Date.now()): GoogleProfile | null {
  try {
    const part = credential.split('.')[1] ?? ''
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))))
    if (claims.aud !== clientId || !ISSUERS.includes(claims.iss)) return null
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null
    return { sub: claims.sub, email: claims.email, name: typeof claims.name === 'string' && claims.name ? claims.name : claims.email }
  } catch {
    return null
  }
}

/** Stops Google from silently signing the same account back in. */
export function signOutGoogle() {
  window.google?.accounts?.id?.disableAutoSelect()
}
