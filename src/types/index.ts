export interface Trip {
  id: string
  name: string
  description: string
  base_currency: string
  invite_code: string
  pin_hash: string | null
  created_at: string
  archived_at: string | null
}

export interface Member {
  id: string
  trip_id: string
  auth_uid: string
  name: string
  color: string
  is_admin: boolean
  claimed: boolean
  member_token: string
  avatar_style: string
  avatar_seed: number
  group_id: string | null
  joined_at: string
  deleted_at: string | null
}

export interface Deposit {
  id: string
  trip_id: string
  member_id: string
  amount: number
  currency: string
  rate_to_base: number
  note: string
  created_at: string
  deleted_at: string | null
  version: number
}

export interface Expense {
  id: string
  trip_id: string
  member_id: string
  amount: number
  currency: string
  rate_to_base: number
  category: string
  description: string
  date: string
  split_type: 'equal' | 'custom' | 'specific'
  paid_from: 'pool' | 'pocket'
  created_at: string
  deleted_at: string | null
  version: number
}

export interface ExpenseSplit {
  id: string
  expense_id: string
  member_id: string
  share_amount: number
}

export interface Settlement {
  id: string
  trip_id: string
  from_member_id: string
  to_member_id: string
  amount: number
  method: 'direct' | 'via_pool'
  note: string
  created_at: string
  deleted_at: string | null
}

export interface BalanceEntry {
  memberId: string
  net: number
}

export interface Transfer {
  from: Member
  to: Member
  amount: number
}

export type Category = 'food' | 'transport' | 'accommodation' | 'activities' | 'shopping' | 'telecom' | 'medical' | 'other'

export interface OfflineMutation {
  id: string
  type: 'insert' | 'soft_delete'
  table: string
  data: Record<string, unknown>
  version?: number
  timestamp: string
  tripId: string
}
