-- نظام مؤسسة يوسف عيد المطيري لقطع غيار السيارات
-- شغّل الملف كاملًا داخل Supabase SQL Editor على مشروع جديد.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'sales', 'inventory');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sale_status as enum ('completed', 'partial_return', 'returned');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default 'مستخدم',
  role public.app_role not null default 'sales',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  bank_account text,
  notes text,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text unique,
  name text not null,
  category text,
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  stock_quantity numeric(14,2) not null default 0 check (stock_quantity >= 0),
  min_stock numeric(14,2) not null default 0 check (min_stock >= 0),
  image_path text,
  notes text,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  sale_date timestamptz not null default now(),
  subtotal numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status public.sale_status not null default 'completed',
  notes text,
  client_request_id uuid not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  sku_snapshot text not null,
  name_snapshot text not null,
  quantity numeric(14,2) not null check (quantity > 0),
  returned_quantity numeric(14,2) not null default 0 check (returned_quantity >= 0 and returned_quantity <= quantity),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  vat_rate numeric(6,2) not null default 15 check (vat_rate >= 0),
  line_subtotal numeric(14,2) not null,
  line_vat numeric(14,2) not null,
  line_total numeric(14,2) not null
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  invoice_number text not null,
  purchase_date timestamptz not null default now(),
  subtotal numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  notes text,
  client_request_id uuid not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (supplier_id, invoice_number)
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  sku_snapshot text not null,
  name_snapshot text not null,
  quantity numeric(14,2) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  vat_rate numeric(6,2) not null default 15 check (vat_rate >= 0),
  line_subtotal numeric(14,2) not null,
  line_vat numeric(14,2) not null,
  line_total numeric(14,2) not null
);

create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  return_date timestamptz not null default now(),
  reason text not null,
  subtotal numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  client_request_id uuid not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id),
  product_id uuid not null references public.products(id),
  quantity numeric(14,2) not null check (quantity > 0),
  subtotal numeric(14,2) not null,
  vat numeric(14,2) not null,
  total numeric(14,2) not null
);

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  count_date timestamptz not null default now(),
  notes text,
  client_request_id uuid not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  expected_quantity numeric(14,2) not null,
  actual_quantity numeric(14,2) not null check (actual_quantity >= 0),
  difference numeric(14,2) generated always as (actual_quantity - expected_quantity) stored,
  reason text
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_type text not null check (movement_type in ('opening','purchase','sale','sale_return','count_adjustment')),
  quantity_change numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists products_name_idx on public.products using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(sku,'') || ' ' || coalesce(barcode,'')));
create index if not exists sales_date_idx on public.sales(sale_date desc);
create index if not exists purchases_date_idx on public.purchases(purchase_date desc);
create index if not exists stock_movements_product_date_idx on public.stock_movements(product_id, created_at desc);
create index if not exists audit_logs_date_idx on public.audit_logs(created_at desc);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, 'مستخدم'), '@', 1)),
    case when new.raw_user_meta_data->>'role' in ('admin','sales','inventory')
      then (new.raw_user_meta_data->>'role')::public.app_role else 'sales'::public.app_role end
  ) on conflict (id) do update set email = excluded.email;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active = true
$$;

create or replace function public.assert_roles(allowed public.app_role[])
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.current_role() = any(allowed)) then
    raise exception 'permission_denied';
  end if;
end; $$;

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_details jsonb;
begin
  v_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'));
  v_details := case when tg_op = 'DELETE' then jsonb_build_object('old', to_jsonb(old))
                    when tg_op = 'INSERT' then jsonb_build_object('new', to_jsonb(new))
                    else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) end;
  insert into public.audit_logs(user_id, action, entity_type, entity_id, details)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_details);
  return coalesce(new, old);
end; $$;

create or replace function public.protect_product_stock()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.stock_quantity is distinct from old.stock_quantity
     and coalesce(current_setting('app.allow_stock_update', true), '') <> 'on' then
    raise exception 'direct_stock_update_not_allowed';
  end if;
  return new;
end; $$;

drop trigger if exists protect_product_stock_trigger on public.products;
create trigger protect_product_stock_trigger
before update of stock_quantity on public.products
for each row execute function public.protect_product_stock();

