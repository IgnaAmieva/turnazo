import type { Metadata } from 'next';
import Link from 'next/link';
import RegisterForm from './register-form';

export const metadata: Metadata = { title: 'Crear cuenta' };

export default function RegistroPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <a href="/" className="text-green-700 font-bold text-2xl tracking-tight">Turnazo</a>
          <p className="text-gray-500 text-sm mt-1">Panel del dueño</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h1 className="text-lg font-semibold text-gray-900 mb-5">Crear cuenta</h1>
          <RegisterForm />
        </div>
        <p className="text-center text-sm text-gray-500 mt-4">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="text-green-700 font-medium hover:underline">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
}
