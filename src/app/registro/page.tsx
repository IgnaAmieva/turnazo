import type { Metadata } from 'next';
import Link from 'next/link';
import RegisterForm from './register-form';

export const metadata: Metadata = { title: 'Crear cuenta' };

export default function RegistroPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <a href="/" className="text-brand font-bold text-2xl tracking-tight">Turnazo</a>
          <p className="text-ink-muted text-sm mt-1">Panel del dueño</p>
        </div>
        <div className="bg-surface rounded-2xl border border-line shadow-sm p-6">
          <h1 className="text-lg font-semibold text-ink mb-5">Crear cuenta</h1>
          <RegisterForm />
        </div>
        <p className="text-center text-sm text-ink-muted mt-4">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="text-brand font-medium hover:underline">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
}
