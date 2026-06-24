export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      topics: {
        Row: {
          id: string;
          keyword: string;
          title: string | null;
          slug: string | null;
          category: string | null;
          status: string;
          source: string;
          notes: string | null;
          ai_filter_score: number | null;
          cluster_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["topics"]["Row"]> & { keyword: string };
        Update: Partial<Database["public"]["Tables"]["topics"]["Row"]>;
      };
      research: {
        Row: {
          id: string;
          topic_id: string;
          source_url: string;
          source_name: string | null;
          source_domain: string | null;
          title: string | null;
          summary: string | null;
          raw_content: string | null;
          collected_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["research"]["Row"]> & {
          topic_id: string;
          source_url: string;
        };
        Update: Partial<Database["public"]["Tables"]["research"]["Row"]>;
      };
      articles: {
        Row: {
          id: string;
          topic_id: string | null;
          title: string;
          slug: string;
          postalias: string | null;
          content: string;
          summary: string | null;
          thumbnail: string | null;
          category: string | null;
          tags: string[] | null;
          status: string;
          author_id: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          verification_report: Json | null;
          published_at: string | null;
          views: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["articles"]["Row"]> & {
          title: string;
          slug: string;
          content: string;
        };
        Update: Partial<Database["public"]["Tables"]["articles"]["Row"]>;
      };
      review_queue: {
        Row: {
          id: string;
          article_id: string;
          review_status: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          revision_notes: string | null;
          rejected_reason: string | null;
          revision_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["review_queue"]["Row"]> & { article_id: string };
        Update: Partial<Database["public"]["Tables"]["review_queue"]["Row"]>;
      };
      facts: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      article_facts: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      clusters: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      authors: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      content_refresh_log: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
      cost_tracking: { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
