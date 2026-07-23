-- Align create_world seed codes with app makeSeedCode()
-- (10 WorldSpec dials + optional 1–4 instance ID digits).
-- Previously only 6–12 digits were accepted, so 14-digit shares always failed.

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
  -- Validate/clamp inputs here so this holds even for direct REST callers.
  -- Codes are 10-14 digits: 10 WorldSpec dials + optional 1-4 instance ID digits.
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
