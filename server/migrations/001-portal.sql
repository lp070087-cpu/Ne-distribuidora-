CREATE SCHEMA IF NOT EXISTS maxdistrib;

CREATE TABLE maxdistrib.accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  role text NOT NULL CHECK (role IN ('RETAIL_CUSTOMER','WHOLESALE_RESELLER','ADMIN')),
  status text NOT NULL CHECK (status IN ('ACTIVE','PENDING_APPROVAL','REJECTED','SUSPENDED')),
  business text,
  tax_id text,
  city text,
  state text,
  accepted_terms text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deletion_requested_at timestamptz
);
CREATE TABLE maxdistrib.sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES maxdistrib.accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX ON maxdistrib.sessions(account_id);
CREATE TABLE maxdistrib.password_resets (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES maxdistrib.accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX ON maxdistrib.password_resets(account_id);
CREATE TABLE maxdistrib.rate_limits (
  bucket text NOT NULL,
  window_start bigint NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  PRIMARY KEY(bucket, window_start)
);
CREATE TABLE maxdistrib.addresses (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES maxdistrib.accounts(id),
  details jsonb NOT NULL,
  is_primary boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX ON maxdistrib.addresses(account_id) WHERE is_primary;

CREATE TABLE maxdistrib.products (
  sku text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  brand text NOT NULL,
  image text,
  retail_cents integer CHECK (retail_cents > 0),
  wholesale_tiers jsonb NOT NULL DEFAULT '[]',
  wholesale_multiple integer NOT NULL DEFAULT 1 CHECK (wholesale_multiple BETWEEN 1 AND 10000),
  wholesale_until timestamptz,
  active boolean NOT NULL DEFAULT false,
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved BETWEEN 0 AND on_hand)
);
CREATE TABLE maxdistrib.cart (
  account_id uuid NOT NULL REFERENCES maxdistrib.accounts(id),
  sku text NOT NULL REFERENCES maxdistrib.products(sku),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  PRIMARY KEY (account_id,sku)
);
CREATE TABLE maxdistrib.favorites (
  account_id uuid NOT NULL REFERENCES maxdistrib.accounts(id),
  sku text NOT NULL REFERENCES maxdistrib.products(sku),
  PRIMARY KEY (account_id,sku)
);
CREATE TABLE maxdistrib.orders (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES maxdistrib.accounts(id),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('RETAIL_CUSTOMER','WHOLESALE_RESELLER')),
  status text NOT NULL CHECK (status IN ('RECEIVED','AWAITING_CONFIRMATION','CONFIRMED','PICKING','SHIPPED','DELIVERED','CANCELLED')),
  address jsonb NOT NULL,
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancellation_requested_at timestamptz,
  UNIQUE(account_id,idempotency_key)
);
CREATE INDEX ON maxdistrib.orders(account_id,created_at DESC);
CREATE TABLE maxdistrib.order_items (
  order_id uuid NOT NULL REFERENCES maxdistrib.orders(id),
  sku text NOT NULL REFERENCES maxdistrib.products(sku),
  name text NOT NULL,
  quantity integer NOT NULL CHECK(quantity > 0),
  unit_cents integer NOT NULL CHECK(unit_cents > 0),
  PRIMARY KEY(order_id,sku)
);
CREATE TABLE maxdistrib.order_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES maxdistrib.orders(id),
  actor_id uuid NOT NULL REFERENCES maxdistrib.accounts(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE maxdistrib.order_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES maxdistrib.orders(id),
  actor_id uuid NOT NULL REFERENCES maxdistrib.accounts(id),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE maxdistrib.stock_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku text NOT NULL REFERENCES maxdistrib.products(sku),
  order_id uuid REFERENCES maxdistrib.orders(id),
  actor_id uuid NOT NULL REFERENCES maxdistrib.accounts(id),
  event text NOT NULL CHECK(event IN ('ADJUSTED','RESERVED','RELEASED','SHIPPED')),
  on_hand_delta integer NOT NULL,
  reserved_delta integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id,sku,event)
);
CREATE TABLE maxdistrib.support (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES maxdistrib.accounts(id),
  order_id uuid REFERENCES maxdistrib.orders(id),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
