-- Canonical shared-world schema (Phase 0.5).
-- Fresh Supabase projects: apply migrations in timestamp order, then set
-- SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see README).
-- Idempotent: safe on environments that already have public.worlds.

CREATE TABLE IF NOT EXISTS public.worlds (
  code text PRIMARY KEY,
  setting text NOT NULL DEFAULT '',
  opening text NOT NULL,
  world_state text NOT NULL,
  model text NOT NULL DEFAULT '',
  engine_ver text NOT NULL DEFAULT '',
  play_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worlds_code_digits CHECK (code ~ '^[0-9]{10,14}$'),
  CONSTRAINT worlds_opening_nonempty CHECK (length(opening) > 0),
  CONSTRAINT worlds_world_state_nonempty CHECK (length(world_state) > 0)
);

CREATE INDEX IF NOT EXISTS worlds_created_at_idx ON public.worlds (created_at DESC);
CREATE INDEX IF NOT EXISTS worlds_play_count_idx ON public.worlds (play_count DESC);

ALTER TABLE public.worlds ENABLE ROW LEVEL SECURITY;

-- No policies: deny direct table access for anon/authenticated.
-- App uses SECURITY DEFINER RPCs (and optionally the service role key).
REVOKE ALL ON TABLE public.worlds FROM PUBLIC;
REVOKE ALL ON TABLE public.worlds FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_world(
  p_code text,
  p_setting text,
  p_opening text,
  p_world_state text,
  p_model text,
  p_engine_ver text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if p_code !~ '^[0-9]{10,14}$' then
    raise exception 'invalid code';
  end if;
  if coalesce(length(p_opening), 0) = 0 or coalesce(length(p_world_state), 0) = 0 then
    raise exception 'empty world';
  end if;

  insert into public.worlds (code, setting, opening, world_state, model, engine_ver)
  values (
    p_code,
    left(coalesce(p_setting, ''), 120),
    left(p_opening, 2000),
    left(p_world_state, 20000),
    left(coalesce(p_model, ''), 120),
    left(coalesce(p_engine_ver, ''), 40)
  );
  return p_code;
end;
$function$;

CREATE OR REPLACE FUNCTION public.load_world(p_code text)
RETURNS TABLE (
  code text,
  setting text,
  opening text,
  world_state text,
  play_count integer,
  engine_ver text,
  model text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if p_code !~ '^[0-9]{10,14}$' then
    raise exception 'invalid code';
  end if;

  return query
  update public.worlds w
  set play_count = w.play_count + 1
  where w.code = p_code
  returning
    w.code,
    w.setting,
    w.opening,
    w.world_state,
    w.play_count,
    w.engine_ver,
    w.model,
    w.created_at;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_world(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.load_world(text) FROM PUBLIC;

-- Local/dev may use the anon key; service_role always bypasses RLS and can execute.
GRANT EXECUTE ON FUNCTION public.create_world(text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_world(text) TO anon, authenticated, service_role;
