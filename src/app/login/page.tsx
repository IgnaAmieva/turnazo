import type { Metadata } from 'next';
import Link from 'next/link';
import LoginForm from './login-form';

export const metadata: Metadata = { title: 'Iniciar sesión' };

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <a href="/" className="text-green-700 font-bold text-2xl tracking-tight">Turnazo</a>
          <p className="text-gray-500 text-sm mt-1">Panel del dueño</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h1 className="text-lg font-semibold text-gray-900 mb-5">Iniciar sesión</h1>
          <LoginForm />
        </div>
        <p className="text-center text-sm text-gray-500 mt-4">
          ¿No tenés cuenta?{' '}
          <Link href="/registro" className="text-green-700 font-medium hover:underline">Registrate</Link>
        </p>
      </div>
    </div>
  );
}
