import { useEffect, useRef, useState } from 'react'
import { GOOGLE_CLIENT_ID, loadGoogleId, profileFromCredential, setCredentialHandler, type GoogleProfile } from './googleAuth'

interface GoogleSignInButtonProps {
  onSignIn: (profile: GoogleProfile) => void
  compact?: boolean
}

export default function GoogleSignInButton({ onSignIn, compact = false }: GoogleSignInButtonProps) {
  const slot = useRef<HTMLDivElement>(null)
  const onSignInRef = useRef(onSignIn)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    onSignInRef.current = onSignIn
  }, [onSignIn])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    let live = true
    setCredentialHandler((response) => {
      const profile = response.credential ? profileFromCredential(response.credential) : null
      if (profile) onSignInRef.current(profile)
      else setRejected(true)
    })
    loadGoogleId().then(
      (id) => {
        if (!live || !slot.current) return
        id.renderButton(slot.current, {
          type: 'standard',
          theme: 'outline',
          size: compact ? 'medium' : 'large',
          shape: 'pill',
          text: compact ? 'signin' : 'signin_with',
          logo_alignment: 'left',
          ...(compact ? {} : { width: Math.max(200, Math.min(slot.current.offsetWidth || 280, 400)) }),
        })
        setStatus('ready')
      },
      () => live && setStatus('error'),
    )
    return () => {
      live = false
      setCredentialHandler(null)
    }
  }, [compact])

  if (!GOOGLE_CLIENT_ID) {
    return compact ? null : (
      <div>
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-sm font-medium text-ink opacity-50"
        >
          Sign in with Google
        </button>
        <p className="mt-1.5 text-center text-xs text-ink-soft">
          Google sign-in isn't set up on this site yet.
          {import.meta.env.DEV && ' Add VITE_GOOGLE_CLIENT_ID to .env.local and restart the dev server.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div ref={slot} className={compact ? '' : 'flex min-h-10 w-full justify-center'} />
      {status === 'loading' && !compact && <p className="text-center text-xs text-ink-soft">Loading Google sign-in…</p>}
      {status === 'error' && (
        <p className="text-xs text-titan">Couldn't reach Google. Check your connection, or upload your schedule instead.</p>
      )}
      {rejected && <p className="mt-1.5 text-xs text-titan">Google sign-in didn't complete. Please try again.</p>}
    </div>
  )
}
