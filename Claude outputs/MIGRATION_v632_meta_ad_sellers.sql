-- v632 · Chủ từng AD Meta (persist) — chạy 1 lần trong Supabase SQL Editor.
-- (a) auto: /api/meta-ads/entities ghi lại mỗi lần resolve được chuỗi ad → listing → owner;
-- (b) manual: admin gán tay trong Ads Center cho ads cũ tạo trước hệ thống (auto không đè manual).
-- Finance dùng bảng này để tính CHI PHÍ ADS THEO SELLER hàng tháng, kể cả ad đã xóa trên Meta.
CREATE TABLE IF NOT EXISTS meta_ad_sellers (
  ad_id text PRIMARY KEY,
  seller_name text NOT NULL DEFAULT '',
  seller_id uuid,
  manual boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_ad_sellers_seller ON meta_ad_sellers(seller_id);
