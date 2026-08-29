import { AuthForm } from '../AuthForm'
import { signIn } from '../actions'

export default async function SignInPage({
  searchParams,
}: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <main className="min-h-dvh grid place-items-center px-6 py-16">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Your library, your bookmarks, your journals.
          </p>
        </div>
        <AuthForm action={signIn} mode="signin" next={next} />
      </div>
    </main>
  )
}
