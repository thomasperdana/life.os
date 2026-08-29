import { AuthForm } from '../AuthForm'
import { signUp } from '../actions'

export default function SignUpPage() {
  return (
    <main className="min-h-dvh grid place-items-center px-6 py-16">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Free to browse. Subscribe when you want the whole library.
          </p>
        </div>
        <AuthForm action={signUp} mode="signup" />
      </div>
    </main>
  )
}
