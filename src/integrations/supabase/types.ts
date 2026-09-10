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
      bottleneck_events: {
        Row: {
          affected_orders: number
          average_delay: number
          id: string
          occurrence_count: number
          root_cause: string | null
          root_cause_category: string | null
          severity: string
          shift: string | null
          stage: string
          store_id: string
          time_bucket: string
          zone_id: string
        }
        Insert: {
          affected_orders?: number
          average_delay?: number
          id?: string
          occurrence_count?: number
          root_cause?: string | null
          root_cause_category?: string | null
          severity?: string
          shift?: string | null
          stage: string
          store_id: string
          time_bucket: string
          zone_id: string
        }
        Update: {
          affected_orders?: number
          average_delay?: number
          id?: string
          occurrence_count?: number
          root_cause?: string | null
          root_cause_category?: string | null
          severity?: string
          shift?: string | null
          stage?: string
          store_id?: string
          time_bucket?: string
          zone_id?: string
        }
        Relationships: []
      }
      diagnoses: {
        Row: {
          confidence_score: number
          created_at: string
          id: string
          order_id: string
          recommended_action: string
          resolved: boolean
          root_cause: string
          stage: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          id?: string
          order_id: string
          recommended_action: string
          resolved?: boolean
          root_cause: string
          stage: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          id?: string
          order_id?: string
          recommended_action?: string
          resolved?: boolean
          root_cause?: string
          stage?: string
        }
        Relationships: []
      }
      intervention_revisions: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          intervention_id: string
          previous: Json
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          intervention_id: string
          previous: Json
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          intervention_id?: string
          previous?: Json
        }
        Relationships: [
          {
            foreignKeyName: "intervention_revisions_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
        ]
      }
      interventions: {
        Row: {
          action_at: string
          action_taken: string
          after_sla: number | null
          before_sla: number | null
          created_at: string
          hour: number | null
          id: string
          improvement_abs: number | null
          improvement_pct: number | null
          metric: string
          notes: string | null
          order_id: string | null
          outcome: string
          recommendation: string
          recorded_by: string | null
          root_cause: string | null
          shift: string | null
          signature: string | null
          stage: string | null
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          action_at?: string
          action_taken: string
          after_sla?: number | null
          before_sla?: number | null
          created_at?: string
          hour?: number | null
          id?: string
          improvement_abs?: number | null
          improvement_pct?: number | null
          metric?: string
          notes?: string | null
          order_id?: string | null
          outcome?: string
          recommendation: string
          recorded_by?: string | null
          root_cause?: string | null
          shift?: string | null
          signature?: string | null
          stage?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          action_at?: string
          action_taken?: string
          after_sla?: number | null
          before_sla?: number | null
          created_at?: string
          hour?: number | null
          id?: string
          improvement_abs?: number | null
          improvement_pct?: number | null
          metric?: string
          notes?: string | null
          order_id?: string | null
          outcome?: string
          recommendation?: string
          recorded_by?: string | null
          root_cause?: string | null
          shift?: string | null
          signature?: string | null
          stage?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      inventory: {
        Row: {
          id: string
          reorder_threshold: number
          sku_id: string
          stock_level: number
          zone_id: string
        }
        Insert: {
          id?: string
          reorder_threshold?: number
          sku_id: string
          stock_level?: number
          zone_id: string
        }
        Update: {
          id?: string
          reorder_threshold?: number
          sku_id?: string
          stock_level?: number
          zone_id?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          employee_id: string | null
          employee_role: string | null
          event_type: string
          id: string
          notes: string | null
          order_id: string
          station_id: string | null
          timestamp: string
          zone_id: string | null
        }
        Insert: {
          employee_id?: string | null
          employee_role?: string | null
          event_type: string
          id?: string
          notes?: string | null
          order_id: string
          station_id?: string | null
          timestamp?: string
          zone_id?: string | null
        }
        Update: {
          employee_id?: string | null
          employee_role?: string | null
          event_type?: string
          id?: string
          notes?: string | null
          order_id?: string
          station_id?: string | null
          timestamp?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          created_at: string
          customer_distance_km: number
          delivered_at: string | null
          demo_remaining_minutes: number | null
          id: string
          order_id: string
          promised_delivery_time: string
          status: string
          store_id: string
          total_items: number
        }
        Insert: {
          created_at?: string
          customer_distance_km?: number
          delivered_at?: string | null
          demo_remaining_minutes?: number | null
          id?: string
          order_id: string
          promised_delivery_time: string
          status?: string
          store_id: string
          total_items?: number
        }
        Update: {
          created_at?: string
          customer_distance_km?: number
          delivered_at?: string | null
          demo_remaining_minutes?: number | null
          id?: string
          order_id?: string
          promised_delivery_time?: string
          status?: string
          store_id?: string
          total_items?: number
        }
        Relationships: []
      }
      packing_stations: {
        Row: {
          current_queue_length: number
          id: string
          station_id: string
          status: string
          store_id: string
        }
        Insert: {
          current_queue_length?: number
          id?: string
          station_id: string
          status?: string
          store_id: string
        }
        Update: {
          current_queue_length?: number
          id?: string
          station_id?: string
          status?: string
          store_id?: string
        }
        Relationships: []
      }
      sla_metrics: {
        Row: {
          breach_stage: string | null
          created_at: string
          delivery_duration: number | null
          dispatch_wait: number | null
          id: string
          order_id: string
          pack_duration: number | null
          pick_duration: number | null
          pick_start_delay: number | null
          sla_status: string
          total_duration: number | null
        }
        Insert: {
          breach_stage?: string | null
          created_at?: string
          delivery_duration?: number | null
          dispatch_wait?: number | null
          id?: string
          order_id: string
          pack_duration?: number | null
          pick_duration?: number | null
          pick_start_delay?: number | null
          sla_status?: string
          total_duration?: number | null
        }
        Update: {
          breach_stage?: string | null
          created_at?: string
          delivery_duration?: number | null
          dispatch_wait?: number | null
          id?: string
          order_id?: string
          pack_duration?: number | null
          pick_duration?: number | null
          pick_start_delay?: number | null
          sla_status?: string
          total_duration?: number | null
        }
        Relationships: []
      }
      sla_thresholds: {
        Row: {
          at_risk_remaining_minutes: number
          delivery_base: number
          delivery_per_km: number
          delivery_tolerance: number
          dispatch_max: number
          hour_breach_rate: number
          id: boolean
          low_stock_share: number
          packing_base: number
          packing_per_item: number
          packing_tolerance: number
          pick_start_max: number
          picking_base: number
          picking_per_item: number
          picking_tolerance: number
          station_queue: number
          total_sla_minutes: number
          updated_at: string
          zone_breach_rate: number
        }
        Insert: {
          at_risk_remaining_minutes?: number
          delivery_base?: number
          delivery_per_km?: number
          delivery_tolerance?: number
          dispatch_max?: number
          hour_breach_rate?: number
          id?: boolean
          low_stock_share?: number
          packing_base?: number
          packing_per_item?: number
          packing_tolerance?: number
          pick_start_max?: number
          picking_base?: number
          picking_per_item?: number
          picking_tolerance?: number
          station_queue?: number
          total_sla_minutes?: number
          updated_at?: string
          zone_breach_rate?: number
        }
        Update: {
          at_risk_remaining_minutes?: number
          delivery_base?: number
          delivery_per_km?: number
          delivery_tolerance?: number
          dispatch_max?: number
          hour_breach_rate?: number
          id?: boolean
          low_stock_share?: number
          packing_base?: number
          packing_per_item?: number
          packing_tolerance?: number
          pick_start_max?: number
          picking_base?: number
          picking_per_item?: number
          picking_tolerance?: number
          station_queue?: number
          total_sla_minutes?: number
          updated_at?: string
          zone_breach_rate?: number
        }
        Relationships: []
      }
      workforce: {
        Row: {
          active: boolean
          employee_id: string
          id: string
          joining_date: string
          name: string
          role: string
          shift: string
          zone_id: string
        }
        Insert: {
          active?: boolean
          employee_id: string
          id?: string
          joining_date?: string
          name: string
          role: string
          shift: string
          zone_id: string
        }
        Update: {
          active?: boolean
          employee_id?: string
          id?: string
          joining_date?: string
          name?: string
          role?: string
          shift?: string
          zone_id?: string
        }
        Relationships: []
      }
      workforce_metrics: {
        Row: {
          average_stage_time: number
          date: string
          delay_count: number
          employee_id: string
          id: string
          orders_handled: number
          productivity_score: number
          role: string
          sla_breach_count: number
        }
        Insert: {
          average_stage_time?: number
          date: string
          delay_count?: number
          employee_id: string
          id?: string
          orders_handled?: number
          productivity_score?: number
          role: string
          sla_breach_count?: number
        }
        Update: {
          average_stage_time?: number
          date?: string
          delay_count?: number
          employee_id?: string
          id?: string
          orders_handled?: number
          productivity_score?: number
          role?: string
          sla_breach_count?: number
        }
        Relationships: []
      }
      zones: {
        Row: {
          id: string
          store_id: string
          zone_id: string
          zone_name: string
        }
        Insert: {
          id?: string
          store_id: string
          zone_id: string
          zone_name: string
        }
        Update: {
          id?: string
          store_id?: string
          zone_id?: string
          zone_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      order_event_first: {
        Row: {
          n_created: number | null
          n_delivered: number | null
          n_dispatch: number | null
          n_pack_end: number | null
          n_pack_start: number | null
          n_pick_end: number | null
          n_pick_start: number | null
          order_id: string | null
          t_created: string | null
          t_delivered: string | null
          t_dispatch: string | null
          t_pack_end: string | null
          t_pack_start: string | null
          t_pick_end: string | null
          t_pick_start: string | null
        }
        Relationships: []
      }
      order_event_validation: {
        Row: {
          duplicate_event_types: number | null
          missing_events: string[] | null
          order_id: string | null
          out_of_sequence: boolean | null
        }
        Relationships: []
      }
      order_facts: {
        Row: {
          created_at: string | null
          customer_distance_km: number | null
          delivered_at: string | null
          delivery_duration: number | null
          dispatch_wait: number | null
          order_id: string | null
          pack_duration: number | null
          packer_id: string | null
          pick_duration: number | null
          pick_start_delay: number | null
          picker_id: string | null
          promised_delivery_time: string | null
          rider_id: string | null
          station_id: string | null
          status: string | null
          store_id: string | null
          total_duration: number | null
          total_items: number | null
          zone_id: string | null
        }
        Relationships: []
      }
      order_participants: {
        Row: {
          order_id: string | null
          packer_id: string | null
          picker_id: string | null
          rider_id: string | null
          station_id: string | null
          zone_id: string | null
        }
        Relationships: []
      }
      order_stage_overruns: {
        Row: {
          actual: number | null
          created_at: string | null
          expected: number | null
          hour: number | null
          order_id: string | null
          overrun: number | null
          packer_id: string | null
          picker_id: string | null
          rider_id: string | null
          shift: string | null
          stage: string | null
          station_id: string | null
          store_id: string | null
          threshold: number | null
          zone_id: string | null
        }
        Relationships: []
      }
      order_stage_timings: {
        Row: {
          delivery_duration: number | null
          dispatch_wait: number | null
          order_id: string | null
          pack_duration: number | null
          pick_duration: number | null
          pick_start_delay: number | null
          t_created: string | null
          t_delivered: string | null
          t_dispatch: string | null
          t_pack_end: string | null
          t_pack_start: string | null
          t_pick_end: string | null
          t_pick_start: string | null
          total_duration: number | null
        }
        Relationships: []
      }
      zone_inventory_health: {
        Row: {
          low_stock_skus: number | null
          total_skus: number | null
          zone_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      refresh_demo_live_orders: {
        Args: never
        Returns: {
          events_shifted: number
          orders_shifted: number
        }[]
      }
      stage_expected: {
        Args: { _distance_km: number; _stage: string; _total_items: number }
        Returns: number
      }
      stage_overrun: {
        Args: {
          _actual: number
          _distance_km: number
          _stage: string
          _total_items: number
        }
        Returns: number
      }
      stage_threshold: {
        Args: { _distance_km: number; _stage: string; _total_items: number }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
