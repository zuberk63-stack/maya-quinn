import Link from "next/link";
import { sendMagicLink } from "./actions";

export default function AdminLoginPage({
  searchParams
}: {
  searchParams: { error?: string; sent?: string };
}) {
  const error =
    searchParams.error === "not_allowed"
      ? "That email is not in ADMIN_EMAILS."
      : searchParams.error;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Maya Quinn Finance</div>
        <nav className="nav">
          <Link href="/">Public</Link>
        </nav>
      </header>
      <main className="main">
        <section className="hero">
          <div className="eyebrow">Admin login</div>
          <h1>Sign in with a magic link.</h1>
          <p>
            Only emails listed in <code>ADMIN_EMAILS</code> can request an admin session from this
            app.
          </p>
        </section>

        <form className="card form" action={sendMagicLink}>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" name="email" required autoComplete="email" />
          </label>
          <button className="button" type="submit">
            Send magic link
          </button>
          {searchParams.sent ? (
            <p className="notice">Check your inbox for the Supabase login link.</p>
          ) : null}
          {error ? <p className="notice">{error}</p> : null}
        </form>
      </main>
    </div>
  );
}