-- الدوال الذرية: بيع / شراء / مرتجع / جرد
create or replace function public.complete_sale(
  p_invoice_number text,
  p_sale_date timestamptz,
  p_items jsonb,
  p_notes text,
  p_client_request_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_price numeric;
  v_rate numeric;
  v_total numeric;
  v_subtotal numeric;
  v_vat numeric;
  v_sum_subtotal numeric := 0;
  v_sum_vat numeric := 0;
  v_sum_total numeric := 0;
begin
  perform public.assert_roles(array['admin','sales']::public.app_role[]);
  perform set_config('app.allow_stock_update','on',true);
  select id into v_sale_id from public.sales where client_request_id = p_client_request_id;
  if v_sale_id is not null then return v_sale_id; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'empty_sale'; end if;

  insert into public.sales(invoice_number, sale_date, notes, client_request_id)
  values (trim(p_invoice_number), coalesce(p_sale_date, now()), nullif(trim(p_notes),''), p_client_request_id)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    v_rate := coalesce((v_item->>'vat_rate')::numeric, 15);
    if v_qty <= 0 or v_price < 0 or v_rate < 0 then raise exception 'invalid_sale_item'; end if;

    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and active = true for update;
    if not found then raise exception 'product_not_found'; end if;
    if public.current_role() <> 'admin' and v_price <> v_product.sale_price then raise exception 'price_change_not_allowed'; end if;
    if v_product.stock_quantity < v_qty then raise exception 'insufficient_stock:%', v_product.sku; end if;

    v_total := round(v_qty * v_price, 2);
    v_subtotal := round(v_total / (1 + (v_rate / 100)), 2);
    v_vat := v_total - v_subtotal;

    insert into public.sale_items(sale_id, product_id, sku_snapshot, name_snapshot, quantity, unit_cost, unit_price, vat_rate, line_subtotal, line_vat, line_total)
    values(v_sale_id, v_product.id, v_product.sku, v_product.name, v_qty, v_product.purchase_price, v_price, v_rate, v_subtotal, v_vat, v_total);

    update public.products set stock_quantity = stock_quantity - v_qty, updated_at = now() where id = v_product.id;
    insert into public.stock_movements(product_id, movement_type, quantity_change, balance_after, reference_type, reference_id)
    values(v_product.id, 'sale', -v_qty, v_product.stock_quantity - v_qty, 'sale', v_sale_id);

    v_sum_subtotal := v_sum_subtotal + v_subtotal;
    v_sum_vat := v_sum_vat + v_vat;
    v_sum_total := v_sum_total + v_total;
  end loop;

  update public.sales set subtotal = v_sum_subtotal, vat = v_sum_vat, total = v_sum_total where id = v_sale_id;
  return v_sale_id;
end; $$;

create or replace function public.record_purchase(
  p_supplier_id uuid,
  p_invoice_number text,
  p_purchase_date timestamptz,
  p_items jsonb,
  p_notes text,
  p_client_request_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_purchase_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_cost numeric;
  v_rate numeric;
  v_total numeric;
  v_subtotal numeric;
  v_vat numeric;
  v_sum_subtotal numeric := 0;
  v_sum_vat numeric := 0;
  v_sum_total numeric := 0;
begin
  perform public.assert_roles(array['admin','inventory']::public.app_role[]);
  perform set_config('app.allow_stock_update','on',true);
  select id into v_purchase_id from public.purchases where client_request_id = p_client_request_id;
  if v_purchase_id is not null then return v_purchase_id; end if;
  if not exists(select 1 from public.suppliers where id = p_supplier_id and active) then raise exception 'supplier_not_found'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'empty_purchase'; end if;

  insert into public.purchases(supplier_id, invoice_number, purchase_date, notes, client_request_id)
  values(p_supplier_id, trim(p_invoice_number), coalesce(p_purchase_date, now()), nullif(trim(p_notes),''), p_client_request_id)
  returning id into v_purchase_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    v_rate := coalesce((v_item->>'vat_rate')::numeric, 15);
    if v_qty <= 0 or v_cost < 0 or v_rate < 0 then raise exception 'invalid_purchase_item'; end if;

    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and active = true for update;
    if not found then raise exception 'product_not_found'; end if;

    v_total := round(v_qty * v_cost, 2);
    v_subtotal := round(v_total / (1 + (v_rate / 100)), 2);
    v_vat := v_total - v_subtotal;

    insert into public.purchase_items(purchase_id, product_id, sku_snapshot, name_snapshot, quantity, unit_cost, vat_rate, line_subtotal, line_vat, line_total)
    values(v_purchase_id, v_product.id, v_product.sku, v_product.name, v_qty, v_cost, v_rate, v_subtotal, v_vat, v_total);

    update public.products set stock_quantity = stock_quantity + v_qty, purchase_price = round(v_subtotal / v_qty, 2), updated_at = now() where id = v_product.id;
    insert into public.stock_movements(product_id, movement_type, quantity_change, balance_after, reference_type, reference_id)
    values(v_product.id, 'purchase', v_qty, v_product.stock_quantity + v_qty, 'purchase', v_purchase_id);

    v_sum_subtotal := v_sum_subtotal + v_subtotal;
    v_sum_vat := v_sum_vat + v_vat;
    v_sum_total := v_sum_total + v_total;
  end loop;

  update public.purchases set subtotal = v_sum_subtotal, vat = v_sum_vat, total = v_sum_total where id = v_purchase_id;
  return v_purchase_id;
end; $$;

create or replace function public.return_sale(
  p_sale_id uuid,
  p_reason text,
  p_items jsonb,
  p_client_request_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_return_id uuid;
  v_item jsonb;
  v_sale_item public.sale_items%rowtype;
  v_product public.products%rowtype;
  v_qty numeric;
  v_ratio numeric;
  v_subtotal numeric;
  v_vat numeric;
  v_total numeric;
  v_sum_subtotal numeric := 0;
  v_sum_vat numeric := 0;
  v_sum_total numeric := 0;
  v_all_returned boolean;
begin
  perform public.assert_roles(array['admin','sales']::public.app_role[]);
  perform set_config('app.allow_stock_update','on',true);
  select id into v_return_id from public.sale_returns where client_request_id = p_client_request_id;
  if v_return_id is not null then return v_return_id; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'return_reason_required'; end if;
  if not exists(select 1 from public.sales where id = p_sale_id) then raise exception 'sale_not_found'; end if;

  insert into public.sale_returns(sale_id, reason, client_request_id)
  values(p_sale_id, trim(p_reason), p_client_request_id) returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty <= 0 then continue; end if;
    select * into v_sale_item from public.sale_items where id = (v_item->>'sale_item_id')::uuid and sale_id = p_sale_id for update;
    if not found then raise exception 'sale_item_not_found'; end if;
    if v_sale_item.returned_quantity + v_qty > v_sale_item.quantity then raise exception 'return_quantity_exceeded'; end if;

    select * into v_product from public.products where id = v_sale_item.product_id for update;
    v_ratio := v_qty / v_sale_item.quantity;
    v_subtotal := round(v_sale_item.line_subtotal * v_ratio, 2);
    v_vat := round(v_sale_item.line_vat * v_ratio, 2);
    v_total := v_subtotal + v_vat;

    insert into public.sale_return_items(return_id, sale_item_id, product_id, quantity, subtotal, vat, total)
    values(v_return_id, v_sale_item.id, v_product.id, v_qty, v_subtotal, v_vat, v_total);
    update public.sale_items set returned_quantity = returned_quantity + v_qty where id = v_sale_item.id;
    update public.products set stock_quantity = stock_quantity + v_qty, updated_at = now() where id = v_product.id;
    insert into public.stock_movements(product_id, movement_type, quantity_change, balance_after, reference_type, reference_id, notes)
    values(v_product.id, 'sale_return', v_qty, v_product.stock_quantity + v_qty, 'sale_return', v_return_id, p_reason);

    v_sum_subtotal := v_sum_subtotal + v_subtotal;
    v_sum_vat := v_sum_vat + v_vat;
    v_sum_total := v_sum_total + v_total;
  end loop;

  if v_sum_total <= 0 then raise exception 'empty_return'; end if;
  update public.sale_returns set subtotal = v_sum_subtotal, vat = v_sum_vat, total = v_sum_total where id = v_return_id;
  select bool_and(returned_quantity = quantity) into v_all_returned from public.sale_items where sale_id = p_sale_id;
  update public.sales set status = case when v_all_returned then 'returned'::public.sale_status else 'partial_return'::public.sale_status end where id = p_sale_id;
  return v_return_id;
end; $$;

create or replace function public.complete_inventory_count(
  p_count_date timestamptz,
  p_notes text,
  p_items jsonb,
  p_client_request_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_count_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_actual numeric;
  v_reason text;
  v_diff numeric;
begin
  perform public.assert_roles(array['admin','inventory']::public.app_role[]);
  perform set_config('app.allow_stock_update','on',true);
  select id into v_count_id from public.inventory_counts where client_request_id = p_client_request_id;
  if v_count_id is not null then return v_count_id; end if;

  insert into public.inventory_counts(count_date, notes, client_request_id)
  values(coalesce(p_count_date, now()), nullif(trim(p_notes),''), p_client_request_id) returning id into v_count_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_actual := (v_item->>'actual_quantity')::numeric;
    v_reason := nullif(trim(v_item->>'reason'),'');
    if v_actual < 0 then raise exception 'invalid_count_quantity'; end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and active = true for update;
    if not found then continue; end if;
    v_diff := v_actual - v_product.stock_quantity;
    if v_diff <> 0 and v_reason is null then raise exception 'count_reason_required'; end if;
    insert into public.inventory_count_items(count_id, product_id, expected_quantity, actual_quantity, reason)
    values(v_count_id, v_product.id, v_product.stock_quantity, v_actual, v_reason);
    if v_diff <> 0 then
      update public.products set stock_quantity = v_actual, updated_at = now() where id = v_product.id;
      insert into public.stock_movements(product_id, movement_type, quantity_change, balance_after, reference_type, reference_id, notes)
      values(v_product.id, 'count_adjustment', v_diff, v_actual, 'inventory_count', v_count_id, v_reason);
    end if;
  end loop;
  return v_count_id;
end; $$;

create or replace view public.v_purchase_suggestions as
with sold as (
  select si.product_id, coalesce(sum(si.quantity - si.returned_quantity),0) sold_30_days
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.sale_date >= now() - interval '30 days'
  group by si.product_id
)
select p.id, p.sku, p.name, p.stock_quantity, p.min_stock,
       coalesce(s.sold_30_days,0) sold_30_days,
       greatest(ceil(greatest(p.min_stock * 2, coalesce(s.sold_30_days,0)) - p.stock_quantity),0)::numeric suggested_quantity
from public.products p left join sold s on s.product_id = p.id
where p.active and (p.stock_quantity <= p.min_stock or greatest(p.min_stock * 2, coalesce(s.sold_30_days,0)) > p.stock_quantity);

create or replace function public.get_profit_loss_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.assert_roles(array['admin']::public.app_role[]);
  with sales_agg as (
    select coalesce(sum(si.line_subtotal),0) gross_sales,
           coalesce(sum(si.quantity * si.unit_cost),0) gross_cost
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.sale_date >= p_from and s.sale_date < (p_to + 1)
  ), return_agg as (
    select coalesce(sum(sri.subtotal),0) returned_sales,
           coalesce(sum(sri.quantity * si.unit_cost),0) returned_cost
    from public.sale_return_items sri
    join public.sale_returns sr on sr.id = sri.return_id
    join public.sale_items si on si.id = sri.sale_item_id
    where sr.return_date >= p_from and sr.return_date < (p_to + 1)
  ), cnt as (
    select count(*) sales_count from public.sales where sale_date >= p_from and sale_date < (p_to + 1)
  ), totals as (
    select (sales_agg.gross_sales - return_agg.returned_sales) net_sales,
           (sales_agg.gross_cost - return_agg.returned_cost) cost_of_goods
    from sales_agg, return_agg
  )
  select jsonb_build_object(
    'net_sales', round(totals.net_sales,2),
    'cost_of_goods', round(totals.cost_of_goods,2),
    'gross_profit', round(totals.net_sales - totals.cost_of_goods,2),
    'margin_percent', case when totals.net_sales = 0 then 0 else round(((totals.net_sales - totals.cost_of_goods) / totals.net_sales) * 100,2) end,
    'sales_count', cnt.sales_count
  ) into v_result from totals, cnt;
  return v_result;
end; $$;

create or replace function public.get_vat_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.assert_roles(array['admin']::public.app_role[]);
  with sales_vat as (
    select coalesce(sum(si.line_vat),0) vat
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.sale_date >= p_from and s.sale_date < (p_to + 1)
  ), return_vat as (
    select coalesce(sum(sri.vat),0) vat
    from public.sale_return_items sri join public.sale_returns sr on sr.id = sri.return_id
    where sr.return_date >= p_from and sr.return_date < (p_to + 1)
  ), purchase_vat as (
    select coalesce(sum(pi.line_vat),0) vat
    from public.purchase_items pi join public.purchases p on p.id = pi.purchase_id
    where p.purchase_date >= p_from and p.purchase_date < (p_to + 1)
  ), totals as (
    select sales_vat.vat - return_vat.vat output_vat, purchase_vat.vat input_vat
    from sales_vat, return_vat, purchase_vat
  )
  select jsonb_build_object(
    'output_vat',round(totals.output_vat,2),
    'input_vat',round(totals.input_vat,2),
    'net_vat',round(totals.output_vat-totals.input_vat,2)
  ) into v_result from totals;
  return v_result;
end; $$;

create or replace function public.get_inventory_turnover(p_from date, p_to date)
returns table(product_id uuid, sku text, name text, quantity_sold numeric, cost_of_goods numeric, current_stock numeric, turnover_rate numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_roles(array['admin']::public.app_role[]);
  return query
  with sold as (
    select si.product_id,
           coalesce(sum(si.quantity),0) qty,
           coalesce(sum(si.quantity * si.unit_cost),0) cost
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.sale_date >= p_from and s.sale_date < (p_to + 1)
    group by si.product_id
  ), returned as (
    select sri.product_id,
           coalesce(sum(sri.quantity),0) qty,
           coalesce(sum(sri.quantity * si.unit_cost),0) cost
    from public.sale_return_items sri
    join public.sale_returns sr on sr.id = sri.return_id
    join public.sale_items si on si.id = sri.sale_item_id
    where sr.return_date >= p_from and sr.return_date < (p_to + 1)
    group by sri.product_id
  )
  select p.id, p.sku, p.name,
         greatest(coalesce(sold.qty,0) - coalesce(returned.qty,0),0)::numeric quantity_sold,
         greatest(coalesce(sold.cost,0) - coalesce(returned.cost,0),0)::numeric cost_of_goods,
         p.stock_quantity current_stock,
         round(greatest(coalesce(sold.qty,0) - coalesce(returned.qty,0),0) / nullif(greatest(p.stock_quantity,1),0),2)::numeric turnover_rate
  from public.products p
  left join sold on sold.product_id = p.id
  left join returned on returned.product_id = p.id
  where p.active
  order by 7 desc, 4 desc;
end; $$;

create or replace function public.get_dashboard_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.assert_roles(array['admin','sales','inventory']::public.app_role[]);
  select jsonb_build_object(
    'sales_total', case when public.current_role() in ('admin','sales') then (select coalesce(sum(total),0) from public.sales where sale_date >= p_from and sale_date < (p_to + 1)) else null end,
    'sales_count', case when public.current_role() in ('admin','sales') then (select count(*) from public.sales where sale_date >= p_from and sale_date < (p_to + 1)) else null end,
    'net_profit', case when public.current_role() = 'admin' then (select (public.get_profit_loss_report(p_from,p_to)->>'gross_profit')::numeric) else null end,
    'inventory_value', case when public.current_role() in ('admin','inventory') then (select coalesce(sum(stock_quantity * purchase_price),0) from public.products where active) else null end,
    'products_count', (select count(*) from public.products where active),
    'low_stock_count', (select count(*) from public.products where active and stock_quantity <= min_stock),
    'daily_sales', case when public.current_role() in ('admin','sales') then (select coalesce(jsonb_agg(x order by x.day),'[]'::jsonb) from (
      select d::date day, coalesce(sum(s.total),0) total from generate_series(current_date-29,current_date,'1 day') d
      left join public.sales s on s.sale_date::date=d::date group by d::date
    ) x) else '[]'::jsonb end,
    'purchase_suggestions', case when public.current_role() in ('admin','inventory') then (select coalesce(jsonb_agg(v order by v.suggested_quantity desc),'[]'::jsonb) from (select * from public.v_purchase_suggestions limit 10) v) else '[]'::jsonb end,
    'recent_activity', (select coalesce(jsonb_agg(a order by a.created_at desc),'[]'::jsonb) from (
      select 'sale' type, 'بيع' type_label, s.invoice_number reference, s.total amount, p.full_name employee, s.created_at
      from public.sales s left join public.profiles p on p.id=s.created_by
      where public.current_role() in ('admin','sales')
      union all
      select 'purchase','شراء',pu.invoice_number,pu.total,p.full_name,pu.created_at
      from public.purchases pu left join public.profiles p on p.id=pu.created_by
      where public.current_role() in ('admin','inventory')
      union all
      select 'return','مرتجع',s.invoice_number,r.total,p.full_name,r.created_at
      from public.sale_returns r join public.sales s on s.id=r.sale_id left join public.profiles p on p.id=r.created_by
      where public.current_role() in ('admin','sales')
      union all
      select 'count','جرد',to_char(c.count_date,'YYYY-MM-DD'),0,p.full_name,c.created_at
      from public.inventory_counts c left join public.profiles p on p.id=c.created_by
      where public.current_role() in ('admin','inventory')
      order by created_at desc limit 15
    ) a)
  ) into v_result;
  return v_result;
end; $$;

-- RLS
alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_logs enable row level security;

-- حذف السياسات إن كانت موجودة لتسهيل إعادة تشغيل الملف
DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN (
        'profiles','suppliers','products','sales','sale_items','purchases','purchase_items',
        'sale_returns','sale_return_items','inventory_counts','inventory_count_items',
        'stock_movements','audit_logs'
      )
  LOOP
    EXECUTE format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

create policy profiles_read on public.profiles for select to authenticated using (public.current_role() is not null);
create policy profiles_admin_update on public.profiles for update to authenticated using (public.current_role()='admin') with check (public.current_role()='admin');

create policy products_read on public.products for select to authenticated using (public.current_role() is not null);
create policy products_insert on public.products for insert to authenticated with check (public.current_role() in ('admin','inventory'));
create policy products_update on public.products for update to authenticated using (public.current_role() in ('admin','inventory')) with check (public.current_role() in ('admin','inventory'));

create policy suppliers_read on public.suppliers for select to authenticated using (public.current_role() in ('admin','inventory'));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (public.current_role() in ('admin','inventory'));
create policy suppliers_update on public.suppliers for update to authenticated using (public.current_role() in ('admin','inventory')) with check (public.current_role() in ('admin','inventory'));

create policy sales_read on public.sales for select to authenticated using (public.current_role() in ('admin','sales'));
create policy sale_items_read on public.sale_items for select to authenticated using (public.current_role() in ('admin','sales'));
create policy purchases_read on public.purchases for select to authenticated using (public.current_role() in ('admin','inventory'));
create policy purchase_items_read on public.purchase_items for select to authenticated using (public.current_role() in ('admin','inventory'));
create policy returns_read on public.sale_returns for select to authenticated using (public.current_role() in ('admin','sales'));
create policy return_items_read on public.sale_return_items for select to authenticated using (public.current_role() in ('admin','sales'));
create policy counts_read on public.inventory_counts for select to authenticated using (public.current_role() in ('admin','inventory'));
create policy count_items_read on public.inventory_count_items for select to authenticated using (public.current_role() in ('admin','inventory'));
create policy movements_read on public.stock_movements for select to authenticated using (public.current_role() in ('admin','inventory'));
create policy audit_admin_read on public.audit_logs for select to authenticated using (public.current_role()='admin');

-- صلاحيات الجداول: أقل قدر مطلوب للواجهة، ثم تتحكم RLS في الصفوف
grant usage on schema public to authenticated;
revoke all on table public.profiles, public.suppliers, public.products, public.sales, public.sale_items,
  public.purchases, public.purchase_items, public.sale_returns, public.sale_return_items,
  public.inventory_counts, public.inventory_count_items, public.stock_movements, public.audit_logs from anon, public;

grant select on table public.profiles, public.products, public.suppliers, public.sales, public.sale_items,
  public.purchases, public.purchase_items, public.sale_returns, public.sale_return_items,
  public.inventory_counts, public.inventory_count_items, public.stock_movements, public.audit_logs to authenticated;
grant insert, update on table public.products, public.suppliers to authenticated;

-- صلاحيات استدعاء الدوال
revoke all on function public.complete_sale(text,timestamptz,jsonb,text,uuid) from public;
revoke all on function public.record_purchase(uuid,text,timestamptz,jsonb,text,uuid) from public;
revoke all on function public.return_sale(uuid,text,jsonb,uuid) from public;
revoke all on function public.complete_inventory_count(timestamptz,text,jsonb,uuid) from public;
grant execute on function public.complete_sale(text,timestamptz,jsonb,text,uuid) to authenticated;
grant execute on function public.record_purchase(uuid,text,timestamptz,jsonb,text,uuid) to authenticated;
grant execute on function public.return_sale(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.complete_inventory_count(timestamptz,text,jsonb,uuid) to authenticated;

revoke all on public.v_purchase_suggestions from public, anon;
grant select on public.v_purchase_suggestions to authenticated;

revoke all on function public.get_dashboard_summary(date,date) from public, anon;
revoke all on function public.get_profit_loss_report(date,date) from public, anon;
revoke all on function public.get_vat_report(date,date) from public, anon;
revoke all on function public.get_inventory_turnover(date,date) from public, anon;
grant execute on function public.get_dashboard_summary(date,date) to authenticated;
grant execute on function public.get_profit_loss_report(date,date) to authenticated;
grant execute on function public.get_vat_report(date,date) to authenticated;
grant execute on function public.get_inventory_turnover(date,date) to authenticated;

-- سجل التغييرات المباشرة
DO $$ BEGIN
  drop trigger if exists audit_profiles on public.profiles;
  create trigger audit_profiles after update on public.profiles for each row execute function public.audit_row_change();
  drop trigger if exists audit_products on public.products;
  create trigger audit_products after insert or update or delete on public.products for each row execute function public.audit_row_change();
  drop trigger if exists audit_suppliers on public.suppliers;
  create trigger audit_suppliers after insert or update or delete on public.suppliers for each row execute function public.audit_row_change();
  drop trigger if exists audit_sales on public.sales;
  create trigger audit_sales after insert or update on public.sales for each row execute function public.audit_row_change();
  drop trigger if exists audit_purchases on public.purchases;
  create trigger audit_purchases after insert or update on public.purchases for each row execute function public.audit_row_change();
  drop trigger if exists audit_returns on public.sale_returns;
  create trigger audit_returns after insert or update on public.sale_returns for each row execute function public.audit_row_change();
  drop trigger if exists audit_counts on public.inventory_counts;
  create trigger audit_counts after insert or update on public.inventory_counts for each row execute function public.audit_row_change();
END $$;

-- Storage للصور
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true, file_size_limit=5242880;

drop policy if exists product_images_read on storage.objects;
drop policy if exists product_images_insert on storage.objects;
drop policy if exists product_images_update on storage.objects;
drop policy if exists product_images_delete on storage.objects;
create policy product_images_read on storage.objects for select using (bucket_id='product-images');
create policy product_images_insert on storage.objects for insert to authenticated with check (bucket_id='product-images' and public.current_role() in ('admin','inventory'));
create policy product_images_update on storage.objects for update to authenticated using (bucket_id='product-images' and public.current_role() in ('admin','inventory'));
create policy product_images_delete on storage.objects for delete to authenticated using (bucket_id='product-images' and public.current_role() in ('admin','inventory'));

-- بعد إنشاء أول مستخدم من Authentication نفّذ هذا السطر مرة واحدة مع بريده:
-- update public.profiles set role='admin' where email='YOUR_EMAIL@example.com';
