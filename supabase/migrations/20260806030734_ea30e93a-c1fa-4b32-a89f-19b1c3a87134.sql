SELECT cron.unschedule('ptrades-sync-market-data');
SELECT cron.unschedule('ptrades-scan-context');
SELECT cron.unschedule('ptrades-scan-precision');

SELECT cron.schedule('ptrades-sync-market-data', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/sync-market-data',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

SELECT cron.schedule('ptrades-scan-context', '* * * * *', $$
  SELECT pg_sleep(20);
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/scan-context',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

SELECT cron.schedule('ptrades-scan-precision', '* * * * *', $$
  SELECT pg_sleep(40);
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/scan-precision',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

SELECT cron.schedule('ptrades-deliver-alerts', '* * * * *', $$
  SELECT pg_sleep(50);
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/deliver-alerts',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
