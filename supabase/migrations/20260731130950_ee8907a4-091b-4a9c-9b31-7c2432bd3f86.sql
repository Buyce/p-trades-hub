SELECT cron.unschedule('ptrades-sync-market-data');
SELECT cron.unschedule('ptrades-scan-context');
SELECT cron.unschedule('ptrades-scan-precision');

SELECT cron.schedule(
  'ptrades-sync-market-data',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/sync-market-data',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'ptrades-scan-context',
  '1-59/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/scan-context',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'ptrades-scan-precision',
  '2-59/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/scan-precision',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);