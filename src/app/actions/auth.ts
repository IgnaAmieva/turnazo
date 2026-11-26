'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkAuthAbuse } from '@/lib/abuse';

const LoginSchema = z.object({
  email:    z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});

const RegisterSchema = z.object({
  email:    z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  confirm:  z.string(),
}).refine((d) => d.password === d.confirm, {
  message: 'Las contraseñas no coinciden',
  path: ['confirm'],
});

export type AuthActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
};

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = LoginSchema.safeParse({
    email:    formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Captcha (verificado acá, en el servidor) y límite por IP (S2)
  const abuse = await checkAuthAbuse(formData, 'login');
  if (abuse) return { error: abuse };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return { error: 'Email o contraseña incorrectos.' };

  // El superadmin entra a su panel (la base decide el rol)
  const { data: admin } = await supabase.rpc('is_superadmin');
  revalidatePath('/panel', 'layout');
  redirect(admin === true ? '/admin' : '/panel');
}

export async function registerAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = RegisterSchema.safeParse({
    email:    formData.get('email'),
    password: formData.get('password'),
    confirm:  formData.get('confirm'),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const abuse = await checkAuthAbuse(formData, 'signup');
  if (abuse) return { error: abuse };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email:    parsed.data.email,
    password: parsed.data.password,
    // TODO (Fase 8): agregar emailRedirectTo cuando se active confirmación
  });

  if (error) {
    // Mismo mensaje exista o no la cuenta: no revela qué emails están registrados.
    console.error('[auth] signUp failed:', error.code ?? '', error.status ?? '');
    return { error: 'No se pudo completar el registro. Si ya tenés cuenta, ingresá con tu email.' };
  }

  if (!data.session) {
    return { message: 'Revisá tu email para confirmar la cuenta.' };
  }

  revalidatePath('/panel', 'layout');
  redirect('/panel');
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
