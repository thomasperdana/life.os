'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const Credentials = z.object({
  email: z.email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
})

export async function signIn(_prev: unknown, formData: FormData) {
  const parsed = Credentials.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect((formData.get('next') as string) || '/library')
}

export async function signUp(_prev: unknown, formData: FormData) {
  const parsed = Credentials.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp(parsed.data)
  if (error) return { error: error.message }

  return { ok: 'Check your email to confirm your account.' }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/signin')
}
