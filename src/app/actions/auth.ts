'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) return { error: 'Email o contraseña incorrectos.' };

  revalidatePath('/panel', 'layout');
  redirect('/panel');
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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email:    parsed.data.email,
    password: parsed.data.password,
    // TODO (Fase 8): agregar emailRedirectTo cuando se active confirmación
  });

  if (error) {
    return {
      error: error.message.includes('already registered')
        ? 'Ya existe una cuenta con ese email.'
        : `Error al registrarse: ${error.message}`,
    };
  }

  if (!data.session) {
    return {
      message:
        'Revisá tu email para confirmar la cuenta. ' +
        '(Desarrollo: desactivá email confirmation en Supabase Auth settings.)',
    };
  }

  revalidatePath('/panel', 'layout');
  redirect('/panel');
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
