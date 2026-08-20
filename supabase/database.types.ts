export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          entry_id: string | null
          id: string
          new_team_abbr: string | null
          old_team_abbr: string | null
          pool_id: string
          reason: string | null
          slot: number | null
          target_user_id: string
          week: number
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          entry_id?: string | null
          id?: string
          new_team_abbr?: string | null
          old_team_abbr?: string | null
          pool_id: string
          reason?: string | null
          slot?: number | null
          target_user_id: string
          week: number
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          entry_id?: string | null
          id?: string
          new_team_abbr?: string | null
          old_team_abbr?: string | null
          pool_id?: string
          reason?: string | null
          slot?: number | null
          target_user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_actions_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "admin_actions_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      app_event_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          message: string | null
          metadata: Json
          pool_id: string | null
          route: string | null
          severity: string
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          message?: string | null
          metadata?: Json
          pool_id?: string | null
          route?: string | null
          severity?: string
          source?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          message?: string | null
          metadata?: Json
          pool_id?: string | null
          route?: string | null
          severity?: string
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_event_logs_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_event_logs_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "app_event_logs_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_categories: {
        Row: {
          created_at: string
          created_by: string | null
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      blog_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          profile_id: string
          reaction: string
          updated_at: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          profile_id: string
          reaction: string
          updated_at?: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          profile_id?: string
          reaction?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "blog_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_comment_reports: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          profile_id: string
          reason: string | null
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          profile_id: string
          reason?: string | null
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          profile_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_comment_reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "blog_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_comments: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          parent_comment_id: string | null
          post_slug: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_comment_id?: string | null
          post_slug: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_comment_id?: string | null
          post_slug?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "blog_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_permissions: {
        Row: {
          created_at: string
          profile_id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          author_id: string | null
          author_name: string
          category: string
          created_at: string
          description: string
          hero_image_url: string | null
          id: string
          pinned: boolean
          published_at: string | null
          read_time: string
          sections: Json
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string
          category: string
          created_at?: string
          description: string
          hero_image_url?: string | null
          id?: string
          pinned?: boolean
          published_at?: string | null
          read_time?: string
          sections?: Json
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string
          category?: string
          created_at?: string
          description?: string
          hero_image_url?: string | null
          id?: string
          pinned?: boolean
          published_at?: string | null
          read_time?: string
          sections?: Json
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      emails_log: {
        Row: {
          id: number
          meta: Json | null
          pool_id: string | null
          profile_id: string | null
          sent_at: string
          template: string
          to_email: string
        }
        Insert: {
          id?: number
          meta?: Json | null
          pool_id?: string | null
          profile_id?: string | null
          sent_at?: string
          template: string
          to_email: string
        }
        Update: {
          id?: number
          meta?: Json | null
          pool_id?: string | null
          profile_id?: string | null
          sent_at?: string
          template?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "emails_log_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_log_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "emails_log_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entries: {
        Row: {
          created_at: string
          eliminated: boolean
          id: string
          label: string
          pool_id: string
          profile_id: string
          strikes: number
        }
        Insert: {
          created_at?: string
          eliminated?: boolean
          id?: string
          label?: string
          pool_id: string
          profile_id: string
          strikes?: number
        }
        Update: {
          created_at?: string
          eliminated?: boolean
          id?: string
          label?: string
          pool_id?: string
          profile_id?: string
          strikes?: number
        }
        Relationships: [
          {
            foreignKeyName: "entries_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "entries_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          code: string
          created_at: string
          created_by: string
          email: string | null
          expires_at: string | null
          id: string
          pool_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          email?: string | null
          expires_at?: string | null
          id?: string
          pool_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          pool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "invites_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_rate_limit_buckets: {
        Row: {
          bucket_start: string
          fingerprint: string
          request_count: number
          updated_at: string
        }
        Insert: {
          bucket_start: string
          fingerprint: string
          request_count?: number
          updated_at?: string
        }
        Update: {
          bucket_start?: string
          fingerprint?: string
          request_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      nfl_games: {
        Row: {
          away_score: number | null
          away_team: string
          created_at: string
          espn_event_id: string
          game_time: string
          home_score: number | null
          home_team: string
          id: string
          kickoff_at_utc: string | null
          kickoff_confirmed: boolean
          provider_last_seen_at: string | null
          provider_result_first_seen_at: string | null
          provider_result_signature: string | null
          result_confirmed_at: string | null
          season: number
          status: string
          week: number
          winner: string | null
        }
        Insert: {
          away_score?: number | null
          away_team: string
          created_at?: string
          espn_event_id: string
          game_time: string
          home_score?: number | null
          home_team: string
          id?: string
          kickoff_at_utc?: string | null
          kickoff_confirmed?: boolean
          provider_last_seen_at?: string | null
          provider_result_first_seen_at?: string | null
          provider_result_signature?: string | null
          result_confirmed_at?: string | null
          season: number
          status?: string
          week: number
          winner?: string | null
        }
        Update: {
          away_score?: number | null
          away_team?: string
          created_at?: string
          espn_event_id?: string
          game_time?: string
          home_score?: number | null
          home_team?: string
          id?: string
          kickoff_at_utc?: string | null
          kickoff_confirmed?: boolean
          provider_last_seen_at?: string | null
          provider_result_first_seen_at?: string | null
          provider_result_signature?: string | null
          result_confirmed_at?: string | null
          season?: number
          status?: string
          week?: number
          winner?: string | null
        }
        Relationships: []
      }
      payments_log: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: number
          note: string | null
          pool_id: string
          profile_id: string | null
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: number
          note?: string | null
          pool_id: string
          profile_id?: string | null
          status?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: number
          note?: string | null
          pool_id?: string
          profile_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_log_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_log_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "payments_log_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_save_events: {
        Row: {
          action: string
          actor_user_id: string | null
          applicable_deadline_at: string | null
          created_at: string
          entry_id: string | null
          id: string
          locked_at: string | null
          new_result: string | null
          new_team_abbr: string | null
          old_result: string | null
          old_team_abbr: string | null
          pool_id: string
          result: string | null
          rules_snapshot: Json | null
          server_effective_at: string | null
          slot: number
          source_table: string
          submission_evidence_source: string | null
          submitted_at: string | null
          user_id: string | null
          week: number
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          applicable_deadline_at?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          locked_at?: string | null
          new_result?: string | null
          new_team_abbr?: string | null
          old_result?: string | null
          old_team_abbr?: string | null
          pool_id: string
          result?: string | null
          rules_snapshot?: Json | null
          server_effective_at?: string | null
          slot?: number
          source_table: string
          submission_evidence_source?: string | null
          submitted_at?: string | null
          user_id?: string | null
          week: number
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          applicable_deadline_at?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          locked_at?: string | null
          new_result?: string | null
          new_team_abbr?: string | null
          old_result?: string | null
          old_team_abbr?: string | null
          pool_id?: string
          result?: string | null
          rules_snapshot?: Json | null
          server_effective_at?: string | null
          slot?: number
          source_table?: string
          submission_evidence_source?: string | null
          submitted_at?: string | null
          user_id?: string | null
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "pick_save_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_save_events_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_save_events_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "pick_save_events_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_save_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      picks: {
        Row: {
          created_at: string
          entry_id: string
          game_id: string | null
          id: string
          kickoff_at: string | null
          locked: boolean
          result: string
          team: string
          week: number
        }
        Insert: {
          created_at?: string
          entry_id: string
          game_id?: string | null
          id?: string
          kickoff_at?: string | null
          locked?: boolean
          result?: string
          team: string
          week: number
        }
        Update: {
          created_at?: string
          entry_id?: string
          game_id?: string | null
          id?: string
          kickoff_at?: string | null
          locked?: boolean
          result?: string
          team?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "picks_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nfl_games"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_dispute_events: {
        Row: {
          actor_user_id: string | null
          applicable_deadline_at: string | null
          details: Json
          entry_id: string | null
          event_type: string
          id: string
          occurred_at: string
          pool_id: string
          server_effective_at: string | null
          slot: number | null
          source_event_id: string | null
          source_table: string | null
          subject_user_id: string | null
          summary: string
          week: number | null
        }
        Insert: {
          actor_user_id?: string | null
          applicable_deadline_at?: string | null
          details?: Json
          entry_id?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          pool_id: string
          server_effective_at?: string | null
          slot?: number | null
          source_event_id?: string | null
          source_table?: string | null
          subject_user_id?: string | null
          summary: string
          week?: number | null
        }
        Update: {
          actor_user_id?: string | null
          applicable_deadline_at?: string | null
          details?: Json
          entry_id?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          pool_id?: string
          server_effective_at?: string | null
          slot?: number | null
          source_event_id?: string | null
          source_table?: string | null
          subject_user_id?: string | null
          summary?: string
          week?: number | null
        }
        Relationships: []
      }
      pool_entry_survival_graces: {
        Row: {
          created_at: string
          entry_id: string
          pool_id: string
          strike_credits: number
          week: number
        }
        Insert: {
          created_at?: string
          entry_id: string
          pool_id: string
          strike_credits: number
          week: number
        }
        Update: {
          created_at?: string
          entry_id?: string
          pool_id?: string
          strike_credits?: number
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "pool_entry_survival_graces_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "pool_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_entry_survival_graces_entry_pool_fkey"
            columns: ["pool_id", "entry_id"]
            isOneToOne: false
            referencedRelation: "pool_members"
            referencedColumns: ["pool_id", "id"]
          },
          {
            foreignKeyName: "pool_entry_survival_graces_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_entry_survival_graces_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "pool_entry_survival_graces_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_entry_week_history: {
        Row: {
          eliminated: boolean
          eliminated_week: number | null
          entry_id: string
          entry_name_snapshot: string | null
          entry_number: number
          is_complete: boolean
          losses: number
          mulligans_applied: number
          mulligans_remaining: number
          picks_snapshot: Json
          pool_id: string
          pushes: number
          recorded_at: string
          revised_at: string
          revision: number
          rules_snapshot: Json
          strikes_used: number
          survival_credits: number
          used_teams: string[]
          week: number
          wins: number
        }
        Insert: {
          eliminated: boolean
          eliminated_week?: number | null
          entry_id: string
          entry_name_snapshot?: string | null
          entry_number: number
          is_complete?: boolean
          losses: number
          mulligans_applied: number
          mulligans_remaining: number
          picks_snapshot?: Json
          pool_id: string
          pushes: number
          recorded_at?: string
          revised_at?: string
          revision?: number
          rules_snapshot: Json
          strikes_used: number
          survival_credits: number
          used_teams?: string[]
          week: number
          wins: number
        }
        Update: {
          eliminated?: boolean
          eliminated_week?: number | null
          entry_id?: string
          entry_name_snapshot?: string | null
          entry_number?: number
          is_complete?: boolean
          losses?: number
          mulligans_applied?: number
          mulligans_remaining?: number
          picks_snapshot?: Json
          pool_id?: string
          pushes?: number
          recorded_at?: string
          revised_at?: string
          revision?: number
          rules_snapshot?: Json
          strikes_used?: number
          survival_credits?: number
          used_teams?: string[]
          week?: number
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "pool_entry_week_history_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_entry_week_history_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "pool_entry_week_history_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_member_stats: {
        Row: {
          eliminated: boolean
          eliminated_week: number | null
          entry_id: string
          losses: number
          pool_id: string
          pushes: number
          strikes_used: number
          updated_at: string
          user_id: string
          wins: number
        }
        Insert: {
          eliminated?: boolean
          eliminated_week?: number | null
          entry_id: string
          losses?: number
          pool_id: string
          pushes?: number
          strikes_used?: number
          updated_at?: string
          user_id: string
          wins?: number
        }
        Update: {
          eliminated?: boolean
          eliminated_week?: number | null
          entry_id?: string
          losses?: number
          pool_id?: string
          pushes?: number
          strikes_used?: number
          updated_at?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "pool_member_stats_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "pool_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_member_stats_entry_owner_fkey"
            columns: ["pool_id", "entry_id", "user_id"]
            isOneToOne: false
            referencedRelation: "pool_members"
            referencedColumns: ["pool_id", "id", "profile_id"]
          },
          {
            foreignKeyName: "pool_member_stats_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_member_stats_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "pool_member_stats_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_member_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_members: {
        Row: {
          eliminated_week: number | null
          entry_count: string | null
          entry_name: string | null
          entry_number: number
          id: string
          joined_at: string | null
          lives_remaining: number | null
          pool_id: string
          profile_id: string
          role: Database["public"]["Enums"]["member_role"]
          status: string
        }
        Insert: {
          eliminated_week?: number | null
          entry_count?: string | null
          entry_name?: string | null
          entry_number?: number
          id?: string
          joined_at?: string | null
          lives_remaining?: number | null
          pool_id: string
          profile_id: string
          role?: Database["public"]["Enums"]["member_role"]
          status?: string
        }
        Update: {
          eliminated_week?: number | null
          entry_count?: string | null
          entry_name?: string | null
          entry_number?: number
          id?: string
          joined_at?: string | null
          lives_remaining?: number | null
          pool_id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pool_members_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_members_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "pool_members_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_members_user_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_name_blocks: {
        Row: {
          created_at: string
          id: number
          reason: string | null
          term: string
        }
        Insert: {
          created_at?: string
          id?: number
          reason?: string | null
          term: string
        }
        Update: {
          created_at?: string
          id?: number
          reason?: string | null
          term?: string
        }
        Relationships: []
      }
      pool_pick_drafts: {
        Row: {
          entry_id: string
          pool_id: string
          slot: number
          team_abbr: string
          updated_at: string
          user_id: string
          week: number
        }
        Insert: {
          entry_id: string
          pool_id: string
          slot?: number
          team_abbr: string
          updated_at?: string
          user_id: string
          week: number
        }
        Update: {
          entry_id?: string
          pool_id?: string
          slot?: number
          team_abbr?: string
          updated_at?: string
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "pool_pick_drafts_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "pool_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_pick_drafts_entry_owner_fkey"
            columns: ["pool_id", "entry_id", "user_id"]
            isOneToOne: false
            referencedRelation: "pool_members"
            referencedColumns: ["pool_id", "id", "profile_id"]
          },
          {
            foreignKeyName: "pool_pick_drafts_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_pick_drafts_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "pool_pick_drafts_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_pick_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_picks: {
        Row: {
          adjudicated_at: string | null
          applicable_deadline_at: string | null
          created_at: string
          entry_id: string
          locked_at: string
          pool_id: string
          result: string | null
          rules_snapshot: Json | null
          slot: number
          submission_evidence_source: string | null
          submitted_at: string | null
          team_abbr: string
          user_id: string
          week: number
        }
        Insert: {
          adjudicated_at?: string | null
          applicable_deadline_at?: string | null
          created_at?: string
          entry_id: string
          locked_at: string
          pool_id: string
          result?: string | null
          rules_snapshot?: Json | null
          slot?: number
          submission_evidence_source?: string | null
          submitted_at?: string | null
          team_abbr: string
          user_id: string
          week: number
        }
        Update: {
          adjudicated_at?: string | null
          applicable_deadline_at?: string | null
          created_at?: string
          entry_id?: string
          locked_at?: string
          pool_id?: string
          result?: string | null
          rules_snapshot?: Json | null
          slot?: number
          submission_evidence_source?: string | null
          submitted_at?: string | null
          team_abbr?: string
          user_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "pool_picks_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "pool_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_picks_entry_owner_fkey"
            columns: ["pool_id", "entry_id", "user_id"]
            isOneToOne: false
            referencedRelation: "pool_members"
            referencedColumns: ["pool_id", "id", "profile_id"]
          },
          {
            foreignKeyName: "pool_picks_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_picks_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "pool_picks_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pool_picks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pool_roster_removal_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          drafts_removed: number
          entries_removed: number
          entry_id: string | null
          id: string
          locked_picks_removed: number
          pool_id: string
          removal_type: string
          subject_user_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          drafts_removed: number
          entries_removed: number
          entry_id?: string | null
          id?: string
          locked_picks_removed: number
          pool_id: string
          removal_type: string
          subject_user_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          drafts_removed?: number
          entries_removed?: number
          entry_id?: string | null
          id?: string
          locked_picks_removed?: number
          pool_id?: string
          removal_type?: string
          subject_user_id?: string | null
        }
        Relationships: []
      }
      pools: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          activation_status: string
          allow_discovery: boolean
          allow_multiple_entries: boolean
          archived: boolean
          archived_at: string | null
          cloned_from_pool_id: string | null
          created_at: string | null
          created_by: string
          deadline: Database["public"]["Enums"]["pick_deadline"]
          deadline_fixed: string
          deadline_mode: string
          double_pick_weeks: number[]
          id: string
          image_url: string | null
          include_playoffs: boolean
          is_public: boolean
          join_password_hash: string | null
          max_entries_per_user: number
          max_members: number
          mulligans: number
          name: string
          name_normalized: string | null
          notes: string | null
          password_hash: string | null
          payment_status: string
          pick_privacy: string
          pinned_rank: number | null
          plan: string
          private_password_hash: string | null
          season: number
          sponsored_until: string | null
          start_week: number
          strikes_allowed: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          test_current_week: number | null
          test_mode: boolean
          test_now_at: string | null
          tie_rule: string
          ties: Database["public"]["Enums"]["ties_rule"]
          visibility: Database["public"]["Enums"]["pool_visibility"]
          winner_user_id: string | null
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          activation_status?: string
          allow_discovery?: boolean
          allow_multiple_entries?: boolean
          archived?: boolean
          archived_at?: string | null
          cloned_from_pool_id?: string | null
          created_at?: string | null
          created_by: string
          deadline?: Database["public"]["Enums"]["pick_deadline"]
          deadline_fixed: string
          deadline_mode: string
          double_pick_weeks?: number[]
          id?: string
          image_url?: string | null
          include_playoffs?: boolean
          is_public?: boolean
          join_password_hash?: string | null
          max_entries_per_user?: number
          max_members?: number
          mulligans?: number
          name: string
          name_normalized?: string | null
          notes?: string | null
          password_hash?: string | null
          payment_status?: string
          pick_privacy?: string
          pinned_rank?: number | null
          plan?: string
          private_password_hash?: string | null
          season: number
          sponsored_until?: string | null
          start_week?: number
          strikes_allowed: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          test_current_week?: number | null
          test_mode?: boolean
          test_now_at?: string | null
          tie_rule: string
          ties?: Database["public"]["Enums"]["ties_rule"]
          visibility?: Database["public"]["Enums"]["pool_visibility"]
          winner_user_id?: string | null
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          activation_status?: string
          allow_discovery?: boolean
          allow_multiple_entries?: boolean
          archived?: boolean
          archived_at?: string | null
          cloned_from_pool_id?: string | null
          created_at?: string | null
          created_by?: string
          deadline?: Database["public"]["Enums"]["pick_deadline"]
          deadline_fixed?: string
          deadline_mode?: string
          double_pick_weeks?: number[]
          id?: string
          image_url?: string | null
          include_playoffs?: boolean
          is_public?: boolean
          join_password_hash?: string | null
          max_entries_per_user?: number
          max_members?: number
          mulligans?: number
          name?: string
          name_normalized?: string | null
          notes?: string | null
          password_hash?: string | null
          payment_status?: string
          pick_privacy?: string
          pinned_rank?: number | null
          plan?: string
          private_password_hash?: string | null
          season?: number
          sponsored_until?: string | null
          start_week?: number
          strikes_allowed?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          test_current_week?: number | null
          test_mode?: boolean
          test_now_at?: string | null
          tie_rule?: string
          ties?: Database["public"]["Enums"]["ties_rule"]
          visibility?: Database["public"]["Enums"]["pool_visibility"]
          winner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pools_winner_user_id_fkey"
            columns: ["winner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_private: {
        Row: {
          email: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          email?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          email?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_private_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          favorite_team: string | null
          first_name: string | null
          id: string
          last_name: string | null
          updated_at: string
          User_name: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          favorite_team?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          updated_at?: string
          User_name: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          favorite_team?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          updated_at?: string
          User_name?: string
          username?: string | null
        }
        Relationships: []
      }
      profiles_private: {
        Row: {
          email: string
          id: string
          updated_at: string | null
        }
        Insert: {
          email: string
          id: string
          updated_at?: string | null
        }
        Update: {
          email?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles_public: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          username?: string | null
        }
        Relationships: []
      }
      season_weeks: {
        Row: {
          season: number
          week: number
          week_sunday_date: string
        }
        Insert: {
          season: number
          week: number
          week_sunday_date: string
        }
        Update: {
          season?: number
          week?: number
          week_sunday_date?: string
        }
        Relationships: []
      }
      security_rate_limit_events: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json
          subject: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json
          subject?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json
          subject?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      test_pool_playoff_games: {
        Row: {
          away_team: string
          created_at: string
          home_team: string
          kickoff_at: string
          pool_id: string
          slot: number
          status: string
          updated_at: string
          week: number
        }
        Insert: {
          away_team: string
          created_at?: string
          home_team: string
          kickoff_at: string
          pool_id: string
          slot: number
          status?: string
          updated_at?: string
          week: number
        }
        Update: {
          away_team?: string
          created_at?: string
          home_team?: string
          kickoff_at?: string
          pool_id?: string
          slot?: number
          status?: string
          updated_at?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_pool_playoff_games_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_pool_playoff_games_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "test_pool_playoff_games_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      test_pool_team_results: {
        Row: {
          created_by: string | null
          pool_id: string
          result: string
          team_abbr: string
          updated_at: string
          week: number
        }
        Insert: {
          created_by?: string | null
          pool_id: string
          result: string
          team_abbr: string
          updated_at?: string
          week: number
        }
        Update: {
          created_by?: string | null
          pool_id?: string
          result?: string
          team_abbr?: string
          updated_at?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_pool_team_results_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_pool_team_results_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_pool_team_results_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pool_history"
            referencedColumns: ["pool_id"]
          },
          {
            foreignKeyName: "test_pool_team_results_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "v_my_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      user_operation_results: {
        Row: {
          created_at: string
          operation_id: string
          operation_type: string
          result_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          operation_id: string
          operation_type: string
          result_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          operation_id?: string
          operation_type?: string
          result_id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      team_week_kickoff: {
        Row: {
          kickoff_at_utc: string | null
          season: number | null
          team_abbr: string | null
          week: number | null
        }
        Relationships: []
      }
      v_my_pool_history: {
        Row: {
          archived: boolean | null
          eliminated: boolean | null
          eliminated_week: number | null
          losses: number | null
          pool_id: string | null
          pool_name: string | null
          pushes: number | null
          season: number | null
          status: string | null
          strikes_used: number | null
          wins: number | null
        }
        Relationships: []
      }
      v_my_pools: {
        Row: {
          allow_discovery: boolean | null
          archived_at: string | null
          created_at: string | null
          created_by: string | null
          deadline: Database["public"]["Enums"]["pick_deadline"] | null
          deadline_fixed: string | null
          deadline_mode: string | null
          double_pick_weeks: number[] | null
          id: string | null
          include_playoffs: boolean | null
          is_public: boolean | null
          join_password_hash: string | null
          mulligans: number | null
          name: string | null
          notes: string | null
          password_hash: string | null
          pick_privacy: string | null
          plan: string | null
          profile_id: string | null
          start_week: number | null
          strikes_allowed: string | null
          tie_rule: string | null
          ties: Database["public"]["Enums"]["ties_rule"] | null
          visibility: Database["public"]["Enums"]["pool_visibility"] | null
        }
        Relationships: [
          {
            foreignKeyName: "pool_members_user_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acquire_all_pool_entry_pick_locks: {
        Args: { p_pool_id: string }
        Returns: undefined
      }
      acquire_pool_entry_pick_lock: {
        Args: { p_entry_id: string; p_pool_id: string }
        Returns: undefined
      }
      acquire_pool_workflow_lock: {
        Args: { p_pool_id: string }
        Returns: undefined
      }
      add_pool_entry: { Args: { p_pool_id: string }; Returns: string }
      add_pool_entry_idempotent: {
        Args: { p_operation_id: string; p_pool_id: string }
        Returns: string
      }
      adjudicate_completed_weeks: {
        Args: { p_season: number }
        Returns: number
      }
      adjudicate_results: {
        Args: { p_season: number; p_week: number }
        Returns: number
      }
      adjudicate_results_concurrency_internal: {
        Args: { p_season: number; p_week: number }
        Returns: number
      }
      admin_archive_pool: {
        Args: { p_archived: boolean; p_pool_id: string }
        Returns: undefined
      }
      admin_can_manage: { Args: { p_pool_id: string }; Returns: boolean }
      admin_clear_entry_week_draft_slot: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_reason?: string
          p_slot?: number
          p_week: number
        }
        Returns: undefined
      }
      admin_override_entry_final_pick: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_reason?: string
          p_slot?: number
          p_team_abbr: string
          p_week: number
        }
        Returns: undefined
      }
      admin_override_entry_final_pick_concurrency_internal: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_reason?: string
          p_slot?: number
          p_team_abbr: string
          p_week: number
        }
        Returns: undefined
      }
      admin_pool_entry_audit: {
        Args: { p_pool_id: string }
        Returns: {
          display_name: string
          draft_team_abbr: string
          draft_updated_at: string
          eliminated_week: number
          entry_id: string
          entry_number: number
          final_team_abbr: string
          issue: string
          locked_at: string
          pick_state: string
          result: string
          slot: number
          status_after_week: string
          strikes_after_week: number
          strikes_left_after_week: number
          user_id: string
          week: number
        }[]
      }
      admin_pool_entry_audit_unredacted_internal: {
        Args: { p_pool_id: string }
        Returns: {
          display_name: string
          draft_team_abbr: string
          draft_updated_at: string
          eliminated_week: number
          entry_id: string
          entry_number: number
          final_team_abbr: string
          issue: string
          locked_at: string
          pick_state: string
          result: string
          slot: number
          status_after_week: string
          strikes_after_week: number
          strikes_left_after_week: number
          user_id: string
          week: number
        }[]
      }
      admin_pool_entry_week_overview: {
        Args: { p_pool_id: string; p_week: number }
        Returns: {
          display_name: string
          draft_team_abbr: string
          draft_updated_at: string
          eliminated: boolean
          eliminated_week: number
          entry_id: string
          entry_name: string
          entry_number: number
          final_team_abbr: string
          joined_at: string
          locked_at: string
          losses: number
          pushes: number
          result: string
          role: string
          slot: number
          strikes_used: number
          user_id: string
          wins: number
        }[]
      }
      admin_pool_entry_week_overview_unredacted_internal: {
        Args: { p_pool_id: string; p_week: number }
        Returns: {
          display_name: string
          draft_team_abbr: string
          draft_updated_at: string
          eliminated: boolean
          eliminated_week: number
          entry_id: string
          entry_name: string
          entry_number: number
          final_team_abbr: string
          joined_at: string
          locked_at: string
          losses: number
          pushes: number
          result: string
          role: string
          slot: number
          strikes_used: number
          user_id: string
          wins: number
        }[]
      }
      admin_pool_scoring_integrity: {
        Args: { p_pool_id: string }
        Returns: {
          check_name: string
          detail: string
          issue_count: number
          status: string
        }[]
      }
      admin_pool_scoring_integrity_pre_clarified_rules: {
        Args: { p_pool_id: string }
        Returns: {
          check_name: string
          detail: string
          issue_count: number
          status: string
        }[]
      }
      admin_remove_member: {
        Args: { p_pool_id: string; p_profile_id: string }
        Returns: undefined
      }
      admin_remove_pool_entry: {
        Args: { p_entry_id: string; p_pool_id: string }
        Returns: undefined
      }
      admin_remove_pool_member: {
        Args: { p_pool_id: string; p_profile_id: string }
        Returns: number
      }
      admin_repair_pool_scoring_state: {
        Args: { p_pool_id: string }
        Returns: string
      }
      admin_set_double_weeks: {
        Args: { p_pool_id: string; p_weeks: number[] }
        Returns: undefined
      }
      admin_update_pool_core_rules: {
        Args: {
          p_deadline_mode: string
          p_include_playoffs: boolean
          p_notes?: string
          p_pool_id: string
          p_start_week: number
          p_strikes_allowed: number
          p_tie_rule: string
        }
        Returns: undefined
      }
      admin_update_pool_entry_settings: {
        Args: {
          p_allow_multiple_entries: boolean
          p_max_entries_per_user: number
          p_pool_id: string
        }
        Returns: undefined
      }
      admin_update_pool_image: {
        Args: { p_image_url: string; p_pool_id: string }
        Returns: undefined
      }
      admin_update_pool_member_limit: {
        Args: { p_max_members?: number; p_pool_id: string }
        Returns: undefined
      }
      admin_update_pool_member_limit_finite_internal: {
        Args: { p_max_members: number; p_pool_id: string }
        Returns: undefined
      }
      admin_update_pool_visibility: {
        Args: { p_is_public: boolean; p_password?: string; p_pool_id: string }
        Returns: undefined
      }
      admin_update_pool_visibility_validated_internal: {
        Args: { p_is_public: boolean; p_password?: string; p_pool_id: string }
        Returns: undefined
      }
      admin_upsert_entry_draft: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_reason?: string
          p_slot?: number
          p_team_abbr: string
          p_week: number
        }
        Returns: undefined
      }
      assert_action_rate_limit: {
        Args: {
          p_action: string
          p_max_attempts: number
          p_metadata?: Json
          p_subject?: string
          p_window_seconds: number
        }
        Returns: undefined
      }
      assert_user_email_confirmed: {
        Args: { p_action?: string }
        Returns: undefined
      }
      auto_archive_completed_pools: { Args: never; Returns: number }
      backfill_eliminated_week: { Args: never; Returns: number }
      blog_add_category: { Args: { p_name: string }; Returns: string }
      blog_comment_moderation_queue: {
        Args: never
        Returns: {
          author_name: string
          avatar_url: string
          body: string
          created_at: string
          down_count: number
          id: string
          latest_report_at: string
          parent_comment_id: string
          post_slug: string
          profile_id: string
          report_count: number
          up_count: number
        }[]
      }
      blog_comments_for_post: {
        Args: { p_post_slug: string }
        Returns: {
          author_name: string
          avatar_url: string
          body: string
          created_at: string
          down_count: number
          id: string
          parent_comment_id: string
          post_slug: string
          profile_id: string
          up_count: number
          updated_at: string
          viewer_reaction: string
        }[]
      }
      blog_delete_comment: { Args: { p_comment_id: string }; Returns: string }
      blog_delete_own_comment: {
        Args: { p_comment_id: string }
        Returns: string
      }
      blog_delete_post: { Args: { p_id: string }; Returns: string }
      blog_engagement_for_posts: {
        Args: { p_post_slugs: string[] }
        Returns: {
          comment_count: number
          down_count: number
          post_slug: string
          up_count: number
        }[]
      }
      blog_permission_overview: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          profile_id: string
          role: string
        }[]
      }
      blog_report_comment: { Args: { p_comment_id: string }; Returns: string }
      blog_save_post: {
        Args: {
          p_author_name?: string
          p_category?: string
          p_description?: string
          p_hero_image_url?: string
          p_id?: string
          p_pinned?: boolean
          p_sections?: Json
          p_slug?: string
          p_status?: string
          p_title?: string
        }
        Returns: Json
      }
      blog_set_comment_reaction: {
        Args: { p_comment_id: string; p_reaction: string }
        Returns: string
      }
      blog_submit_comment: {
        Args: {
          p_body: string
          p_parent_comment_id?: string
          p_post_slug: string
        }
        Returns: string
      }
      can_manage_blog: { Args: never; Returns: boolean }
      clean_public_image_url: { Args: { p_url: string }; Returns: string }
      clear_entry_draft_pick: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_slot: number
          p_week: number
        }
        Returns: undefined
      }
      clear_entry_draft_pick_unserialized: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_slot: number
          p_week: number
        }
        Returns: undefined
      }
      clear_entry_draft_pick_with_receipt: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_slot: number
          p_week: number
        }
        Returns: {
          applicable_deadline_at: string
          error_message: string
          saved_at: string
          success: boolean
        }[]
      }
      clone_pool_for_new_season: {
        Args: { p_new_season: number; p_old_pool_id: string }
        Returns: string
      }
      commissioner_dispute_history: {
        Args: { p_entry_id?: string; p_limit?: number; p_pool_id: string }
        Returns: {
          actor_name: string
          applicable_deadline_at: string
          details: Json
          entry_id: string
          entry_label: string
          event_at: string
          event_id: string
          event_type: string
          server_effective_at: string
          slot: number
          subject_name: string
          summary: string
          week: number
        }[]
      }
      commissioner_dispute_history_unredacted_internal: {
        Args: { p_entry_id?: string; p_limit?: number; p_pool_id: string }
        Returns: {
          actor_name: string
          applicable_deadline_at: string
          details: Json
          entry_id: string
          entry_label: string
          event_at: string
          event_id: string
          event_type: string
          server_effective_at: string
          slot: number
          subject_name: string
          summary: string
          week: number
        }[]
      }
      consume_monitoring_rate_limit: {
        Args: {
          p_fingerprint: string
          p_limit?: number
          p_window_seconds?: number
        }
        Returns: boolean
      }
      count_pool_entries: { Args: { p_pool_id: string }; Returns: number }
      count_pool_members: { Args: { p_pool_id: string }; Returns: number }
      create_pool_with_owner: {
        Args: {
          p_allow_multiple_entries?: boolean
          p_deadline_fixed?: string
          p_deadline_mode?: string
          p_double_pick_weeks?: number[]
          p_image_url?: string
          p_include_playoffs?: boolean
          p_is_public?: boolean
          p_max_entries_per_user?: number
          p_max_members?: number
          p_name: string
          p_notes?: string
          p_password?: string
          p_season?: number
          p_start_week?: number
          p_strikes_allowed?: string
          p_tie_rule?: string
        }
        Returns: string
      }
      create_pool_with_owner_idempotent: {
        Args: {
          p_allow_multiple_entries?: boolean
          p_deadline_fixed?: string
          p_deadline_mode?: string
          p_double_pick_weeks?: number[]
          p_image_url?: string
          p_include_playoffs?: boolean
          p_is_public?: boolean
          p_max_entries_per_user?: number
          p_max_members?: number
          p_name: string
          p_notes?: string
          p_operation_id: string
          p_password?: string
          p_season?: number
          p_start_week?: number
          p_strikes_allowed?: string
          p_tie_rule?: string
        }
        Returns: string
      }
      create_pool_with_owner_validated_internal: {
        Args: {
          p_allow_multiple_entries?: boolean
          p_deadline_fixed?: string
          p_deadline_mode?: string
          p_double_pick_weeks?: number[]
          p_image_url?: string
          p_include_playoffs?: boolean
          p_is_public?: boolean
          p_max_entries_per_user?: number
          p_max_members?: number
          p_name: string
          p_notes?: string
          p_password?: string
          p_season?: number
          p_start_week?: number
          p_strikes_allowed?: string
          p_tie_rule?: string
        }
        Returns: string
      }
      current_blog_role: { Args: never; Returns: string }
      current_user_email_confirmed: { Args: never; Returns: boolean }
      finalize_locked_picks: {
        Args: { p_pool_id: string; p_week: number }
        Returns: number
      }
      finalize_locked_picks_concurrency_internal: {
        Args: { p_pool_id: string; p_week: number }
        Returns: number
      }
      finalize_locked_picks_for_pool: {
        Args: { p_pool_id: string }
        Returns: number
      }
      finalize_locked_picks_for_pool_concurrency_internal: {
        Args: { p_pool_id: string }
        Returns: number
      }
      finalize_no_pick_losses: {
        Args: { p_pool_id: string; p_week: number }
        Returns: number
      }
      finalize_no_pick_losses_concurrency_internal: {
        Args: { p_pool_id: string; p_week: number }
        Returns: number
      }
      finalize_picks_week: {
        Args: { p_pool_id: string; p_week: number }
        Returns: number
      }
      finalize_week_picks: {
        Args: { p_pool: string; p_week: number }
        Returns: number
      }
      get_my_account: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
        }[]
      }
      get_my_pool_history: {
        Args: never
        Returns: {
          eliminated_week: number
          losses: number
          pool_id: string
          pool_name: string
          pushes: number
          season: number
          status: string
          strikes_used: number
          wins: number
        }[]
      }
      get_my_profile: {
        Args: never
        Returns: {
          avatar_url: string
          email: string
          first_name: string
          id: string
          last_name: string
          username: string
        }[]
      }
      get_pool_invite: {
        Args: { p_pool_id: string }
        Returns: {
          activation_status: string
          created_by: string
          deadline_fixed: string
          deadline_mode: string
          entry_count: number
          id: string
          include_playoffs: boolean
          is_public: boolean
          join_allowed: boolean
          max_members: number
          member_count: number
          name: string
          notes: string
          season: number
          start_week: number
          strikes_allowed: number
          test_current_week: number
          test_mode: boolean
          tie_rule: string
        }[]
      }
      grant_blog_permission: {
        Args: { p_email: string; p_role?: string }
        Returns: string
      }
      is_blog_superadmin: { Args: never; Returns: boolean }
      is_pool_member: { Args: { p: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      join_pool: {
        Args: { p_password?: string; p_pool_id: string; p_token?: string }
        Returns: undefined
      }
      join_pool_validated_internal: {
        Args: { p_password?: string; p_pool_id: string; p_token?: string }
        Returns: undefined
      }
      leave_pool: { Args: { p_pool_id: string }; Returns: undefined }
      list_pool_members: {
        Args: { p_pool_id: string }
        Returns: {
          profile_id: string
        }[]
      }
      log_security_event: {
        Args: {
          p_event_type: string
          p_message?: string
          p_metadata?: Json
          p_pool_id?: string
          p_severity?: string
        }
        Returns: undefined
      }
      my_operation_result: {
        Args: { p_operation_id: string; p_operation_type: string }
        Returns: string
      }
      normalize_username: { Args: { p_username: string }; Returns: string }
      pick_deadline_has_passed: {
        Args: { p_deadline_at: string; p_pool_id: string; p_week?: number }
        Returns: boolean
      }
      picks_allowed: {
        Args: { p_pool_id: string; p_week: number }
        Returns: number
      }
      pool_competition_is_complete: {
        Args: { p_pool_id: string }
        Returns: boolean
      }
      pool_effective_now: { Args: { p_pool_id: string }; Returns: string }
      pool_entry_roster: {
        Args: { p_pool_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          entry_id: string
          entry_name: string
          entry_number: number
          first_name: string
          joined_at: string
          last_name: string
          profile_id: string
          role: string
          status: string
          username: string
        }[]
      }
      pool_has_declared_winner: {
        Args: { p_pool_id: string }
        Returns: boolean
      }
      pool_has_started: { Args: { p_pool_id: string }; Returns: boolean }
      pool_lifecycle_status: {
        Args: { p_pool_id: string }
        Returns: {
          alive_entries: number
          archive_allowed: boolean
          current_week: number
          description: string
          entry_creation_allowed: boolean
          final_week: number
          join_allowed: boolean
          label: string
          phase: string
          pick_submission_allowed: boolean
          pool_id: string
          result_processing_pending: boolean
          settings_editable: boolean
          starts_at: string
          total_entries: number
        }[]
      }
      pool_max_pick_week: { Args: { p_pool_id: string }; Returns: number }
      pool_member_roster: {
        Args: { p_pool_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          first_name: string
          joined_at: string
          last_name: string
          profile_id: string
          role: string
          status: string
          username: string
        }[]
      }
      pool_member_summaries: {
        Args: { p_pool_ids: string[] }
        Returns: {
          alive_entries: number
          alive_members: number
          pool_id: string
          total_entries: number
          total_members: number
        }[]
      }
      pool_open_pick_week: { Args: { p_pool_id: string }; Returns: number }
      pool_pick_phase: { Args: { p_week: number }; Returns: string }
      pool_reinvite_overview: {
        Args: { p_pool_id: string }
        Returns: {
          avatar_url: string
          current_entry_count: number
          display_name: string
          joined_new_pool: boolean
          previous_entry_count: number
          previous_role: string
          profile_id: string
          source_pool_id: string
          source_pool_name: string
          username: string
        }[]
      }
      pool_standings_snapshot: {
        Args: { p_pool_id: string; p_week: number }
        Returns: {
          completion: Json
          games: Json
          history_picks: Json
          stats: Json
          visible_picks: Json
        }[]
      }
      pool_start_at: { Args: { p_pool_id: string }; Returns: string }
      pool_test_clock_at: {
        Args: { p_pool_id: string; p_stage: string; p_week: number }
        Returns: string
      }
      pool_visible_picks: {
        Args: { p_pool_id: string; p_through_week?: boolean; p_week?: number }
        Returns: {
          entry_id: string
          locked_at: string
          result: string
          slot: number
          team_abbr: string
          user_id: string
          week: number
        }[]
      }
      pool_week_deadline_at: {
        Args: { p_pool_id: string; p_week: number }
        Returns: string
      }
      pool_week_games: {
        Args: { p_pool_id: string; p_week: number }
        Returns: {
          away_score: number
          away_team: string
          game_time: string
          home_score: number
          home_team: string
          id: string
          is_test_game: boolean
          kickoff_at_utc: string
          season: number
          status: string
          week: number
          winner: string
        }[]
      }
      pool_week_grading_complete: {
        Args: { p_pool_id: string; p_week: number }
        Returns: boolean
      }
      pool_week_pick_completion: {
        Args: { p_pool_id: string; p_week: number }
        Returns: {
          active_entries: number
          complete_entries: number
          made_slots: number
          missing_slots: number
          partial_entries: number
          pool_id: string
          required_slots: number
          week: number
        }[]
      }
      pool_winner_decided_week: { Args: { p_pool_id: string }; Returns: number }
      pool_winner_status: {
        Args: { p_pool_id: string }
        Returns: {
          alive_entries: number
          alive_members: number
          decided_week: number
          is_decided: boolean
          total_entries: number
          total_members: number
          winner_avatar_url: string
          winner_name: string
          winner_user_id: string
        }[]
      }
      pool_wipeout_survival_credits: {
        Args: { p_pool_id: string; p_week: number }
        Returns: {
          entry_id: string
          strike_credits: number
          week: number
        }[]
      }
      prune_picks_after_elimination: {
        Args: { p_pool_id?: string }
        Returns: number
      }
      prune_pool_picks_after_winner: {
        Args: { p_pool_id: string }
        Returns: number
      }
      rebuild_pool_member_stats: {
        Args: { p_pool_id: string }
        Returns: number
      }
      rebuild_pool_member_stats_concurrency_internal: {
        Args: { p_pool_id: string }
        Returns: number
      }
      refresh_pool_week_history: {
        Args: { p_pool_id: string }
        Returns: number
      }
      remove_pool_entry: {
        Args: { p_entry_id: string; p_pool_id: string }
        Returns: undefined
      }
      restore_unlocked_picks_for_pool: {
        Args: { p_pool_id: string }
        Returns: number
      }
      sanitize_pool_week_used_teams: {
        Args: { p_pool_id: string }
        Returns: number
      }
      save_entry_draft_pick: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_slot: number
          p_team_abbr: string
          p_week: number
        }
        Returns: undefined
      }
      save_entry_draft_pick_unserialized: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_slot: number
          p_team_abbr: string
          p_week: number
        }
        Returns: undefined
      }
      save_entry_draft_pick_with_receipt: {
        Args: {
          p_entry_id: string
          p_pool_id: string
          p_slot: number
          p_team_abbr: string
          p_week: number
        }
        Returns: {
          applicable_deadline_at: string
          error_message: string
          saved_at: string
          success: boolean
        }[]
      }
      search_pools: {
        Args: { p_term: string }
        Returns: {
          activation_status: string
          allow_discovery: boolean
          already_joined: boolean
          created_at: string
          deadline_fixed: string
          deadline_mode: string
          entry_count: number
          id: string
          include_playoffs: boolean
          is_public: boolean
          max_members: number
          member_count: number
          name: string
          notes: string
          owned_by_me: boolean
          start_week: number
          strikes_allowed: string
          tie_rule: string
        }[]
      }
      set_pool_password: {
        Args: { p_plain: string; p_pool_id: string }
        Returns: undefined
      }
      superadmin_app_event_logs: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          event_type: string
          id: string
          message: string
          metadata: Json
          pool_id: string
          route: string
          severity: string
          source: string
          user_id: string
        }[]
      }
      superadmin_assert_current_test_week: {
        Args: { p_pool_id: string; p_week: number }
        Returns: undefined
      }
      superadmin_assert_test_pool: {
        Args: { p_pool_id: string }
        Returns: undefined
      }
      superadmin_clear_test_week_results: {
        Args: { p_pool_id: string; p_week: number }
        Returns: string
      }
      superadmin_cron_health: {
        Args: never
        Returns: {
          current_cadence: string
          expected_every_minutes: number
          fallback_every_minutes: number
          health_note: string
          job_name: string
          last_error_at: string
          last_run_at: string
          last_success_at: string
          latest_message: string
          latest_metadata: Json
          latest_severity: string
          live_every_minutes: number
          live_next_expected_at: string
          minutes_since_success: number
          next_expected_at: string
          route: string
          status: string
        }[]
      }
      superadmin_ensure_test_pool_playoff_games: {
        Args: { p_pool_id: string }
        Returns: number
      }
      superadmin_finalize_test_locked_picks: {
        Args: { p_pool_id: string; p_week: number }
        Returns: number
      }
      superadmin_finalize_test_week_drafts: {
        Args: { p_pool_id: string; p_week: number }
        Returns: number
      }
      superadmin_foundation_integrity_audit: {
        Args: { p_season?: number }
        Returns: {
          check_name: string
          detail: string
          status: string
        }[]
      }
      superadmin_override_test_pool_week: {
        Args: { p_pool_id: string; p_reason: string; p_week: number }
        Returns: string
      }
      superadmin_pool_entries: {
        Args: { p_pool_id: string }
        Returns: {
          display_name: string
          draft_picks_count: number
          eliminated: boolean
          eliminated_week: number
          email: string
          entry_id: string
          entry_number: number
          final_picks_count: number
          joined_at: string
          losses: number
          profile_id: string
          pushes: number
          role: string
          status: string
          strikes_used: number
          wins: number
        }[]
      }
      superadmin_pool_overview: {
        Args: never
        Returns: {
          activation_status: string
          allow_multiple_entries: boolean
          archived: boolean
          created_at: string
          created_by: string
          draft_picks_count: number
          entries_count: number
          final_picks_count: number
          is_public: boolean
          lifecycle_label: string
          lifecycle_phase: string
          max_entries_per_user: number
          max_members: number
          name: string
          owner_email: string
          payment_status: string
          pool_id: string
          season: number
          start_week: number
          stats_rows_count: number
          test_current_week: number
          test_mode: boolean
          test_now_at: string
          unique_members_count: number
        }[]
      }
      superadmin_user_overview: {
        Args: never
        Returns: {
          display_name: string
          email: string
          entries_count: number
          last_sign_in_at: string | null
          latest_pool_created_at: string | null
          pools_created: number
          pools_joined: number
          profile_id: string
          signed_up_at: string | null
        }[]
      }
      superadmin_randomize_test_week_outcomes: {
        Args: { p_pool_id: string; p_week: number }
        Returns: string
      }
      superadmin_randomize_test_week_picks: {
        Args: { p_pool_id: string; p_week: number }
        Returns: string
      }
      superadmin_rebuild_test_pool_stats: {
        Args: { p_pool_id: string }
        Returns: undefined
      }
      superadmin_repair_pool_future_results: {
        Args: { p_pool_id: string }
        Returns: string
      }
      superadmin_reset_test_pool: {
        Args: { p_pool_id: string }
        Returns: string
      }
      superadmin_schedule_integrity_audit: {
        Args: { p_season?: number }
        Returns: {
          duplicate_event_count: number
          duplicate_team_count: number
          final_missing_winner_count: number
          future_pick_result_count: number
          future_result_count: number
          game_count: number
          invalid_winner_count: number
          issue_count: number
          season: number
          team_appearance_count: number
          week: number
        }[]
      }
      superadmin_score_feed_health: {
        Args: { p_season?: number }
        Returns: {
          final_games: number
          final_missing_winner_count: number
          in_progress_games: number
          issue_count: number
          latest_final_kickoff_at: string
          latest_kickoff_at: string
          latest_sync_at: string
          missing_scores: number
          scheduled_games: number
          season: number
          stale_games: number
          total_games: number
          week: number
        }[]
      }
      superadmin_score_test_pool_week: {
        Args: { p_pool_id: string; p_week: number }
        Returns: string
      }
      superadmin_score_test_pool_week_concurrency_internal: {
        Args: { p_pool_id: string; p_week: number }
        Returns: string
      }
      superadmin_security_audit: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          status: string
        }[]
      }
      superadmin_set_pool_test_mode: {
        Args: { p_enabled: boolean; p_pool_id: string }
        Returns: string
      }
      superadmin_set_test_game_outcome: {
        Args: {
          p_away_team: string
          p_home_team: string
          p_outcome: string
          p_pool_id: string
          p_week: number
        }
        Returns: string
      }
      superadmin_set_test_pool_clock: {
        Args: { p_pool_id: string; p_stage?: string; p_week: number }
        Returns: string
      }
      superadmin_set_test_pool_week: {
        Args: { p_pool_id: string; p_week: number }
        Returns: string
      }
      superadmin_set_test_team_result: {
        Args: {
          p_pool_id: string
          p_result: string
          p_team_abbr: string
          p_week: number
        }
        Returns: string
      }
      superadmin_test_pool_week_options: {
        Args: { p_pool_id: string; p_week: number }
        Returns: {
          away_pick_count: number
          away_team: string
          fake_outcome: string
          game_id: string
          game_time: string
          home_pick_count: number
          home_team: string
          needs_outcome: boolean
          season: number
          total_pick_count: number
          week: number
        }[]
      }
      test_pool_game_outcome: {
        Args: {
          p_away_team: string
          p_home_team: string
          p_pool_id: string
          p_week: number
        }
        Returns: string
      }
      update_my_profile: {
        Args: {
          p_avatar_url?: string
          p_favorite_team?: string
          p_first_name?: string
          p_last_name?: string
          p_username?: string
        }
        Returns: undefined
      }
      username_available: { Args: { p_username: string }; Returns: boolean }
    }
    Enums: {
      member_role: "member" | "admin"
      pick_deadline: "1pm_et" | "kickoff"
      pool_visibility: "public" | "private"
      ties_rule: "win" | "loss" | "push"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      member_role: ["member", "admin"],
      pick_deadline: ["1pm_et", "kickoff"],
      pool_visibility: ["public", "private"],
      ties_rule: ["win", "loss", "push"],
    },
  },
} as const
