-- v614 · HÀNG ĐỢI ĐĂNG BÀI Instagram cho nút → PAGE (Meta Ads Center).
-- Facebook Page đặt lịch bằng scheduled_publish_time NATIVE của Meta (đúng giờ tuyệt đối);
-- Instagram Graph API KHÔNG có đặt lịch → FUSION xếp hàng ở đây, cron tick đăng khi tới giờ.
CREATE TABLE IF NOT EXISTS page_post_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id text NOT NULL DEFAULT '',
  page_id text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  to_fb boolean NOT NULL DEFAULT false,
  to_ig boolean NOT NULL DEFAULT false,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',      -- pending | done | error
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_post_queue_due ON page_post_queue (status, scheduled_at);
