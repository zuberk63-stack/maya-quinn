import type { User } from "@supabase/supabase-js";

export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAdminEmail(email: string) {
  const adminEmails = getAdminEmails();
  return adminEmails.length > 0 && adminEmails.includes(email.trim().toLowerCase());
}

export function isAdminUser(user: User | null) {
  if (!user?.email) {
    return false;
  }

  const role = user.app_metadata?.role;
  const roles = user.app_metadata?.roles;

  return (
    role === "admin" ||
    (Array.isArray(roles) && roles.includes("admin")) ||
    isAllowedAdminEmail(user.email)
  );
}
