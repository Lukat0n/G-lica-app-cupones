-- Correr UNA vez en el SQL Editor de Supabase, después de deployar las funciones.
-- Reemplazá TU-PROYECTO y TU_CRON_SECRET (el mismo valor que pusiste en los secrets).
-- 13:00 UTC = 10:00 de Argentina: los recordatorios llegan a media mañana.

select cron.schedule(
  'gelica-recordatorios',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://TU-PROYECTO.supabase.co/functions/v1/recordatorios',
    headers := '{"Content-Type":"application/json","x-cron-secret":"TU_CRON_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Para ver si corrió:  select * from cron.job_run_details order by start_time desc limit 5;
-- Para cambiar el horario: select cron.unschedule('gelica-recordatorios'); y volver a crearlo.
