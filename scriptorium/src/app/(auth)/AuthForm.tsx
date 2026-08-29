'use client'
import { useActionState } from 'react'
import Link from 'next/link'

type State = { error?: string; ok?: string } | undefined
type Action = (prev: State, fd: FormData) => Promise<State>

export function AuthForm({
  action, mode, next,
}: { action: Action; mode: 'signin' | 'signup'; next?: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, undefined)
  const isSignIn = mode === 'signin'

  return (
    <form action={formAction} className="w-full max-w-sm space-y-4">
      <input type="hidden" name="next" value={next ?? '/library'} />

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium">Email</label>
        <input
          id="email" name="email" type="email" required autoComplete="email"
          className="w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/30 dark:focus:ring-white/30"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">Password</label>
        <input
          id="password" name="password" type="password" required minLength={8}
          autoComplete={isSignIn ? 'current-password' : 'new-password'}
          className="w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/30 dark:focus:ring-white/30"
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>
      )}

      <button
        type="submit" disabled={pending}
        className="w-full rounded-md bg-foreground text-background py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? 'Working…' : isSignIn ? 'Sign in' : 'Create account'}
      </button>

      <p className="text-sm text-black/60 dark:text-white/60">
        {isSignIn ? "No account yet? " : 'Already have an account? '}
        <Link href={isSignIn ? '/signup' : '/signin'} className="underline underline-offset-4">
          {isSignIn ? 'Create one' : 'Sign in'}
        </Link>
      </p>
    </form>
  )
}
