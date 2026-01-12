import LoginForm from './login-form';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
            Database Backup Manager
        </h1>
      </div>
      <LoginForm />
    </div>
  );
}
