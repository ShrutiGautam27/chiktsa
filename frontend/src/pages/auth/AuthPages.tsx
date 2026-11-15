import { forwardRef, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Logo } from "@/components/common";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePageTitle } from "@/hooks/usePageTitle";
import { DemoAccounts } from "@/components/DemoBanner";
import { useAuth } from "@/hooks/useAuth";
import { errorMessage } from "@/lib/api";
import { browserTimeZone } from "@/lib/utils";

/** Only allow same-site relative redirects (prevents open-redirects via ?next=). */
export function safeNext(next: string | null) {
  // Same-site paths only. Browsers treat "/\host" like "//host", so backslashes and control
  // characters are rejected too, and the result must resolve to this origin.
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/app";
  try {
    const u = new URL(next, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : "/app";
  } catch {
    return "/app";
  }
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  usePageTitle(title);
  return (
    <div className="grid min-h-screen bg-ivory lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-brand-800 p-12 text-white lg:flex lg:flex-col">
        <Logo light />
        <div className="mt-auto max-w-md">
          <p className="font-display text-4xl leading-tight">“Everyone finally knows what's theirs to do.”</p>
          <p className="mt-4 text-white/70">Coordinate care across households, profiles and caregivers — with seniors in control of their own information.</p>
          <ul className="mt-8 space-y-2 text-sm text-white/80">
            {["Tenant-isolated households", "Per-profile, revocable access", "Every change audited"].map((t) => (
              <li key={t} className="flex items-center gap-2"><ShieldCheck className="size-4 text-champagne-300" />{t}</li>
            ))}
          </ul>
        </div>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-600/40 blur-3xl" />
      </aside>
      <main className="relative flex items-center justify-center px-4 py-12 sm:px-8">
        <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="font-display text-3xl text-ink-900">{title}</h1>
          <p className="mt-2 text-ink-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} ref={ref} type={show ? "text" : "password"} className="pr-11" />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-500 hover:bg-sage-100" aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="rounded-xl border border-danger-600/20 bg-danger-50 px-4 py-3 text-sm text-danger-600">{message}</div>;
}

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export function LoginPage() {
  const { login, status } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const next = safeNext(params.get("next"));
  const submitted = useRef(false);

  // Once a submit starts, the handler decides where to go (sign-up goes to "create household");
  // the page can stay mounted during the route transition, so this must not race it.
  if (status === "authenticated" && !submitted.current) return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    submitted.current = true;
    try {
      await login(v.email, v.password);
      navigate(next, { replace: true });
    } catch (e) {
      submitted.current = false;
      setError(errorMessage(e));
    }
  });

  return (
    <AuthLayout title="Welcome back" subtitle={<>New to Chiktsa? <Link className="font-medium text-brand-700 hover:underline" to={`/signup${params.toString() ? `?${params}` : ""}`}>Create an account</Link></>}>
      <DemoAccounts />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={error} />
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register("password")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

const signupSchema = z
  .object({
    displayName: z.string().trim().min(1, "Enter your name").max(120),
    email: z.string().trim().email("Enter a valid email address"),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(128)
      .regex(/[A-Za-z]/, "Include at least one letter")
      .regex(/\d/, "Include at least one number"),
    confirm: z.string(),
    locale: z.enum(["en", "hi"]),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export type SignupValues = z.infer<typeof signupSchema>;
export { signupSchema };

export function SignupPage() {
  const { signup, status } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: "", email: "", password: "", confirm: "", locale: "en" },
  });
  const next = safeNext(params.get("next"));
  const submitted = useRef(false);

  // Once a submit starts, the handler decides where to go (sign-up goes to "create household");
  // the page can stay mounted during the route transition, so this must not race it.
  if (status === "authenticated" && !submitted.current) return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    submitted.current = true;
    try {
      await signup({ email: v.email, password: v.password, displayName: v.displayName, locale: v.locale, timezone: browserTimeZone() });
      navigate(next === "/app" ? "/app/households?new=1" : next, { replace: true });
    } catch (e) {
      submitted.current = false;
      setError(errorMessage(e));
    }
  });

  const e = form.formState.errors;
  return (
    <AuthLayout title="Create your account" subtitle={<>Already have one? <Link className="font-medium text-brand-700 hover:underline" to={`/login${params.toString() ? `?${params}` : ""}`}>Sign in</Link></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError message={error} />
        <Field label="Your name" error={e.displayName?.message}>
          <Input autoComplete="name" {...form.register("displayName")} />
        </Field>
        <Field label="Email" error={e.email?.message} hint="If you were invited, use the same email the invitation was sent to.">
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Password" error={e.password?.message} hint="10+ characters, letters and numbers">
            <PasswordInput autoComplete="new-password" {...form.register("password")} />
          </Field>
          <Field label="Confirm password" error={e.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...form.register("confirm")} />
          </Field>
        </div>
        <Field label="Preferred language">
          <NativeSelect {...form.register("locale")}>
            <option value="en">English</option>
            <option value="hi">हिन्दी (Hindi)</option>
          </NativeSelect>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>Create account</Button>
        <p className="text-center text-xs text-ink-500">Your time zone ({browserTimeZone()}) is detected automatically and can be changed in Settings.</p>
      </form>
    </AuthLayout>
  );
}
