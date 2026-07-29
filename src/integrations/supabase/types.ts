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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_kind: string
          actor_user_id: string | null
          created_at: string
          detail: Json
          entity_id: string | null
          entity_type: string | null
          id: string
        }
        Insert: {
          action: string
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
        }
        Relationships: []
      }
      candles_cache: {
        Row: {
          candle_time_utc: string
          close: number
          fetched_at: string
          high: number
          id: string
          instrument: string
          low: number
          open: number
          timeframe: string
          volume: number | null
        }
        Insert: {
          candle_time_utc: string
          close: number
          fetched_at?: string
          high: number
          id?: string
          instrument: string
          low: number
          open: number
          timeframe: string
          volume?: number | null
        }
        Update: {
          candle_time_utc?: string
          close?: number
          fetched_at?: string
          high?: number
          id?: string
          instrument?: string
          low?: number
          open?: number
          timeframe?: string
          volume?: number | null
        }
        Relationships: []
      }
      daily_alert_counters: {
        Row: {
          actionable_count: number
          max_allowed: number
          tier: string
          trading_day_utc: string
          updated_at: string
        }
        Insert: {
          actionable_count?: number
          max_allowed?: number
          tier?: string
          trading_day_utc: string
          updated_at?: string
        }
        Update: {
          actionable_count?: number
          max_allowed?: number
          tier?: string
          trading_day_utc?: string
          updated_at?: string
        }
        Relationships: []
      }
      instruments: {
        Row: {
          aliases: string[]
          base_currency: string | null
          broker_symbol: string | null
          contract_size: number | null
          created_at: string
          digits: number | null
          display_name: string | null
          enabled: boolean
          id: string
          max_data_age_seconds: number | null
          max_spread: number | null
          min_rr: number
          note: string | null
          point_size: number | null
          quote_currency: string | null
          sessions: string[]
          sort_order: number
          symbol: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          base_currency?: string | null
          broker_symbol?: string | null
          contract_size?: number | null
          created_at?: string
          digits?: number | null
          display_name?: string | null
          enabled?: boolean
          id?: string
          max_data_age_seconds?: number | null
          max_spread?: number | null
          min_rr?: number
          note?: string | null
          point_size?: number | null
          quote_currency?: string | null
          sessions?: string[]
          sort_order?: number
          symbol: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          base_currency?: string | null
          broker_symbol?: string | null
          contract_size?: number | null
          created_at?: string
          digits?: number | null
          display_name?: string | null
          enabled?: boolean
          id?: string
          max_data_age_seconds?: number | null
          max_spread?: number | null
          min_rr?: number
          note?: string | null
          point_size?: number | null
          quote_currency?: string | null
          sessions?: string[]
          sort_order?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          invited_user_id: string | null
          note: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          invited_user_id?: string | null
          note?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          invited_user_id?: string | null
          note?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      macro_events: {
        Row: {
          created_at: string
          currency: string | null
          event_time_utc: string
          id: string
          impact: string
          lockout_end_utc: string | null
          lockout_start_utc: string | null
          symbols: string[]
          title: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          event_time_utc: string
          id?: string
          impact?: string
          lockout_end_utc?: string | null
          lockout_start_utc?: string | null
          symbols?: string[]
          title: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          event_time_utc?: string
          id?: string
          impact?: string
          lockout_end_utc?: string | null
          lockout_start_utc?: string | null
          symbols?: string[]
          title?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          signal_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          signal_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          signal_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          alert_tiers_email: string[]
          alert_tiers_push: string[]
          alert_tiers_terminal: string[]
          created_at: string
          display_name: string | null
          email_alerts_enabled: boolean
          id: string
          push_alerts_enabled: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          alert_tiers_email?: string[]
          alert_tiers_push?: string[]
          alert_tiers_terminal?: string[]
          created_at?: string
          display_name?: string | null
          email_alerts_enabled?: boolean
          id: string
          push_alerts_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          alert_tiers_email?: string[]
          alert_tiers_push?: string[]
          alert_tiers_terminal?: string[]
          created_at?: string
          display_name?: string | null
          email_alerts_enabled?: boolean
          id?: string
          push_alerts_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rulebook_versions: {
        Row: {
          author: string | null
          change_summary: string | null
          checksum: string | null
          created_at: string
          effective_from: string
          id: string
          is_active: boolean
          retired_at: string | null
          rules: Json
          status: string
          summary: string | null
          version: string
        }
        Insert: {
          author?: string | null
          change_summary?: string | null
          checksum?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          is_active?: boolean
          retired_at?: string | null
          rules?: Json
          status?: string
          summary?: string | null
          version: string
        }
        Update: {
          author?: string | null
          change_summary?: string | null
          checksum?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          is_active?: boolean
          retired_at?: string | null
          rules?: Json
          status?: string
          summary?: string | null
          version?: string
        }
        Relationships: []
      }
      scanner_errors: {
        Row: {
          created_at: string
          detail: Json
          error_code: string
          id: string
          instrument: string | null
          message: string
          occurred_at: string
          scanner_run_id: string | null
          stage: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          error_code: string
          id?: string
          instrument?: string | null
          message: string
          occurred_at?: string
          scanner_run_id?: string | null
          stage: string
        }
        Update: {
          created_at?: string
          detail?: Json
          error_code?: string
          id?: string
          instrument?: string | null
          message?: string
          occurred_at?: string
          scanner_run_id?: string | null
          stage?: string
        }
        Relationships: []
      }
      scanner_locks: {
        Row: {
          expires_at: string
          holder: string | null
          lock_key: string
          locked_at: string
        }
        Insert: {
          expires_at: string
          holder?: string | null
          lock_key: string
          locked_at?: string
        }
        Update: {
          expires_at?: string
          holder?: string | null
          lock_key?: string
          locked_at?: string
        }
        Relationships: []
      }
      scanner_runs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          rejections: Json
          rulebook_checksum: string | null
          rulebook_version: string | null
          signals_emitted: number
          started_at: string
          status: string
          symbols_scanned: string[]
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          rejections?: Json
          rulebook_checksum?: string | null
          rulebook_version?: string | null
          signals_emitted?: number
          started_at?: string
          status?: string
          symbols_scanned?: string[]
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          rejections?: Json
          rulebook_checksum?: string | null
          rulebook_version?: string | null
          signals_emitted?: number
          started_at?: string
          status?: string
          symbols_scanned?: string[]
        }
        Relationships: []
      }
      scanner_settings: {
        Row: {
          id: boolean
          max_daily_alerts: number
          min_rr: number
          rulebook_version: string | null
          scanning_enabled: boolean
          shadow_mode: boolean
          updated_at: string
        }
        Insert: {
          id?: boolean
          max_daily_alerts?: number
          min_rr?: number
          rulebook_version?: string | null
          scanning_enabled?: boolean
          shadow_mode?: boolean
          updated_at?: string
        }
        Update: {
          id?: boolean
          max_daily_alerts?: number
          min_rr?: number
          rulebook_version?: string | null
          scanning_enabled?: boolean
          shadow_mode?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      signal_candidates: {
        Row: {
          atr: number | null
          bias: string | null
          broker_symbol: string | null
          candle_time_utc: string | null
          created_at: string
          direction: string | null
          entry_zone_high: number | null
          entry_zone_low: number | null
          evaluated_at_utc: string
          fingerprint: string | null
          gate_results: Json
          grade: Database["public"]["Enums"]["signal_grade"] | null
          id: string
          instrument: string
          promoted_signal_id: string | null
          qualified: boolean
          reasons: Json
          rr_tp1: number | null
          rulebook_checksum: string | null
          rulebook_version: string | null
          scanner_run_id: string | null
          score: number | null
          score_components: Json
          setup_type: string | null
          shadow_mode: boolean
          spread: number | null
          stop_loss: number | null
          targets: Json
          timeframe: string | null
          trading_day_utc: string
        }
        Insert: {
          atr?: number | null
          bias?: string | null
          broker_symbol?: string | null
          candle_time_utc?: string | null
          created_at?: string
          direction?: string | null
          entry_zone_high?: number | null
          entry_zone_low?: number | null
          evaluated_at_utc?: string
          fingerprint?: string | null
          gate_results?: Json
          grade?: Database["public"]["Enums"]["signal_grade"] | null
          id?: string
          instrument: string
          promoted_signal_id?: string | null
          qualified?: boolean
          reasons?: Json
          rr_tp1?: number | null
          rulebook_checksum?: string | null
          rulebook_version?: string | null
          scanner_run_id?: string | null
          score?: number | null
          score_components?: Json
          setup_type?: string | null
          shadow_mode?: boolean
          spread?: number | null
          stop_loss?: number | null
          targets?: Json
          timeframe?: string | null
          trading_day_utc?: string
        }
        Update: {
          atr?: number | null
          bias?: string | null
          broker_symbol?: string | null
          candle_time_utc?: string | null
          created_at?: string
          direction?: string | null
          entry_zone_high?: number | null
          entry_zone_low?: number | null
          evaluated_at_utc?: string
          fingerprint?: string | null
          gate_results?: Json
          grade?: Database["public"]["Enums"]["signal_grade"] | null
          id?: string
          instrument?: string
          promoted_signal_id?: string | null
          qualified?: boolean
          reasons?: Json
          rr_tp1?: number | null
          rulebook_checksum?: string | null
          rulebook_version?: string | null
          scanner_run_id?: string | null
          score?: number | null
          score_components?: Json
          setup_type?: string | null
          shadow_mode?: boolean
          spread?: number | null
          stop_loss?: number | null
          targets?: Json
          timeframe?: string | null
          trading_day_utc?: string
        }
        Relationships: []
      }
      signal_decisions: {
        Row: {
          created_at: string
          decided_at: string
          decision: Database["public"]["Enums"]["decision_type"]
          id: string
          note: string | null
          signal_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string
          decision: Database["public"]["Enums"]["decision_type"]
          id?: string
          note?: string | null
          signal_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string
          decision?: Database["public"]["Enums"]["decision_type"]
          id?: string
          note?: string | null
          signal_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_decisions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_rejections: {
        Row: {
          candidate_id: string | null
          created_at: string
          detail: Json
          gate_code: string
          id: string
          instrument: string
          reason: string
          scanner_run_id: string | null
          timeframe: string | null
          trading_day_utc: string
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string
          detail?: Json
          gate_code: string
          id?: string
          instrument: string
          reason: string
          scanner_run_id?: string | null
          timeframe?: string | null
          trading_day_utc?: string
        }
        Update: {
          candidate_id?: string | null
          created_at?: string
          detail?: Json
          gate_code?: string
          id?: string
          instrument?: string
          reason?: string
          scanner_run_id?: string | null
          timeframe?: string | null
          trading_day_utc?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_rejections_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "signal_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          broker_symbol: string | null
          candidate_id: string | null
          created_at: string
          direction: string
          entry_zone_high: number | null
          entry_zone_low: number | null
          expires_at_utc: string | null
          external_id: string | null
          fingerprint: string | null
          grade: Database["public"]["Enums"]["signal_grade"] | null
          id: string
          instrument: string
          invalidation: string | null
          is_actionable: boolean
          macro_context: Json
          reasons: Json
          rejection_reasons: Json
          rr_tp1: number | null
          rulebook_checksum: string | null
          rulebook_version: string | null
          scanner_run_id: string | null
          score: number | null
          score_components: Json
          setup_type: string | null
          shadow_mode: boolean
          signal_time_utc: string
          spread: number | null
          status: string
          stop_loss: number | null
          targets: Json
          timeframe: string | null
          trading_day_utc: string
        }
        Insert: {
          broker_symbol?: string | null
          candidate_id?: string | null
          created_at?: string
          direction: string
          entry_zone_high?: number | null
          entry_zone_low?: number | null
          expires_at_utc?: string | null
          external_id?: string | null
          fingerprint?: string | null
          grade?: Database["public"]["Enums"]["signal_grade"] | null
          id?: string
          instrument: string
          invalidation?: string | null
          is_actionable?: boolean
          macro_context?: Json
          reasons?: Json
          rejection_reasons?: Json
          rr_tp1?: number | null
          rulebook_checksum?: string | null
          rulebook_version?: string | null
          scanner_run_id?: string | null
          score?: number | null
          score_components?: Json
          setup_type?: string | null
          shadow_mode?: boolean
          signal_time_utc?: string
          spread?: number | null
          status?: string
          stop_loss?: number | null
          targets?: Json
          timeframe?: string | null
          trading_day_utc?: string
        }
        Update: {
          broker_symbol?: string | null
          candidate_id?: string | null
          created_at?: string
          direction?: string
          entry_zone_high?: number | null
          entry_zone_low?: number | null
          expires_at_utc?: string | null
          external_id?: string | null
          fingerprint?: string | null
          grade?: Database["public"]["Enums"]["signal_grade"] | null
          id?: string
          instrument?: string
          invalidation?: string | null
          is_actionable?: boolean
          macro_context?: Json
          reasons?: Json
          rejection_reasons?: Json
          rr_tp1?: number | null
          rulebook_checksum?: string | null
          rulebook_version?: string | null
          scanner_run_id?: string | null
          score?: number | null
          score_components?: Json
          setup_type?: string | null
          shadow_mode?: boolean
          signal_time_utc?: string
          spread?: number | null
          status?: string
          stop_loss?: number | null
          targets?: Json
          timeframe?: string | null
          trading_day_utc?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_scanner_run_id_fkey"
            columns: ["scanner_run_id"]
            isOneToOne: false
            referencedRelation: "scanner_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_heartbeats: {
        Row: {
          detail: Json
          id: string
          mt5_connected: boolean | null
          received_at: string
          rulebook_version: string | null
          source: string
          status: string
        }
        Insert: {
          detail?: Json
          id?: string
          mt5_connected?: boolean | null
          received_at?: string
          rulebook_version?: string | null
          source: string
          status: string
        }
        Update: {
          detail?: Json
          id?: string
          mt5_connected?: boolean | null
          received_at?: string
          rulebook_version?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      trade_events: {
        Row: {
          created_at: string
          detail: string | null
          event_type: string
          id: string
          occurred_at: string
          trade_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          trade_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_events_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          actual_entry: number | null
          actual_stop: number | null
          closed_at: string | null
          created_at: string
          direction: string
          entry_price: number | null
          exit_price: number | null
          followed_plan: boolean | null
          grade: Database["public"]["Enums"]["signal_grade"] | null
          id: string
          instrument: string
          mae_r: number | null
          mfe_r: number | null
          mistake_tags: string[]
          notes: string | null
          opened_at: string
          outcome: string | null
          partial_exits: Json
          planned_entry: number | null
          planned_stop: number | null
          r_multiple: number | null
          result_cash: number | null
          risk_amount: number | null
          session: string | null
          setup_type: string | null
          signal_id: string | null
          status: string
          stop_price: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_entry?: number | null
          actual_stop?: number | null
          closed_at?: string | null
          created_at?: string
          direction: string
          entry_price?: number | null
          exit_price?: number | null
          followed_plan?: boolean | null
          grade?: Database["public"]["Enums"]["signal_grade"] | null
          id?: string
          instrument: string
          mae_r?: number | null
          mfe_r?: number | null
          mistake_tags?: string[]
          notes?: string | null
          opened_at?: string
          outcome?: string | null
          partial_exits?: Json
          planned_entry?: number | null
          planned_stop?: number | null
          r_multiple?: number | null
          result_cash?: number | null
          risk_amount?: number | null
          session?: string | null
          setup_type?: string | null
          signal_id?: string | null
          status?: string
          stop_price?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_entry?: number | null
          actual_stop?: number | null
          closed_at?: string | null
          created_at?: string
          direction?: string
          entry_price?: number | null
          exit_price?: number | null
          followed_plan?: boolean | null
          grade?: Database["public"]["Enums"]["signal_grade"] | null
          id?: string
          instrument?: string
          mae_r?: number | null
          mfe_r?: number | null
          mistake_tags?: string[]
          notes?: string | null
          opened_at?: string
          outcome?: string | null
          partial_exits?: Json
          planned_entry?: number | null
          planned_stop?: number | null
          r_multiple?: number | null
          result_cash?: number | null
          risk_amount?: number | null
          session?: string | null
          setup_type?: string | null
          signal_id?: string | null
          status?: string
          stop_price?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_scanner_lock: {
        Args: { _holder?: string; _key: string; _ttl_seconds?: number }
        Returns: boolean
      }
      claim_actionable_slot: {
        Args: { _day: string; _max?: number; _tier?: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      purge_scanner_diagnostics: {
        Args: {
          retain_candidates?: string
          retain_errors?: string
          retain_rejections?: string
          retain_runs?: string
        }
        Returns: Json
      }
      release_scanner_lock: { Args: { _key: string }; Returns: undefined }
    }
    Enums: {
      app_role: "owner" | "admin" | "trader"
      decision_type: "TAKEN" | "SKIPPED" | "EXPIRED" | "INVALIDATED"
      signal_grade: "A_PLUS" | "A" | "B" | "C"
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
      app_role: ["owner", "admin", "trader"],
      decision_type: ["TAKEN", "SKIPPED", "EXPIRED", "INVALIDATED"],
      signal_grade: ["A_PLUS", "A", "B", "C"],
    },
  },
} as const
