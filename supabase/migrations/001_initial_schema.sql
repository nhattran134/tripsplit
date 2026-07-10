-- TripSplit Initial Schema
-- Includes tables, indexes, RLS policies, and triggers

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  base_currency TEXT NOT NULL DEFAULT 'VND',
  invite_code TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX idx_trips_invite_code ON trips(invite_code);

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  auth_uid UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_admin BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(trip_id, auth_uid)
);

CREATE INDEX idx_members_trip ON members(trip_id);
CREATE INDEX idx_members_auth ON members(auth_uid);

CREATE TABLE deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id),
  amount NUMERIC(12,4) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  rate_to_base NUMERIC(12,8) NOT NULL CHECK (rate_to_base > 0),
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_deposits_trip ON deposits(trip_id);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id),
  amount NUMERIC(12,4) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  rate_to_base NUMERIC(12,8) NOT NULL CHECK (rate_to_base > 0),
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT DEFAULT '',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  split_type TEXT NOT NULL CHECK (split_type IN ('equal', 'custom', 'specific')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_expenses_trip ON expenses(trip_id);

CREATE TABLE expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id),
  share_amount NUMERIC(12,4) NOT NULL CHECK (share_amount >= 0)
);

CREATE INDEX idx_splits_expense ON expense_splits(expense_id);
CREATE INDEX idx_splits_member ON expense_splits(member_id);

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_member_id UUID NOT NULL REFERENCES members(id),
  to_member_id UUID NOT NULL REFERENCES members(id),
  amount NUMERIC(12,4) NOT NULL CHECK (amount > 0),
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_settlements_trip ON settlements(trip_id);

-- ============================================================
-- RLS HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION is_trip_member(trip_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM members
    WHERE trip_id = trip_uuid
      AND auth_uid = auth.uid()
      AND deleted_at IS NULL
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_trip_admin(trip_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM members
    WHERE trip_id = trip_uuid
      AND auth_uid = auth.uid()
      AND is_admin = true
      AND deleted_at IS NULL
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- Trips
CREATE POLICY "trips_select" ON trips FOR SELECT USING (is_trip_member(id));
CREATE POLICY "trips_insert" ON trips FOR INSERT WITH CHECK (true);
CREATE POLICY "trips_update" ON trips FOR UPDATE USING (is_trip_admin(id));

-- Members
CREATE POLICY "members_select" ON members FOR SELECT USING (is_trip_member(trip_id));
CREATE POLICY "members_insert" ON members FOR INSERT WITH CHECK (auth_uid = auth.uid());
CREATE POLICY "members_update" ON members FOR UPDATE USING (
  is_trip_admin(trip_id) OR auth_uid = auth.uid()
);

-- Deposits
CREATE POLICY "deposits_select" ON deposits FOR SELECT USING (is_trip_member(trip_id));
CREATE POLICY "deposits_insert" ON deposits FOR INSERT WITH CHECK (
  is_trip_member(trip_id) AND
  member_id IN (SELECT id FROM members WHERE auth_uid = auth.uid() AND deleted_at IS NULL)
);
CREATE POLICY "deposits_update" ON deposits FOR UPDATE USING (
  is_trip_admin(trip_id) OR
  member_id IN (SELECT id FROM members WHERE auth_uid = auth.uid() AND deleted_at IS NULL)
);

-- Expenses
CREATE POLICY "expenses_select" ON expenses FOR SELECT USING (is_trip_member(trip_id));
CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (is_trip_member(trip_id));
CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (
  is_trip_admin(trip_id) OR
  member_id IN (SELECT id FROM members WHERE auth_uid = auth.uid() AND deleted_at IS NULL)
);

-- Expense splits
CREATE POLICY "splits_select" ON expense_splits FOR SELECT USING (
  EXISTS (SELECT 1 FROM expenses e WHERE e.id = expense_id AND is_trip_member(e.trip_id))
);
CREATE POLICY "splits_insert" ON expense_splits FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM expenses e WHERE e.id = expense_id AND is_trip_member(e.trip_id))
);

-- Settlements
CREATE POLICY "settlements_select" ON settlements FOR SELECT USING (is_trip_member(trip_id));
CREATE POLICY "settlements_insert" ON settlements FOR INSERT WITH CHECK (is_trip_member(trip_id));
CREATE POLICY "settlements_update" ON settlements FOR UPDATE USING (
  is_trip_admin(trip_id) OR
  from_member_id IN (SELECT id FROM members WHERE auth_uid = auth.uid() AND deleted_at IS NULL)
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- First member of a trip becomes admin
CREATE OR REPLACE FUNCTION set_first_member_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM members WHERE trip_id = NEW.trip_id AND id != NEW.id
  ) THEN
    NEW.is_admin := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_first_member_admin
  BEFORE INSERT ON members
  FOR EACH ROW
  EXECUTE FUNCTION set_first_member_admin();

-- Prevent is_admin modification
CREATE OR REPLACE FUNCTION prevent_admin_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_admin != NEW.is_admin THEN
    RAISE EXCEPTION 'Cannot modify is_admin field';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_admin_change
  BEFORE UPDATE ON members
  FOR EACH ROW
  EXECUTE FUNCTION prevent_admin_change();
