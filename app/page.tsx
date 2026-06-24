import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { count } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Maya Quinn Finance</div>
        <nav className="nav">
          <Link href="/admin">Admin</Link>
        </nav>
      </header>
      <main className="main">
        <section className="hero">
          <div className="eyebrow">Finance content automation</div>
          <h1>Fact-grounded articles with human review before publish.</h1>
          <p>
            The foundation is connected to Supabase, protected by admin auth, and ready for
            topic discovery, research extraction, fact verification, and review workflows.
          </p>
          <div className="actions">
            <Link className="button" href="/admin">
              Open Admin
            </Link>
          </div>
        </section>

        <section className="grid" aria-label="System status">
          <div className="card metric">
            <div className="metric-value">{count ?? 0}</div>
            <div className="metric-label">Published articles visible to anonymous readers</div>
          </div>
          <div className="card metric">
            <div className="metric-value">RLS</div>
            <div className="metric-label">Public reads are limited to published articles</div>
          </div>
          <div className="card metric">
            <div className="metric-value">Magic link</div>
            <div className="metric-label">Admin login uses Supabase Auth email links</div>
          </div>
        </section>
      </main>
    </div>
  );
}
