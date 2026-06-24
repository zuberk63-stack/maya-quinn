import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

const tables = [
  "topics",
  "research",
  "articles",
  "review_queue",
  "facts",
  "clusters",
  "authors",
  "content_refresh_log",
  "cost_tracking"
] as const;

async function tableCount(table: (typeof tables)[number]) {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });

  return {
    table,
    count: error ? null : count,
    error: error?.message
  };
}

export default async function AdminPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!isAdminUser(user)) {
    redirect("/admin/login");
  }

  const counts = await Promise.all(tables.map(tableCount));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Maya Quinn Finance</div>
        <nav className="nav">
          <span>{user?.email}</span>
          <Link href="/admin/logout">Sign out</Link>
        </nav>
      </header>
      <main className="main">
        <section className="hero">
          <div className="eyebrow">Admin foundation</div>
          <h1>Database, auth, and review guardrails are ready.</h1>
          <p>
            This dashboard verifies the authenticated admin session can read the protected
            automation tables through Supabase RLS.
          </p>
        </section>

        <div className="card">
          <h2>Table status</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Rows</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((item) => (
                <tr key={item.table}>
                  <td>{item.table}</td>
                  <td>{item.count ?? "-"}</td>
                  <td>{item.error ?? "Readable by admin session"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
