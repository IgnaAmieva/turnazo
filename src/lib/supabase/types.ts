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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          profile_id: string | null
          venue_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          profile_id?: string | null
          venue_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          profile_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_phones: {
        Row: {
          created_at: string
          id: string
          phone: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          phone: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_phones_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          amount_paid: number
          cancel_token: string | null
          court_id: string
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          deposit_amount: number | null
          hold_expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["booking_kind"]
          mp_order_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          period: unknown
          price_total: number | null
          recurring_id: string | null
          source: Database["public"]["Enums"]["booking_source"]
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          venue_id: string
        }
        Insert: {
          amount_paid?: number
          cancel_token?: string | null
          court_id: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          deposit_amount?: number | null
          hold_expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["booking_kind"]
          mp_order_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          period: unknown
          price_total?: number | null
          recurring_id?: string | null
          source?: Database["public"]["Enums"]["booking_source"]
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          venue_id: string
        }
        Update: {
          amount_paid?: number
          cancel_token?: string | null
          court_id?: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          deposit_amount?: number | null
          hold_expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["booking_kind"]
          mp_order_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          period?: unknown
          price_total?: number | null
          recurring_id?: string | null
          source?: Database["public"]["Enums"]["booking_source"]
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      court_hours: {
        Row: {
          close_time: string
          court_id: string
          created_at: string
          id: string
          open_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          close_time: string
          court_id: string
          created_at?: string
          id?: string
          open_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          close_time?: string
          court_id?: string
          created_at?: string
          id?: string
          open_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "court_hours_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      court_prices: {
        Row: {
          court_id: string
          created_at: string
          from_time: string
          id: string
          price: number
          to_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          court_id: string
          created_at?: string
          from_time: string
          id?: string
          price: number
          to_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          court_id?: string
          created_at?: string
          from_time?: string
          id?: string
          price?: number
          to_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "court_prices_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      courts: {
        Row: {
          active: boolean
          covered: boolean
          created_at: string
          format: string | null
          has_locker_room: boolean
          id: string
          lit: boolean
          name: string
          notes: string | null
          slot_minutes: number
          sport_id: string
          surface: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          active?: boolean
          covered?: boolean
          created_at?: string
          format?: string | null
          has_locker_room?: boolean
          id?: string
          lit?: boolean
          name: string
          notes?: string | null
          slot_minutes: number
          sport_id: string
          surface?: string | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          active?: boolean
          covered?: boolean
          created_at?: string
          format?: string | null
          has_locker_room?: boolean
          id?: string
          lit?: boolean
          name?: string
          notes?: string | null
          slot_minutes?: number
          sport_id?: string
          surface?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courts_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      localities: {
        Row: {
          created_at: string
          id: string
          lat: number
          lng: number
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lat: number
          lng: number
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      mp_accounts: {
        Row: {
          access_token_enc: string
          created_at: string
          expires_at: string
          id: string
          mp_email: string | null
          mp_user_id: string
          refresh_token_enc: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          access_token_enc: string
          created_at?: string
          expires_at: string
          id?: string
          mp_email?: string | null
          mp_user_id: string
          refresh_token_enc: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          access_token_enc?: string
          created_at?: string
          expires_at?: string
          id?: string
          mp_email?: string | null
          mp_user_id?: string
          refresh_token_enc?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mp_accounts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          next_attempt_at: string
          payload: Json
          status: Database["public"]["Enums"]["notification_status"]
          type: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          next_attempt_at?: string
          payload?: Json
          status?: Database["public"]["Enums"]["notification_status"]
          type: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          next_attempt_at?: string
          payload?: Json
          status?: Database["public"]["Enums"]["notification_status"]
          type?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          currency: string
          id: string
          mp_order_id: string | null
          mp_payment_id: string
          platform_fee: number
          raw: Json
          status: string
          type: Database["public"]["Enums"]["payment_type"]
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          currency?: string
          id?: string
          mp_order_id?: string | null
          mp_payment_id: string
          platform_fee?: number
          raw?: Json
          status: string
          type: Database["public"]["Enums"]["payment_type"]
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          currency?: string
          id?: string
          mp_order_id?: string | null
          mp_payment_id?: string
          platform_fee?: number
          raw?: Json
          status?: string
          type?: Database["public"]["Enums"]["payment_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_bookings: {
        Row: {
          active: boolean
          court_id: string
          created_at: string
          customer_name: string
          customer_phone: string
          id: string
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          active?: boolean
          court_id: string
          created_at?: string
          customer_name: string
          customer_phone: string
          id?: string
          start_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          active?: boolean
          court_id?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurring_bookings_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      sports: {
        Row: {
          created_at: string
          default_slot_minutes: number
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_slot_minutes: number
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_slot_minutes?: number
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          address: string
          allow_full_payment: boolean
          allow_pay_at_venue: boolean
          cancel_limit_hours: number
          created_at: string
          deposit_required: boolean
          deposit_type: Database["public"]["Enums"]["deposit_type"] | null
          deposit_value: number | null
          id: string
          lat: number
          lng: number
          locality_id: string
          logo_path: string | null
          name: string
          owner_id: string
          payment_alias: string | null
          payment_link: string | null
          phone: string
          refund_policy: Database["public"]["Enums"]["refund_policy"]
          status: Database["public"]["Enums"]["venue_status"]
          updated_at: string
          whatsapp_template: string | null
        }
        Insert: {
          address: string
          allow_full_payment?: boolean
          allow_pay_at_venue?: boolean
          cancel_limit_hours?: number
          created_at?: string
          deposit_required?: boolean
          deposit_type?: Database["public"]["Enums"]["deposit_type"] | null
          deposit_value?: number | null
          id?: string
          lat: number
          lng: number
          locality_id: string
          logo_path?: string | null
          name: string
          owner_id: string
          payment_alias?: string | null
          payment_link?: string | null
          phone: string
          refund_policy?: Database["public"]["Enums"]["refund_policy"]
          status?: Database["public"]["Enums"]["venue_status"]
          updated_at?: string
          whatsapp_template?: string | null
        }
        Update: {
          address?: string
          allow_full_payment?: boolean
          allow_pay_at_venue?: boolean
          cancel_limit_hours?: number
          created_at?: string
          deposit_required?: boolean
          deposit_type?: Database["public"]["Enums"]["deposit_type"] | null
          deposit_value?: number | null
          id?: string
          lat?: number
          lng?: number
          locality_id?: string
          logo_path?: string | null
          name?: string
          owner_id?: string
          payment_alias?: string | null
          payment_link?: string | null
          phone?: string
          refund_policy?: Database["public"]["Enums"]["refund_policy"]
          status?: Database["public"]["Enums"]["venue_status"]
          updated_at?: string
          whatsapp_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_locality_id_fkey"
            columns: ["locality_id"]
            isOneToOne: false
            referencedRelation: "localities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          event_id: string
          id: string
          payload: Json
          processed_at: string
          provider: string
          received_at: string
          status: string
        }
        Insert: {
          event_id: string
          id?: string
          payload?: Json
          processed_at?: string
          provider: string
          received_at?: string
          status?: string
        }
        Update: {
          event_id?: string
          id?: string
          payload?: Json
          processed_at?: string
          provider?: string
          received_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _validate_booking_slot: {
        Args: {
          p_court_id: string
          p_customer_name: string
          p_customer_phone: string
          p_end: string
          p_start: string
          p_venue_id: string
        }
        Returns: {
          error_code: string
          norm_name: string
          norm_phone: string
          price_total: number
          r_allow_full: boolean
          r_allow_pay_venue: boolean
          r_dep_type: string
          r_dep_value: number
          r_deposit_required: boolean
        }[]
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      cancel_booking_by_token: {
        Args: { p_cancel_token: string }
        Returns: Json
      }
      create_booking: {
        Args: {
          p_court_id: string
          p_customer_name: string
          p_customer_phone: string
          p_end: string
          p_start: string
          p_venue_id: string
        }
        Returns: Json
      }
      create_booking_hold: {
        Args: {
          p_court_id: string
          p_customer_name: string
          p_customer_phone: string
          p_end: string
          p_payment_type: string
          p_start: string
          p_venue_id: string
        }
        Returns: Json
      }
      confirm_order_payment: {
        Args: {
          p_booking_id: string
          p_mp_order_id: string
          p_mp_payment_id: string
          p_amount: number
          p_raw?: Json
        }
        Returns: Json
      }
      expire_stale_holds: { Args: never; Returns: undefined }
      get_booking_by_token: { Args: { p_cancel_token: string }; Returns: Json }
      get_court_availability: {
        Args: { p_court_id: string; p_from: string; p_to: string }
        Returns: {
          period: unknown
        }[]
      }
      push_send_cron: { Args: never; Returns: undefined }
    }
    Enums: {
      booking_kind: "booking" | "block"
      booking_source: "app" | "manual"
      booking_status:
        | "hold"
        | "confirmed"
        | "cancelled"
        | "expired"
        | "completed"
        | "no_show"
      deposit_type: "fixed" | "percent"
      notification_status: "pending" | "sent" | "failed" | "discarded"
      payment_status: "unpaid" | "deposit_paid" | "paid" | "refunded"
      payment_type: "deposit" | "full"
      refund_policy: "full" | "none"
      user_role: "owner" | "superadmin"
      venue_status: "pending" | "approved" | "suspended"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      booking_kind: ["booking", "block"],
      booking_source: ["app", "manual"],
      booking_status: [
        "hold",
        "confirmed",
        "cancelled",
        "expired",
        "completed",
        "no_show",
      ],
      deposit_type: ["fixed", "percent"],
      notification_status: ["pending", "sent", "failed", "discarded"],
      payment_status: ["unpaid", "deposit_paid", "paid", "refunded"],
      payment_type: ["deposit", "full"],
      refund_policy: ["full", "none"],
      user_role: ["owner", "superadmin"],
      venue_status: ["pending", "approved", "suspended"],
    },
  },
} as const
