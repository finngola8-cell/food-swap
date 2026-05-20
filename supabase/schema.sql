-- AI Business Empire — Supabase Schema
-- Run this in your Supabase SQL editor

-- Agents
create table if not exists agents (
  id text primary key,
  name text not null,
  role text not null,
  status text not null default 'idle',
  current_task text,
  avatar text,
  position_x integer default 0,
  position_y integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Decisions (includes human approval queue)
create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  agent_id text references agents(id),
  agent_name text not null,
  decision text not null,
  requires_approval boolean default false,
  approved boolean,
  metadata jsonb default '{}',
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- Revenue
create table if not exists revenue (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  amount numeric(10,2) not null,
  currency text default 'USD',
  listing_id uuid,
  platform text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Expenses
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric(10,2) not null,
  currency text default 'USD',
  description text,
  approved_by text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Listings
create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'etsy',
  title text not null,
  niche text,
  description text,
  tags text[],
  suggested_price numeric(10,2),
  final_price numeric(10,2),
  printify_blueprint text,
  design_prompt text,
  status text not null default 'draft',
  created_by text references agents(id),
  decision_id uuid references decisions(id),
  external_id text,
  revenue numeric(10,2) default 0,
  views integer default 0,
  sales integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Agent messages
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  from_agent text not null,
  to_agent text not null,
  content text not null,
  type text default 'info',
  created_at timestamptz default now()
);

-- Activity log (for the game world feed)
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  agent_id text references agents(id),
  activity text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Customer messages from Etsy
create table if not exists customer_messages (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  customer_email text,
  order_id text,
  order_amount numeric(10,2),
  order_details jsonb default '{}',
  subject text,
  content text not null,
  status text default 'unhandled',
  agent_response text,
  handled_at timestamptz,
  created_at timestamptz default now()
);

-- Social media content
create table if not exists social_content (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id),
  platform text not null,
  title text,
  content text not null,
  keywords text[],
  hashtags text[],
  status text default 'ready',
  posted_at timestamptz,
  created_by text references agents(id),
  created_at timestamptz default now()
);

-- Seed initial agents
insert into agents (id, name, role, status, position_x, position_y) values
  ('design-agent', 'Design Agent', 'designer', 'idle', 200, 150),
  ('listing-agent', 'Listing Agent', 'lister', 'idle', 350, 150),
  ('customer-service-agent', 'Customer Service Agent', 'support', 'idle', 200, 300),
  ('marketing-agent', 'Marketing Agent', 'marketer', 'idle', 350, 300)
on conflict (id) do nothing;

-- Enable realtime on key tables
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table activity_log;
alter publication supabase_realtime add table decisions;
alter publication supabase_realtime add table agents;
