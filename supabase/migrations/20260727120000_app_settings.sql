-- Migration: App Settings for configurable UI elements
-- Date: 2026-07-27
-- Description: Stores global app settings like link buttons, telegram groups, etc.

-- Create app_settings table
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Public read access (all users can read settings)
CREATE POLICY "Public read access"
  ON public.app_settings
  FOR SELECT
  USING (true);

-- Policy: Only admin can insert/update/delete
CREATE POLICY "Admin only write"
  ON public.app_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.admins
      WHERE admins.user_id = auth.uid()
        AND admins.is_active = true
    )
  );

-- Insert default settings for action buttons
INSERT INTO public.app_settings (key, value, description) VALUES
(
  'action_buttons',
  '{
    "whatsNew": {
      "enabled": true,
      "label": {
        "id": "Yang Baru di Profitku",
        "en": "What''s New in Profitku",
        "ms": "Apa Yang Baru di Profitku"
      }
    },
    "requestFeature": {
      "enabled": true,
      "url": "https://t.me/profitku",
      "label": {
        "id": "💡 Request Fitur",
        "en": "💡 Request Feature",
        "ms": "💡 Minta Fitur"
      }
    },
    "donate": {
      "enabled": true,
      "url": "mailto:support@profitku.my.id",
      "label": {
        "id": "☕ Traktir Kopi untuk Developer",
        "en": "☕ Buy Developer a Coffee",
        "ms": "☕ Belanja Kopi untuk Pembangun"
      }
    },
    "telegram": {
      "enabled": true,
      "url": "https://t.me/profitku",
      "label": {
        "id": "💬 Gabung Grup Telegram",
        "en": "💬 Join Telegram Group",
        "ms": "💬 Sertai Grup Telegram"
      }
    }
  }'::jsonb,
  'Configuration for action buttons in Settings page (About section)'
),
(
  'support_links',
  '{
    "telegram": "https://t.me/profitku",
    "email": "support@profitku.my.id",
    "website": "https://profitku.my.id"
  }'::jsonb,
  'Global support contact links'
)
ON CONFLICT (key) DO NOTHING;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_app_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_app_settings_updated_at();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON public.app_settings(key);

-- Grant permissions
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;

COMMENT ON TABLE public.app_settings IS 'Global application settings configurable by admin';
COMMENT ON COLUMN public.app_settings.key IS 'Unique setting key identifier';
COMMENT ON COLUMN public.app_settings.value IS 'JSON setting value (flexible structure)';
COMMENT ON COLUMN public.app_settings.description IS 'Human-readable description of the setting';
COMMENT ON COLUMN public.app_settings.updated_at IS 'Last update timestamp';
COMMENT ON COLUMN public.app_settings.updated_by IS 'Admin user who last updated this setting';
